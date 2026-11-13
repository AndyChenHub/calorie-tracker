from __future__ import annotations

import base64
import hashlib
import html
import json
import os
import re
import secrets
import shutil
import socket
import time
import urllib.parse
import uuid
import webbrowser
from pathlib import Path
from typing import Any, Literal, Optional

import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, Header, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, RedirectResponse
from pydantic import BaseModel, Field

# Load backend/.env if present
BASE_DIR = Path(__file__).resolve().parent
ENV_PATH = BASE_DIR / ".env"
OAUTH_STATE_PATH = BASE_DIR / ".oauth_state.json"
load_dotenv(ENV_PATH)

try:
    import google.antigravity as ga

    HAS_ANTIGRAVITY_SDK = True
except Exception:
    ga = None  # type: ignore
    HAS_ANTIGRAVITY_SDK = False


# Official OpenAI "Sign in with ChatGPT" (SIWC) OAuth 2.0 / OIDC endpoints
OPENAI_AUTH_URL = "https://auth.openai.com/api/accounts/authorize"
OPENAI_TOKEN_URL = "https://auth.openai.com/api/accounts/oauth/token"
OPENAI_RESOURCE = "https://api.openai.com/v1"
OPENAI_SCOPES = (
    "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct"
)

# Official Google OAuth 2.0 PKCE endpoints (optional when GOOGLE_OAUTH_CLIENT_ID is set)
GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
GOOGLE_SCOPES = (
    "openid email profile https://www.googleapis.com/auth/generative-language"
)


NUTRITION_SYSTEM_PROMPT = """You are an expert registered dietitian and food nutrition analyst for Plate, an iOS calorie tracker app.
Analyze the user's meal from the provided food photo and/or user notes (such as gram weights, home-cooked ingredients, sauces, oils, or portion details).

Rules:
1. If the user specifies exact gram weights, volumes, brands, or ingredients they put into the dish, prioritize those measurements accurately while using the photo to estimate any remaining visible items.
2. Break the meal down into individual food/ingredient items with realistic gram estimates, calories, protein (g), carbs (g), and fat (g).
3. Ensure the top-level calories, protein, carbs, and fat equal the sum of the individual items (rounded to nearest whole integer for calories, 1 decimal or integer for macros).
4. Include a "healthScore" integer from 1 to 10 based on nutrient density, whole foods, protein balance, and fiber.
5. Return ONLY valid JSON matching this exact structure:
{
  "title": "Concise appetizing meal name",
  "summary": "1-2 sentence explanation of portion assumptions and key calorie drivers",
  "confidence": "high" | "medium" | "low",
  "healthScore": 8,
  "calories": 550,
  "protein": 38,
  "carbs": 45,
  "fat": 22,
  "items": [
    {
      "name": "Chicken breast (grilled)",
      "grams": 180,
      "portion": "180g (~1 medium fillet)",
      "calories": 297,
      "protein": 55.8,
      "carbs": 0,
      "fat": 6.5
    }
  ]
}"""


class AnalyzedFoodItem(BaseModel):
    id: Optional[str] = None
    name: str = Field(description="Name of the ingredient or dish component")
    grams: Optional[float] = Field(
        default=None, description="Estimated or user-provided weight in grams"
    )
    portion: Optional[str] = Field(
        default=None,
        description="Human-friendly portion description, e.g. '150g' or '1 tbsp'",
    )
    calories: float = Field(description="Calories (kcal) for this item")
    protein: float = Field(description="Protein in grams")
    carbs: float = Field(description="Carbohydrates in grams")
    fat: float = Field(description="Fat in grams")


class MealAnalysisPayload(BaseModel):
    title: str = Field(description="Concise meal name")
    summary: str = Field(
        description="Brief explanation of how calories and macros were estimated"
    )
    confidence: Literal["high", "medium", "low"] = Field(default="medium")
    healthScore: Optional[int] = Field(
        default=7, description="Nutritional quality score from 1 to 10"
    )
    calories: float
    protein: float
    carbs: float
    fat: float
    items: list[AnalyzedFoodItem]


class AnalyzeRequest(BaseModel):
    provider: Literal["antigravity", "claude", "gpt"] = "antigravity"
    imageBase64: Optional[str] = None
    mimeType: str = "image/jpeg"
    userNotes: Optional[str] = None
    mealType: Optional[str] = None
    apiKey: Optional[str] = None
    model: Optional[str] = None


APP_VERSION = "1.1.3"

app = FastAPI(title="CalorieLens Companion Backend", version=APP_VERSION)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Persistent Local OAuth State (gitignored in backend/.oauth_state.json)
# ---------------------------------------------------------------------------


def _default_oauth_store() -> dict[str, Any]:
    return {
        "ext_agent_host_id": f"urn:uuid:{uuid.uuid4()}",
        "openai": {},
        "google": {},
        "pending_flows": {},
    }


def load_oauth_store() -> dict[str, Any]:
    store = _default_oauth_store()
    if OAUTH_STATE_PATH.exists():
        try:
            raw = json.loads(OAUTH_STATE_PATH.read_text(encoding="utf-8"))
            if isinstance(raw, dict):
                store.update(raw)
        except Exception:
            pass

    if not store.get("ext_agent_host_id"):
        store["ext_agent_host_id"] = f"urn:uuid:{uuid.uuid4()}"
    if not isinstance(store.get("openai"), dict):
        store["openai"] = {}
    if not isinstance(store.get("google"), dict):
        store["google"] = {}
    if not isinstance(store.get("pending_flows"), dict):
        store["pending_flows"] = {}

    # Prune stale pending PKCE flows older than 20 minutes
    now = time.time()
    stale = [
        k
        for k, v in store["pending_flows"].items()
        if not isinstance(v, dict) or now - float(v.get("created_at", 0)) > 1200
    ]
    for k in stale:
        store["pending_flows"].pop(k, None)

    return store


def save_oauth_store(store: dict[str, Any]) -> None:
    OAUTH_STATE_PATH.write_text(json.dumps(store, indent=2), encoding="utf-8")


def generate_pkce_pair() -> tuple[str, str]:
    verifier = secrets.token_urlsafe(48)
    digest = hashlib.sha256(verifier.encode("ascii")).digest()
    challenge = base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii")
    return verifier, challenge


def decode_jwt_claims(token: Optional[str]) -> dict[str, Any]:
    if not token or token.count(".") < 2:
        return {}
    try:
        payload_b64 = token.split(".")[1]
        padded = payload_b64 + "=" * (-len(payload_b64) % 4)
        decoded = base64.urlsafe_b64decode(padded.encode("ascii")).decode("utf-8")
        data = json.loads(decoded)
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def get_server_port() -> int:
    return int(os.getenv("PORT", "8787"))


def render_oauth_result_html(
    *,
    ok: bool,
    provider_label: str,
    provider_key: str,
    headline: str,
    detail: str,
) -> HTMLResponse:
    accent = "#10B981" if ok else "#EF4444"
    badge_bg = "rgba(16, 185, 129, 0.14)" if ok else "rgba(239, 68, 68, 0.14)"
    icon = "✓" if ok else "!"
    safe_headline = html.escape(headline)
    safe_detail = html.escape(detail)
    safe_provider = html.escape(provider_label)
    payload_json = json.dumps(
        {
            "type": "CALORIELENS_OAUTH_COMPLETE",
            "provider": provider_key,
            "ok": ok,
            "headline": headline,
            "detail": detail,
        }
    )

    page = f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>CalorieLens · {safe_provider}</title>
  <style>
    body {{
      margin: 0;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      background: #07090E;
      color: #F8FAFC;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      padding: 20px;
    }}
    .card {{
      max-width: 390px;
      width: 100%;
      background: #101520;
      border: 1px solid rgba(255,255,255,0.09);
      border-radius: 24px;
      padding: 28px 24px;
      text-align: center;
      box-shadow: 0 24px 48px rgba(0,0,0,0.45);
    }}
    .badge {{
      width: 54px;
      height: 54px;
      border-radius: 27px;
      background: {badge_bg};
      color: {accent};
      font-size: 26px;
      font-weight: 800;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      margin-bottom: 14px;
      border: 1px solid {accent};
    }}
    h1 {{
      margin: 0 0 8px;
      font-size: 20px;
      font-weight: 800;
      letter-spacing: -0.3px;
    }}
    p {{
      margin: 0 0 20px;
      font-size: 13.5px;
      line-height: 1.5;
      color: #94A3B8;
      word-break: break-word;
    }}
    .btn {{
      display: inline-block;
      background: {accent};
      color: #FFFFFF;
      text-decoration: none;
      font-weight: 700;
      font-size: 13.5px;
      padding: 11px 22px;
      border-radius: 999px;
      border: none;
      cursor: pointer;
    }}
  </style>
</head>
<body>
  <div class="card">
    <div class="badge">{icon}</div>
    <h1>{safe_headline}</h1>
    <p>{safe_detail}</p>
    <button class="btn" onclick="finishWindow()">Return to CalorieLens</button>
  </div>
  <script>
    const payload = {payload_json};
    try {{
      if (window.opener && !window.opener.closed) {{
        window.opener.postMessage(payload, "*");
      }}
    }} catch (e) {{}}
    function finishWindow() {{
      window.close();
      setTimeout(function() {{
        window.location.href = "http://localhost:8081";
      }}, 250);
    }}
    if (payload.ok) {{
      setTimeout(function() {{
        if (window.opener && !window.opener.closed) {{
          window.close();
        }}
      }}, 1100);
    }}
  </script>
</body>
</html>"""
    return HTMLResponse(content=page, status_code=200 if ok else 400)


# ---------------------------------------------------------------------------
# OpenAI "Sign in with ChatGPT" (SIWC) OAuth Helpers
# ---------------------------------------------------------------------------


def build_openai_authorize_url() -> tuple[str, str]:
    store = load_oauth_store()
    port = get_server_port()
    redirect_uri = f"http://127.0.0.1:{port}/api/oauth/openai/callback"

    verifier, challenge = generate_pkce_pair()
    state_token = secrets.token_urlsafe(24)
    nonce = secrets.token_urlsafe(24)

    env_client_id = (os.getenv("OPENAI_OAUTH_CLIENT_ID") or "").strip()
    saved_client_id = str(store["openai"].get("client_id") or "").strip()
    effective_client_id = env_client_id or saved_client_id or "dynamic_agent_client"

    params: dict[str, str] = {
        "client_id": effective_client_id,
        "ext_agent_host_id": str(store["ext_agent_host_id"]),
        "response_type": "code",
        "redirect_uri": redirect_uri,
        "scope": OPENAI_SCOPES,
        "resource": OPENAI_RESOURCE,
        "state": state_token,
        "nonce": nonce,
        "code_challenge": challenge,
        "code_challenge_method": "S256",
    }
    if effective_client_id == "dynamic_agent_client":
        params["agent_name_hint"] = "CalorieLens"

    store["pending_flows"][state_token] = {
        "provider": "openai",
        "code_verifier": verifier,
        "nonce": nonce,
        "redirect_uri": redirect_uri,
        "client_id_sent": effective_client_id,
        "created_at": time.time(),
    }
    save_oauth_store(store)

    auth_url = f"{OPENAI_AUTH_URL}?{urllib.parse.urlencode(params)}"
    return auth_url, redirect_uri


async def get_valid_openai_oauth_token() -> Optional[str]:
    store = load_oauth_store()
    oai = store.get("openai") or {}
    access_token = str(oai.get("access_token") or "").strip()
    refresh_token = str(oai.get("refresh_token") or "").strip()
    client_id = str(
        os.getenv("OPENAI_OAUTH_CLIENT_ID") or oai.get("client_id") or ""
    ).strip()
    expires_at = float(oai.get("expires_at") or 0)

    if access_token and (expires_at == 0 or expires_at - 60 > time.time()):
        return access_token

    if not refresh_token or not client_id:
        return None

    async with httpx.AsyncClient(timeout=25.0) as client:
        res = await client.post(
            OPENAI_TOKEN_URL,
            data={
                "grant_type": "refresh_token",
                "client_id": client_id,
                "refresh_token": refresh_token,
                "resource": OPENAI_RESOURCE,
            },
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        )
        if res.status_code >= 400:
            return None
        token_data = res.json()

    new_access = str(token_data.get("access_token") or "").strip()
    if not new_access:
        return None

    oai["access_token"] = new_access
    if token_data.get("refresh_token"):
        oai["refresh_token"] = token_data["refresh_token"]
    expires_in = int(token_data.get("expires_in") or 3600)
    oai["expires_at"] = time.time() + expires_in
    if token_data.get("scope"):
        oai["scope"] = token_data["scope"]
    store["openai"] = oai
    save_oauth_store(store)
    return new_access


# ---------------------------------------------------------------------------
# Google OAuth 2.0 PKCE Helpers (when GOOGLE_OAUTH_CLIENT_ID is configured)
# ---------------------------------------------------------------------------


def build_google_authorize_url(override_client_id: Optional[str] = None) -> tuple[str, str]:
    store = load_oauth_store()
    client_id = (
        (override_client_id or "").strip()
        or (os.getenv("GOOGLE_OAUTH_CLIENT_ID") or "").strip()
        or str(store["google"].get("client_id") or "").strip()
    )
    if not client_id:
        raise HTTPException(
            status_code=400,
            detail="GOOGLE_OAUTH_CLIENT_ID is not set. Authorize on Google AI Studio (aistudio.google.com/apikey) or provide a Google Cloud OAuth Client ID.",
        )

    port = get_server_port()
    redirect_uri = f"http://127.0.0.1:{port}/api/oauth/google/callback"
    verifier, challenge = generate_pkce_pair()
    state_token = secrets.token_urlsafe(24)

    params = {
        "client_id": client_id,
        "redirect_uri": redirect_uri,
        "response_type": "code",
        "scope": GOOGLE_SCOPES,
        "access_type": "offline",
        "prompt": "consent",
        "state": state_token,
        "code_challenge": challenge,
        "code_challenge_method": "S256",
    }

    store["google"]["client_id"] = client_id
    store["pending_flows"][state_token] = {
        "provider": "google",
        "code_verifier": verifier,
        "redirect_uri": redirect_uri,
        "client_id_sent": client_id,
        "created_at": time.time(),
    }
    save_oauth_store(store)
    return f"{GOOGLE_AUTH_URL}?{urllib.parse.urlencode(params)}", redirect_uri


async def get_valid_google_oauth_token() -> Optional[str]:
    store = load_oauth_store()
    g_state = store.get("google") or {}
    access_token = str(g_state.get("access_token") or "").strip()
    refresh_token = str(g_state.get("refresh_token") or "").strip()
    client_id = str(
        os.getenv("GOOGLE_OAUTH_CLIENT_ID") or g_state.get("client_id") or ""
    ).strip()
    expires_at = float(g_state.get("expires_at") or 0)

    if access_token and (expires_at == 0 or expires_at - 60 > time.time()):
        return access_token

    if not refresh_token or not client_id:
        return None

    form: dict[str, str] = {
        "grant_type": "refresh_token",
        "client_id": client_id,
        "refresh_token": refresh_token,
    }
    client_secret = (os.getenv("GOOGLE_OAUTH_CLIENT_SECRET") or "").strip()
    if client_secret:
        form["client_secret"] = client_secret

    async with httpx.AsyncClient(timeout=25.0) as client:
        res = await client.post(
            GOOGLE_TOKEN_URL,
            data=form,
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        )
        if res.status_code >= 400:
            return None
        token_data = res.json()

    new_access = str(token_data.get("access_token") or "").strip()
    if not new_access:
        return None
    g_state["access_token"] = new_access
    expires_in = int(token_data.get("expires_in") or 3600)
    g_state["expires_at"] = time.time() + expires_in
    store["google"] = g_state
    save_oauth_store(store)
    return new_access


# ---------------------------------------------------------------------------
# General Helpers
# ---------------------------------------------------------------------------


def get_lan_ips() -> list[str]:
    ips: list[str] = []
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        if ip and not ip.startswith("127."):
            ips.append(ip)
    except Exception:
        pass
    return ips


def detect_antigravity_auth(store: dict[str, Any]) -> tuple[bool, bool]:
    cli_found = shutil.which("agy") is not None
    has_env_gemini = bool((os.getenv("GEMINI_API_KEY") or "").strip())
    has_vertex = bool(
        (os.getenv("GOOGLE_CLOUD_PROJECT") or "").strip()
        and (os.getenv("GOOGLE_CLOUD_LOCATION") or "").strip()
    )
    has_google_oauth = bool((store.get("google") or {}).get("access_token"))
    # LocalAgentConfig requires GEMINI_API_KEY, Vertex project+location, or Google OAuth token
    ready = has_env_gemini or has_vertex or has_google_oauth
    return cli_found, ready


def verify_companion_token(authorization: Optional[str]) -> None:
    expected = (os.getenv("COMPANION_AUTH_TOKEN") or "").strip()
    if not expected:
        return
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing Companion Bearer token.")
    provided = authorization.removeprefix("Bearer ").strip()
    if provided != expected:
        raise HTTPException(status_code=401, detail="Invalid Companion Bearer token.")


def strip_data_url(b64: str) -> str:
    if "," in b64 and b64.strip().startswith("data:"):
        return b64.split(",", 1)[1]
    return b64.strip()


def extract_json_object(raw_text: str) -> dict:
    cleaned = raw_text.strip()
    fence_match = re.search(
        r"```(?:json)?\s*(\{.*?\})\s*```", cleaned, flags=re.DOTALL
    )
    if fence_match:
        cleaned = fence_match.group(1)
    else:
        first = cleaned.find("{")
        last = cleaned.rfind("}")
        if first != -1 and last != -1 and last > first:
            cleaned = cleaned[first : last + 1]
    return json.loads(cleaned)


def extract_openai_responses_text(data: dict[str, Any]) -> str:
    if isinstance(data.get("output_text"), str) and data["output_text"].strip():
        return data["output_text"]
    chunks: list[str] = []
    for item in data.get("output") or []:
        if not isinstance(item, dict):
            continue
        for block in item.get("content") or []:
            if isinstance(block, dict) and isinstance(block.get("text"), str):
                chunks.append(block["text"])
    return "".join(chunks)


def normalize_result(raw: dict, provider: str, model_used: str) -> dict:
    raw_items = raw.get("items") or []
    normalized_items = []
    for idx, item in enumerate(raw_items):
        if not isinstance(item, dict):
            continue
        grams_val = item.get("grams")
        try:
            grams_num = round(float(grams_val), 1) if grams_val is not None else None
        except (TypeError, ValueError):
            grams_num = None

        normalized_items.append(
            {
                "id": str(item.get("id") or f"item_{uuid.uuid4().hex[:8]}_{idx}"),
                "name": str(item.get("name") or f"Item {idx + 1}"),
                "grams": grams_num,
                "portion": item.get("portion")
                or (f"{grams_num:g}g" if grams_num else None),
                "calories": max(0, round(float(item.get("calories") or 0))),
                "protein": max(0.0, round(float(item.get("protein") or 0), 1)),
                "carbs": max(0.0, round(float(item.get("carbs") or 0), 1)),
                "fat": max(0.0, round(float(item.get("fat") or 0), 1)),
            }
        )

    if normalized_items:
        total_cal = round(sum(i["calories"] for i in normalized_items))
        total_pro = round(sum(i["protein"] for i in normalized_items), 1)
        total_carbs = round(sum(i["carbs"] for i in normalized_items), 1)
        total_fat = round(sum(i["fat"] for i in normalized_items), 1)
    else:
        total_cal = max(0, round(float(raw.get("calories") or 0)))
        total_pro = max(0.0, round(float(raw.get("protein") or 0), 1))
        total_carbs = max(0.0, round(float(raw.get("carbs") or 0), 1))
        total_fat = max(0.0, round(float(raw.get("fat") or 0), 1))

    conf = str(raw.get("confidence") or "medium").lower()
    if conf not in ("high", "medium", "low"):
        conf = "medium"

    raw_hs = raw.get("healthScore")
    try:
        health_score = (
            max(1, min(10, round(float(raw_hs)))) if raw_hs is not None else None
        )
    except (TypeError, ValueError):
        health_score = None

    return {
        "title": str(raw.get("title") or "Analyzed Meal"),
        "summary": str(
            raw.get("summary") or "Estimated calories and macros from your meal."
        ),
        "confidence": conf,
        "healthScore": health_score,
        "calories": total_cal,
        "protein": total_pro,
        "carbs": total_carbs,
        "fat": total_fat,
        "items": normalized_items,
        "providerUsed": provider,
        "modelUsed": model_used,
    }


def build_user_prompt(
    meal_type: Optional[str], user_notes: Optional[str], has_image: bool
) -> str:
    lines = [
        "Please analyze this meal and return the JSON breakdown of calories and macros."
    ]
    if meal_type:
        lines.append(f"Meal category: {meal_type}")
    if user_notes and user_notes.strip():
        lines.append(
            f"User-provided details (ingredients, gram weights, cooking method, sauces): {user_notes.strip()}"
        )
    elif has_image:
        lines.append(
            "No extra text details provided; estimate portions visually from the photo."
        )
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Status & OAuth Endpoints
# ---------------------------------------------------------------------------


@app.get("/api/status")
async def get_status(authorization: Optional[str] = Header(default=None)):
    verify_companion_token(authorization)
    store = load_oauth_store()
    cli_detected, agy_ready = detect_antigravity_auth(store)
    port = get_server_port()
    lan_urls = [f"http://{ip}:{port}" for ip in get_lan_ips()]

    oai = store.get("openai") or {}
    chatgpt_connected = bool(oai.get("access_token") or oai.get("refresh_token"))
    chatgpt_scope = str(oai.get("scope") or "")

    g_state = store.get("google") or {}
    google_client_configured = bool(
        (os.getenv("GOOGLE_OAUTH_CLIENT_ID") or "").strip()
        or g_state.get("client_id")
    )
    google_connected = bool(g_state.get("access_token") or g_state.get("refresh_token"))

    gpt_ready = chatgpt_connected or bool((os.getenv("OPENAI_API_KEY") or "").strip())

    return {
        "ok": True,
        "service": "CalorieLens Companion Backend",
        "version": APP_VERSION,
        "antigravitySdkInstalled": HAS_ANTIGRAVITY_SDK,
        "antigravityCliDetected": cli_detected,
        "antigravityReady": agy_ready,
        "lanUrls": lan_urls,
        "chatgptOAuth": {
            "connected": chatgpt_connected,
            "email": oai.get("email"),
            "name": oai.get("name"),
            "directTokensScope": "chatgpt.tokens.use.direct" in chatgpt_scope
            if chatgpt_scope
            else chatgpt_connected,
        },
        "googleOAuth": {
            "configured": google_client_configured,
            "connected": google_connected,
            "email": g_state.get("email"),
        },
        "serverProviders": {
            "antigravity": agy_ready,
            "claude": bool((os.getenv("ANTHROPIC_API_KEY") or "").strip()),
            "gpt": gpt_ready,
            "gemini": bool((os.getenv("GEMINI_API_KEY") or "").strip()) or google_connected,
        },
        "message": (
            f"Signed in to ChatGPT ({oai.get('email') or 'OpenAI SSO'})"
            if chatgpt_connected
            else (
                "Antigravity SDK ready on Companion Server."
                if agy_ready
                else "Companion Server online. Authorize your AI provider to begin."
            )
        ),
    }


@app.get("/api/oauth/openai/start")
async def openai_oauth_start():
    auth_url, _ = build_openai_authorize_url()
    return RedirectResponse(url=auth_url, status_code=302)


@app.get("/api/oauth/openai/url")
async def openai_oauth_url(authorization: Optional[str] = Header(default=None)):
    verify_companion_token(authorization)
    auth_url, redirect_uri = build_openai_authorize_url()
    return {"authUrl": auth_url, "redirectUri": redirect_uri}


@app.post("/api/oauth/openai/open-on-host")
async def openai_oauth_open_on_host(authorization: Optional[str] = Header(default=None)):
    verify_companion_token(authorization)
    auth_url, redirect_uri = build_openai_authorize_url()
    opened = webbrowser.open(auth_url)
    return {"opened": bool(opened), "authUrl": auth_url, "redirectUri": redirect_uri}


@app.get("/api/oauth/openai/callback")
async def openai_oauth_callback(
    code: Optional[str] = Query(default=None),
    state: Optional[str] = Query(default=None),
    client_id: Optional[str] = Query(default=None),
    scope: Optional[str] = Query(default=None),
    error: Optional[str] = Query(default=None),
    error_description: Optional[str] = Query(default=None),
):
    if error:
        return render_oauth_result_html(
            ok=False,
            provider_label="OpenAI ChatGPT",
            provider_key="gpt",
            headline="ChatGPT Authorization Declined",
            detail=error_description or error,
        )

    store = load_oauth_store()
    pending = (store.get("pending_flows") or {}).pop(state or "", None)
    if not pending or not code:
        return render_oauth_result_html(
            ok=False,
            provider_label="OpenAI ChatGPT",
            provider_key="gpt",
            headline="Session Expired or Invalid State",
            detail="Please start the Sign in with ChatGPT flow again from CalorieLens.",
        )

    # Save dynamically issued oaiapp_... client_id per OpenAI SIWC specification
    issued_client_id = (client_id or "").strip()
    saved_client_id = str(store["openai"].get("client_id") or "").strip()
    effective_client_id = (
        issued_client_id
        or saved_client_id
        or str(pending.get("client_id_sent") or "")
    )
    if issued_client_id:
        store["openai"]["client_id"] = issued_client_id
    save_oauth_store(store)

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            res = await client.post(
                OPENAI_TOKEN_URL,
                data={
                    "grant_type": "authorization_code",
                    "client_id": effective_client_id,
                    "code": code,
                    "redirect_uri": pending["redirect_uri"],
                    "code_verifier": pending["code_verifier"],
                    "resource": OPENAI_RESOURCE,
                },
                headers={"Content-Type": "application/x-www-form-urlencoded"},
            )
            if res.status_code >= 400:
                return render_oauth_result_html(
                    ok=False,
                    provider_label="OpenAI ChatGPT",
                    provider_key="gpt",
                    headline="Token Exchange Failed",
                    detail=f"OpenAI returned {res.status_code}: {res.text[:240]}",
                )
            token_data = res.json()
    except Exception as exc:
        return render_oauth_result_html(
            ok=False,
            provider_label="OpenAI ChatGPT",
            provider_key="gpt",
            headline="Network Error Contacting OpenAI",
            detail=str(exc),
        )

    id_claims = decode_jwt_claims(token_data.get("id_token")) or decode_jwt_claims(
        token_data.get("access_token")
    )
    email = id_claims.get("email")
    name = id_claims.get("name")
    expires_in = int(token_data.get("expires_in") or 3600)

    store["openai"] = {
        "client_id": effective_client_id,
        "access_token": token_data.get("access_token"),
        "refresh_token": token_data.get("refresh_token"),
        "expires_at": time.time() + expires_in,
        "scope": token_data.get("scope") or scope or "",
        "email": email,
        "name": name,
    }
    save_oauth_store(store)

    identity_note = f"Signed in as {email}." if email else "Your ChatGPT account is now authorized."
    return render_oauth_result_html(
        ok=True,
        provider_label="OpenAI ChatGPT",
        provider_key="gpt",
        headline="ChatGPT Connected",
        detail=f"{identity_note} You can return to CalorieLens.",
    )


@app.post("/api/oauth/openai/logout")
async def openai_oauth_logout(authorization: Optional[str] = Header(default=None)):
    verify_companion_token(authorization)
    store = load_oauth_store()
    # Keep dynamically registered oaiapp_... client_id for future logins per OpenAI spec
    preserved_client_id = (store.get("openai") or {}).get("client_id")
    store["openai"] = {"client_id": preserved_client_id} if preserved_client_id else {}
    save_oauth_store(store)
    return {"ok": True}


@app.get("/api/oauth/google/start")
async def google_oauth_start(client_id: Optional[str] = Query(default=None)):
    auth_url, _ = build_google_authorize_url(client_id)
    return RedirectResponse(url=auth_url, status_code=302)


@app.get("/api/oauth/google/callback")
async def google_oauth_callback(
    code: Optional[str] = Query(default=None),
    state: Optional[str] = Query(default=None),
    error: Optional[str] = Query(default=None),
):
    if error:
        return render_oauth_result_html(
            ok=False,
            provider_label="Google AI",
            provider_key="antigravity",
            headline="Google Sign-In Cancelled",
            detail=error,
        )

    store = load_oauth_store()
    pending = (store.get("pending_flows") or {}).pop(state or "", None)
    if not pending or not code:
        return render_oauth_result_html(
            ok=False,
            provider_label="Google AI",
            provider_key="antigravity",
            headline="Invalid or Expired OAuth State",
            detail="Please start Google Sign-In again from CalorieLens.",
        )

    client_id = str(pending.get("client_id_sent") or "")
    form: dict[str, str] = {
        "grant_type": "authorization_code",
        "client_id": client_id,
        "code": code,
        "redirect_uri": pending["redirect_uri"],
        "code_verifier": pending["code_verifier"],
    }
    client_secret = (os.getenv("GOOGLE_OAUTH_CLIENT_SECRET") or "").strip()
    if client_secret:
        form["client_secret"] = client_secret

    async with httpx.AsyncClient(timeout=30.0) as client:
        res = await client.post(
            GOOGLE_TOKEN_URL,
            data=form,
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        )
        if res.status_code >= 400:
            return render_oauth_result_html(
                ok=False,
                provider_label="Google AI",
                provider_key="antigravity",
                headline="Google Token Exchange Failed",
                detail=f"Google returned {res.status_code}: {res.text[:240]}",
            )
        token_data = res.json()

    claims = decode_jwt_claims(token_data.get("id_token"))
    email = claims.get("email")
    expires_in = int(token_data.get("expires_in") or 3600)

    store["google"] = {
        "client_id": client_id,
        "access_token": token_data.get("access_token"),
        "refresh_token": token_data.get("refresh_token")
        or (store.get("google") or {}).get("refresh_token"),
        "expires_at": time.time() + expires_in,
        "email": email,
    }
    save_oauth_store(store)

    return render_oauth_result_html(
        ok=True,
        provider_label="Google AI",
        provider_key="antigravity",
        headline="Google Account Connected",
        detail=f"Signed in as {email or 'Google User'}. Return to CalorieLens.",
    )


@app.post("/api/oauth/google/logout")
async def google_oauth_logout(authorization: Optional[str] = Header(default=None)):
    verify_companion_token(authorization)
    store = load_oauth_store()
    preserved_cid = (store.get("google") or {}).get("client_id")
    store["google"] = {"client_id": preserved_cid} if preserved_cid else {}
    save_oauth_store(store)
    return {"ok": True}


# ---------------------------------------------------------------------------
# Meal Analysis Providers
# ---------------------------------------------------------------------------


async def analyze_with_antigravity(
    req: AnalyzeRequest, image_bytes: Optional[bytes]
) -> dict:
    effective_key = (req.apiKey or os.getenv("GEMINI_API_KEY") or "").strip() or None
    has_vertex = bool(
        (os.getenv("GOOGLE_CLOUD_PROJECT") or "").strip()
        and (os.getenv("GOOGLE_CLOUD_LOCATION") or "").strip()
    )
    user_prompt = build_user_prompt(
        req.mealType, req.userNotes, image_bytes is not None
    )

    # 1. Google Antigravity SDK when GEMINI_API_KEY / apiKey or Vertex AI is configured
    if HAS_ANTIGRAVITY_SDK and ga is not None and (effective_key or has_vertex):
        try:
            config_kwargs: dict[str, Any] = {
                "system_instructions": NUTRITION_SYSTEM_PROMPT,
                "response_schema": MealAnalysisPayload,
            }
            if effective_key:
                config_kwargs["api_key"] = effective_key
            if req.model:
                config_kwargs["model"] = req.model

            config = ga.LocalAgentConfig(**config_kwargs)
            async with ga.Agent(config) as agent:
                prompt_parts: list[Any] = []
                if image_bytes:
                    prompt_parts.append(
                        ga.Image(
                            data=image_bytes, mime_type=req.mimeType or "image/jpeg"
                        )
                    )
                prompt_parts.append(user_prompt)

                response = await agent.chat(prompt_parts)
                structured = await response.structured_output()
                if structured is not None:
                    if hasattr(structured, "model_dump"):
                        parsed = structured.model_dump()
                    elif isinstance(structured, dict):
                        parsed = structured
                    else:
                        parsed = json.loads(str(structured))
                else:
                    text_out = await response.text()
                    parsed = extract_json_object(text_out)

                return normalize_result(
                    parsed, "antigravity", req.model or "google-antigravity-agent"
                )
        except Exception as agy_err:
            if not effective_key:
                raise HTTPException(
                    status_code=502,
                    detail=f"Antigravity SDK error: {agy_err}",
                ) from agy_err

    # 2. Direct Gemini REST API (either via authorized Gemini key OR Google OAuth Bearer token)
    google_oauth_token = None if effective_key else await get_valid_google_oauth_token()
    if not effective_key and not google_oauth_token:
        raise HTTPException(
            status_code=401,
            detail="Google Antigravity / Gemini is not authorized yet. Tap 'Authorize on Google AI Studio' in Settings to connect your Google account.",
        )

    model_name = req.model or "gemini-2.5-flash"
    parts: list[dict[str, Any]] = []
    if image_bytes:
        parts.append(
            {
                "inline_data": {
                    "mime_type": req.mimeType or "image/jpeg",
                    "data": base64.b64encode(image_bytes).decode("ascii"),
                }
            }
        )
    parts.append({"text": f"{NUTRITION_SYSTEM_PROMPT}\n\n{user_prompt}"})

    headers: dict[str, str] = {"Content-Type": "application/json"}
    if effective_key:
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{model_name}:generateContent?key={effective_key}"
    else:
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{model_name}:generateContent"
        headers["Authorization"] = f"Bearer {google_oauth_token}"

    async with httpx.AsyncClient(timeout=60.0) as client:
        res = await client.post(
            url,
            headers=headers,
            json={
                "contents": [{"parts": parts}],
                "generationConfig": {
                    "responseMimeType": "application/json",
                    "temperature": 0.2,
                },
            },
        )
        if res.status_code >= 400:
            raise HTTPException(
                status_code=res.status_code, detail=f"Gemini API error: {res.text}"
            )
        data = res.json()
        text_content = data["candidates"][0]["content"]["parts"][0]["text"]
        parsed = extract_json_object(text_content)
        return normalize_result(parsed, "antigravity", model_name)


async def analyze_with_claude(
    req: AnalyzeRequest, image_bytes: Optional[bytes]
) -> dict:
    api_key = (req.apiKey or os.getenv("ANTHROPIC_API_KEY") or "").strip()
    if not api_key:
        raise HTTPException(
            status_code=401,
            detail="Claude is not authorized yet. Open console.anthropic.com from Settings to authorize an Anthropic key.",
        )
    model_name = req.model or "claude-sonnet-4-20250514"
    user_prompt = build_user_prompt(
        req.mealType, req.userNotes, image_bytes is not None
    )

    content_blocks: list[dict[str, Any]] = []
    if image_bytes:
        content_blocks.append(
            {
                "type": "image",
                "source": {
                    "type": "base64",
                    "media_type": req.mimeType or "image/jpeg",
                    "data": base64.b64encode(image_bytes).decode("ascii"),
                },
            }
        )
    content_blocks.append({"type": "text", "text": user_prompt})

    async with httpx.AsyncClient(timeout=60.0) as client:
        res = await client.post(
            "https://api.anthropic.com/v1/messages",
            headers={
                "x-api-key": api_key,
                "anthropic-version": "2023-06-01",
                "content-type": "application/json",
            },
            json={
                "model": model_name,
                "max_tokens": 1600,
                "temperature": 0.2,
                "system": NUTRITION_SYSTEM_PROMPT,
                "messages": [{"role": "user", "content": content_blocks}],
            },
        )
        if res.status_code >= 400:
            raise HTTPException(
                status_code=res.status_code, detail=f"Claude API error: {res.text}"
            )
        data = res.json()
        text_out = "".join(
            block.get("text", "")
            for block in data.get("content", [])
            if block.get("type") == "text"
        )
        parsed = extract_json_object(text_out)
        return normalize_result(parsed, "claude", model_name)


async def analyze_with_gpt(req: AnalyzeRequest, image_bytes: Optional[bytes]) -> dict:
    api_key = (req.apiKey or os.getenv("OPENAI_API_KEY") or "").strip()
    model_name = req.model or "gpt-4o"
    user_prompt = build_user_prompt(
        req.mealType, req.userNotes, image_bytes is not None
    )

    # 1. Explicit OpenAI API Key -> /v1/chat/completions
    if api_key:
        user_content: list[dict[str, Any]] = [{"type": "text", "text": user_prompt}]
        if image_bytes:
            b64_str = base64.b64encode(image_bytes).decode("ascii")
            mime = req.mimeType or "image/jpeg"
            user_content.append(
                {
                    "type": "image_url",
                    "image_url": {"url": f"data:{mime};base64,{b64_str}"},
                }
            )

        async with httpx.AsyncClient(timeout=60.0) as client:
            res = await client.post(
                "https://api.openai.com/v1/chat/completions",
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": model_name,
                    "temperature": 0.2,
                    "response_format": {"type": "json_object"},
                    "messages": [
                        {"role": "system", "content": NUTRITION_SYSTEM_PROMPT},
                        {"role": "user", "content": user_content},
                    ],
                },
            )
            if res.status_code >= 400:
                raise HTTPException(
                    status_code=res.status_code, detail=f"OpenAI API error: {res.text}"
                )
            data = res.json()
            text_out = data["choices"][0]["message"]["content"]
            parsed = extract_json_object(text_out)
            return normalize_result(parsed, "gpt", model_name)

    # 2. Official "Sign in with ChatGPT" (SIWC) OAuth Bearer Token -> /v1/responses
    oauth_token = await get_valid_openai_oauth_token()
    if oauth_token:
        responses_content: list[dict[str, Any]] = [
            {"type": "input_text", "text": user_prompt}
        ]
        if image_bytes:
            b64_str = base64.b64encode(image_bytes).decode("ascii")
            mime = req.mimeType or "image/jpeg"
            responses_content.append(
                {
                    "type": "input_image",
                    "image_url": f"data:{mime};base64,{b64_str}",
                    "detail": "auto",
                }
            )

        async with httpx.AsyncClient(timeout=60.0) as client:
            res = await client.post(
                "https://api.openai.com/v1/responses",
                headers={
                    "Authorization": f"Bearer {oauth_token}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": model_name,
                    "instructions": NUTRITION_SYSTEM_PROMPT,
                    "input": [{"role": "user", "content": responses_content}],
                    "text": {"format": {"type": "json_object"}},
                },
            )
            if res.status_code in (401, 403):
                raise HTTPException(
                    status_code=res.status_code,
                    detail=(
                        f"ChatGPT OAuth token rejected ({res.status_code}). "
                        "Direct ChatGPT plan token usage requires an eligible ChatGPT Plus/Pro plan with 'chatgpt.tokens.use.direct', "
                        "or you can authorize an OpenAI API key on platform.openai.com."
                    ),
                )
            if res.status_code >= 400:
                raise HTTPException(
                    status_code=res.status_code,
                    detail=f"OpenAI Responses API error: {res.text}",
                )
            data = res.json()
            text_out = extract_openai_responses_text(data)
            parsed = extract_json_object(text_out)
            return normalize_result(parsed, "gpt", f"{model_name} (ChatGPT SSO)")

    raise HTTPException(
        status_code=401,
        detail="GPT is not connected. Sign in with ChatGPT (OpenAI SSO) or authorize an API key on platform.openai.com.",
    )


@app.post("/api/analyze")
async def analyze_meal(
    req: AnalyzeRequest, authorization: Optional[str] = Header(default=None)
):
    verify_companion_token(authorization)

    if not req.imageBase64 and not (req.userNotes and req.userNotes.strip()):
        raise HTTPException(
            status_code=400,
            detail="Please provide a meal photo, ingredient details/grams, or both.",
        )

    image_bytes: Optional[bytes] = None
    if req.imageBase64:
        try:
            image_bytes = base64.b64decode(strip_data_url(req.imageBase64))
        except Exception as exc:
            raise HTTPException(
                status_code=400, detail=f"Invalid base64 image data: {exc}"
            ) from exc

    if req.provider == "antigravity":
        return await analyze_with_antigravity(req, image_bytes)
    if req.provider == "claude":
        return await analyze_with_claude(req, image_bytes)
    if req.provider == "gpt":
        return await analyze_with_gpt(req, image_bytes)

    raise HTTPException(status_code=400, detail=f"Unsupported provider: {req.provider}")


if __name__ == "__main__":
    import uvicorn

    host = os.getenv("HOST", "0.0.0.0")
    port = get_server_port()
    lan_ips = get_lan_ips()
    print("\n====================================================")
    print("  CalorieLens Companion Backend (Antigravity + SSO)")
    print(f"  Local URL:   http://localhost:{port}")
    print(f"  OAuth Loop:  http://127.0.0.1:{port}/api/oauth/openai/callback")
    for ip in lan_ips:
        print(f"  iPhone LAN:  http://{ip}:{port}")
    print("====================================================\n")
    uvicorn.run(app, host=host, port=port)
