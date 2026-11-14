import * as Clipboard from 'expo-clipboard';
import * as Crypto from 'expo-crypto';
import * as WebBrowser from 'expo-web-browser';
import { Platform } from 'react-native';
import {
  isLoopbackOAuthSupported,
  startLoopbackOAuthServer,
  stopLoopbackOAuthServer,
  waitForLoopbackOAuthCallback,
} from '../../modules/expo-loopback-oauth';
import { computeHealthScoreFromMacros } from '../constants/plateCatalog';
import { getAppVersionMetadata } from '../constants/version';
import {
  AIMealAnalysisResult,
  AIProviderId,
  ChatGPTOnDeviceSession,
  CompanionStatusResponse,
  MealItem,
  MealType,
  ProviderAuthConfig,
} from '../types/models';
import {
  loadAuthConfig,
  loadPendingChatGPTPkce,
  saveAuthConfig,
  savePendingChatGPTPkce,
} from './storage';

WebBrowser.maybeCompleteAuthSession();

export const PROVIDER_AUTH_PORTALS = {
  antigravity: 'https://aistudio.google.com/apikey',
  claude: 'https://console.anthropic.com/settings/keys',
  gpt: 'https://platform.openai.com/api-keys',
} as const;

const OPENAI_SIWC_AUTH_URL = 'https://auth.openai.com/api/accounts/authorize';
const OPENAI_SIWC_TOKEN_URL = 'https://auth.openai.com/api/accounts/oauth/token';
const OPENAI_CODEX_AUTH_URL = 'https://auth.openai.com/oauth/authorize';
const OPENAI_CODEX_OAUTH_TOKEN_URL = 'https://auth.openai.com/oauth/token';
const OPENAI_CODEX_RESPONSES_URL =
  'https://chatgpt.com/backend-api/codex/responses';
const OPENAI_PUBLIC_RESPONSES_URL = 'https://api.openai.com/v1/responses';
const OPENAI_PUBLIC_MODELS_URL = 'https://api.openai.com/v1/models';
const OPENAI_DEVICE_USERCODE_URL =
  'https://auth.openai.com/api/accounts/deviceauth/usercode';
const OPENAI_DEVICE_TOKEN_URL =
  'https://auth.openai.com/api/accounts/deviceauth/token';
const OPENAI_DEVICE_VERIFY_URL = 'https://auth.openai.com/codex/device';
const OPENAI_DEVICE_CALLBACK_URI =
  'https://auth.openai.com/deviceauth/callback';
const OPENAI_CODEX_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';
const OPENAI_RESOURCE = 'https://api.openai.com/v1';
const OPENAI_SIWC_SCOPES =
  'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct';
const OPENAI_CODEX_SCOPES = 'openid profile email offline_access';
const DEFAULT_LOOPBACK_PORT = 1455;
const DEFAULT_LOOPBACK_REDIRECT = `http://localhost:${DEFAULT_LOOPBACK_PORT}/auth/callback`;

const BASE64_CHARS =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function bytesToBase64Url(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i] ?? 0;
    const b1 = i + 1 < bytes.length ? (bytes[i + 1] ?? 0) : 0;
    const b2 = i + 2 < bytes.length ? (bytes[i + 2] ?? 0) : 0;
    const triplet = (b0 << 16) | (b1 << 8) | b2;
    out += BASE64_CHARS[(triplet >> 18) & 0x3f];
    out += BASE64_CHARS[(triplet >> 12) & 0x3f];
    if (i + 1 < bytes.length) {
      out += BASE64_CHARS[(triplet >> 6) & 0x3f];
    }
    if (i + 2 < bytes.length) {
      out += BASE64_CHARS[triplet & 0x3f];
    }
  }
  return out.replace(/\+/g, '-').replace(/\//g, '_');
}

function base64UrlToUtf8(b64Url: string): string {
  const normalized = b64Url.replace(/-/g, '+').replace(/\//g, '/').replace(/_/g, '/');
  const padded =
    normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  const bytes: number[] = [];
  for (let i = 0; i < padded.length; i += 4) {
    const c0 = BASE64_CHARS.indexOf(padded[i] || 'A');
    const c1 = BASE64_CHARS.indexOf(padded[i + 1] || 'A');
    const c2 =
      padded[i + 2] === '=' ? -1 : BASE64_CHARS.indexOf(padded[i + 2] || 'A');
    const c3 =
      padded[i + 3] === '=' ? -1 : BASE64_CHARS.indexOf(padded[i + 3] || 'A');
    if (c0 < 0 || c1 < 0) break;
    const triplet =
      (c0 << 18) | (c1 << 12) | (Math.max(0, c2) << 6) | Math.max(0, c3);
    bytes.push((triplet >> 16) & 0xff);
    if (c2 >= 0) bytes.push((triplet >> 8) & 0xff);
    if (c3 >= 0) bytes.push(triplet & 0xff);
  }
  try {
    if (typeof TextDecoder !== 'undefined') {
      return new TextDecoder('utf-8').decode(new Uint8Array(bytes));
    }
  } catch {
    // fallback below
  }
  return String.fromCharCode(...bytes);
}

function decodeJwtClaims(token?: string | null): Record<string, unknown> {
  if (!token || token.split('.').length < 2) return {};
  try {
    const jsonStr = base64UrlToUtf8(token.split('.')[1] || '');
    const parsed = JSON.parse(jsonStr);
    return parsed && typeof parsed === 'object'
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function extractChatGPTAccountId(
  ...tokens: (string | null | undefined)[]
): string | undefined {
  for (const tok of tokens) {
    const claims = decodeJwtClaims(tok);
    const authClaim = claims['https://api.openai.com/auth'];
    if (authClaim && typeof authClaim === 'object') {
      const accId = (authClaim as Record<string, unknown>).chatgpt_account_id;
      if (typeof accId === 'string' && accId.trim()) {
        return accId.trim();
      }
    }
    if (
      typeof claims.chatgpt_account_id === 'string' &&
      claims.chatgpt_account_id.trim()
    ) {
      return claims.chatgpt_account_id.trim();
    }
  }
  return undefined;
}

function extractAudClientId(claims: Record<string, unknown>): string | undefined {
  const aud = claims.aud;
  const checkCandidate = (val: unknown): string | undefined => {
    if (typeof val !== 'string') return undefined;
    const trimmed = val.trim();
    if (
      trimmed &&
      trimmed !== 'dynamic_agent_client' &&
      !trimmed.startsWith('http://') &&
      !trimmed.startsWith('https://')
    ) {
      return trimmed;
    }
    return undefined;
  };
  if (Array.isArray(aud)) {
    for (const item of aud) {
      const matched = checkCandidate(item);
      if (matched) return matched;
    }
    return undefined;
  }
  return checkCandidate(aud);
}

async function generateRandomToken(byteLen = 24): Promise<string> {
  const bytes = await Crypto.getRandomBytesAsync(byteLen);
  return bytesToBase64Url(bytes);
}

async function generatePkcePair(): Promise<{
  verifier: string;
  challenge: string;
}> {
  const verifier = await generateRandomToken(36);
  const digestB64 = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    verifier,
    { encoding: Crypto.CryptoEncoding.BASE64 }
  );
  const challenge = digestB64
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  return { verifier, challenge };
}

function ensureExtAgentHostId(existing?: string): string {
  const trimmed = existing?.trim();
  if (trimmed) return trimmed;
  return `urn:uuid:${Crypto.randomUUID()}`;
}

function encodeFormBody(fields: Record<string, string>): string {
  return Object.entries(fields)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
}

export function looksLikeOAuthCallbackInput(raw: string): boolean {
  const trimmed = raw.trim();
  if (!trimmed) return false;
  if (
    /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?\//i.test(trimmed) &&
    /[?&](code|error)=/i.test(trimmed)
  ) {
    return true;
  }
  if (/^[?&]?(code=[^&\s]+&.*state=|state=[^&\s]+&.*code=)/i.test(trimmed)) {
    return true;
  }
  return false;
}

export function detectApiKeyProvider(raw: string): AIProviderId | null {
  const trimmed = raw.trim();
  if (!trimmed || /\s/.test(trimmed)) return null;
  if (/^AIza[0-9A-Za-z_-]{25,}$/.test(trimmed)) {
    return 'antigravity';
  }
  if (/^sk-ant-[0-9A-Za-z_-]{20,}$/.test(trimmed)) {
    return 'claude';
  }
  if (/^sk-[0-9A-Za-z_-]{20,}$/.test(trimmed)) {
    return 'gpt';
  }
  return null;
}

function parseQueryString(query: string): Record<string, string> {
  const cleaned = query.replace(/^[?#]/, '');
  const out: Record<string, string> = {};
  for (const part of cleaned.split('&')) {
    if (!part) continue;
    const eqIdx = part.indexOf('=');
    if (eqIdx < 0) continue;
    const k = decodeURIComponent(part.slice(0, eqIdx).replace(/\+/g, ' '));
    const v = decodeURIComponent(part.slice(eqIdx + 1).replace(/\+/g, ' '));
    out[k] = v;
  }
  return out;
}

const NUTRITION_SYSTEM_PROMPT = `You are an expert registered dietitian and food nutrition analyst for Plate, an iOS calorie tracker app.
Analyze the user's meal from the provided food photo and/or user notes (such as gram/milliliter amounts, home-cooked ingredients, sauces, oils, or portion details).

Rules:
1. If the user specifies exact metric weights (g, kg) or liquid volumes (mL, L), brands, or ingredients they put into the dish, prioritize those measurements accurately while using the photo to estimate any remaining visible items.
2. Use ONLY metric SI units everywhere (g, kg, mL, L, cm, m). NEVER output imperial or household kitchen units such as oz, lb, lbs, fl oz, cup, cups, tbsp, tsp, or inches in "title", "summary", "name", or "portion" — always convert any such quantities to g or mL (e.g. "15 mL", "250 mL", "180 g").
3. Break the meal down into individual food/ingredient items with realistic gram/milliliter estimates, calories (kcal), protein (g), carbs (g), and fat (g).
4. Ensure the top-level calories, protein, carbs, and fat equal the sum of the individual items.
5. Include a "healthScore" integer from 1 to 10 based on nutrient density, whole foods, protein balance, and fiber.
6. Return ONLY valid JSON matching this exact structure:
{
  "title": "Concise appetizing meal name",
  "summary": "1-2 sentence explanation of metric portion assumptions (g / mL) and key calorie drivers",
  "confidence": "high",
  "healthScore": 8,
  "calories": 550,
  "protein": 38,
  "carbs": 45,
  "fat": 22,
  "items": [
    {
      "name": "Chicken breast (grilled)",
      "grams": 180,
      "portion": "180 g",
      "calories": 297,
      "protein": 55.8,
      "carbs": 0,
      "fat": 6.5
    }
  ]
}`;

function normalizeBaseUrl(companionUrl: string): string {
  return companionUrl.trim().replace(/\/+$/, '') || 'http://localhost:8787';
}

function isLocalhostUrlOnNativeDevice(url: string): boolean {
  if (Platform.OS === 'web') return false;
  return /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/i.test(url.trim());
}

function buildCompanionHeaders(companionToken?: string): Record<string, string> {
  const { version, buildNumber } = getAppVersionMetadata();
  const headers: Record<string, string> = {
    'X-CalorieLens-Version': `${version}+${buildNumber}`,
  };
  if (companionToken?.trim()) {
    headers.Authorization = `Bearer ${companionToken.trim()}`;
  }
  return headers;
}

/**
 * Opens an AI provider's official authorization / console website directly in the user's browser.
 */
export async function openProviderWebsite(url: string): Promise<void> {
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    window.open(url, '_blank', 'noopener,noreferrer');
    return;
  }
  await WebBrowser.openBrowserAsync(url, {
    presentationStyle: WebBrowser.WebBrowserPresentationStyle.PAGE_SHEET,
  });
}

/**
 * Opens the provider's official key portal in an in-app Safari sheet and, when closed,
 * automatically returns any newly copied API key matching that provider from the clipboard.
 */
export async function openProviderPortalForKey(
  provider: AIProviderId
): Promise<string | null> {
  const url = PROVIDER_AUTH_PORTALS[provider];
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    window.open(url, '_blank', 'noopener,noreferrer');
    return null;
  }

  let beforeClip = '';
  try {
    beforeClip = (await Clipboard.getStringAsync()).trim();
  } catch {
    beforeClip = '';
  }

  await WebBrowser.openBrowserAsync(url, {
    presentationStyle: WebBrowser.WebBrowserPresentationStyle.PAGE_SHEET,
  });

  try {
    const afterClip = (await Clipboard.getStringAsync()).trim();
    if (afterClip && afterClip !== beforeClip) {
      const detected = detectApiKeyProvider(afterClip);
      if (detected === provider) {
        return afterClip;
      }
    }
  } catch {
    // ignore clipboard inspection restriction
  }
  return null;
}

export async function checkCompanionStatus(
  companionUrl: string,
  companionToken?: string
): Promise<CompanionStatusResponse> {
  const baseUrl = companionUrl.trim().replace(/\/+$/, '');
  if (!baseUrl) {
    throw new Error(
      'Please enter your Companion Backend URL (e.g. http://localhost:8787).'
    );
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3500);

  try {
    const res = await fetch(`${baseUrl}/api/status`, {
      method: 'GET',
      headers: buildCompanionHeaders(companionToken),
      signal: controller.signal,
    });

    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`Server returned ${res.status}: ${txt}`);
    }
    return (await res.json()) as CompanionStatusResponse;
  } finally {
    clearTimeout(timeout);
  }
}

async function runCompanionBrowserOAuthFlow(options: {
  companionUrl: string;
  companionToken?: string;
  startPath: string;
  hostOpenPath?: string;
  providerKey: 'gpt' | 'antigravity';
  isConnected: (st: CompanionStatusResponse) => boolean;
}): Promise<CompanionStatusResponse> {
  const baseUrl = normalizeBaseUrl(options.companionUrl);

  try {
    await checkCompanionStatus(baseUrl, options.companionToken);
  } catch {
    throw new Error(
      `Companion Server (${baseUrl}) is offline. Make sure the backend is running ("npm run backend") so it can receive the OAuth callback.`
    );
  }

  const startUrl = `${baseUrl}${options.startPath}`;

  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    const width = 520;
    const height = 700;
    const left = Math.max(
      0,
      Math.round(window.screenX + (window.outerWidth - width) / 2)
    );
    const top = Math.max(
      0,
      Math.round(window.screenY + (window.outerHeight - height) / 2)
    );
    const popup = window.open(
      startUrl,
      `calorielens_oauth_${options.providerKey}`,
      `width=${width},height=${height},left=${left},top=${top},resizable=yes,scrollbars=yes`
    );

    if (!popup) {
      window.open(startUrl, '_blank');
    }

    return new Promise<CompanionStatusResponse>((resolve, reject) => {
      let settled = false;

      const finish = (fn: () => void) => {
        if (settled) return;
        settled = true;
        clearInterval(pollTimer);
        clearTimeout(overallTimeout);
        window.removeEventListener('message', onMessage);
        fn();
      };

      const onMessage = async (event: MessageEvent) => {
        const data = event?.data;
        if (!data || data.type !== 'CALORIELENS_OAUTH_COMPLETE') return;
        if (data.provider && data.provider !== options.providerKey) return;

        if (!data.ok) {
          finish(() =>
            reject(
              new Error(
                data.detail || data.headline || 'OAuth authorization failed.'
              )
            )
          );
          return;
        }

        try {
          const fresh = await checkCompanionStatus(
            baseUrl,
            options.companionToken
          );
          finish(() => resolve(fresh));
        } catch (err) {
          finish(() =>
            reject(err instanceof Error ? err : new Error(String(err)))
          );
        }
      };

      window.addEventListener('message', onMessage);

      const pollTimer = setInterval(async () => {
        try {
          const fresh = await checkCompanionStatus(
            baseUrl,
            options.companionToken
          );
          if (options.isConnected(fresh)) {
            try {
              if (popup && !popup.closed) popup.close();
            } catch {
              // ignore cross-origin close restrictions
            }
            finish(() => resolve(fresh));
            return;
          }
        } catch {
          // ignore transient poll errors
        }

        if (popup && popup.closed) {
          try {
            const finalCheck = await checkCompanionStatus(
              baseUrl,
              options.companionToken
            );
            if (options.isConnected(finalCheck)) {
              finish(() => resolve(finalCheck));
              return;
            }
          } catch {
            // ignore
          }
          finish(() =>
            reject(
              new Error(
                'Sign-in window was closed before completing authorization.'
              )
            )
          );
        }
      }, 1200);

      const overallTimeout = setTimeout(() => {
        finish(() => reject(new Error('Sign-in timed out. Please try again.')));
      }, 180000);
    });
  }

  const isLanHost =
    /^https?:\/\/(192\.168\.|10\.|172\.(1[6-9]|2\d|3[0-1])\.)/i.test(baseUrl);

  if (isLanHost && options.hostOpenPath) {
    const openRes = await fetch(`${baseUrl}${options.hostOpenPath}`, {
      method: 'POST',
      headers: buildCompanionHeaders(options.companionToken),
    });
    if (!openRes.ok) {
      throw new Error('Could not launch browser sign-in on Companion host.');
    }

    const deadline = Date.now() + 120000;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 1500));
      const fresh = await checkCompanionStatus(baseUrl, options.companionToken);
      if (options.isConnected(fresh)) {
        return fresh;
      }
    }
    throw new Error(
      'Waiting for sign-in on your computer timed out. Complete authorization in your computer browser or authorize an API key directly.'
    );
  }

  await WebBrowser.openBrowserAsync(startUrl, {
    presentationStyle: WebBrowser.WebBrowserPresentationStyle.PAGE_SHEET,
  });

  const fresh = await checkCompanionStatus(baseUrl, options.companionToken);
  if (options.isConnected(fresh)) {
    return fresh;
  }
  throw new Error('Authorization was not completed.');
}

async function probeCompanionQuickly(
  companionUrl: string,
  companionToken?: string,
  timeoutMs = 900
): Promise<CompanionStatusResponse | null> {
  const baseUrl = companionUrl.trim().replace(/\/+$/, '');
  if (!baseUrl) return null;
  const effectiveTimeout = isLocalhostUrlOnNativeDevice(baseUrl)
    ? Math.min(timeoutMs, 350)
    : timeoutMs;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), effectiveTimeout);
  try {
    const res = await fetch(`${baseUrl}/api/status`, {
      method: 'GET',
      headers: buildCompanionHeaders(companionToken),
      signal: controller.signal,
    });
    if (!res.ok) return null;
    return (await res.json()) as CompanionStatusResponse;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export type ChatGPTSignInResult =
  | {
      mode: 'on_device_connected';
      session: ChatGPTOnDeviceSession;
      apiKeyIssued?: string;
    }
  | {
      mode: 'companion_connected';
      companionStatus: CompanionStatusResponse;
    }
  | {
      mode: 'awaiting_callback';
      authUrl: string;
    };

async function buildOnDeviceOpenAIAuthorizeUrl(
  auth: ProviderAuthConfig,
  redirectUri: string,
  variant: 'siwc' | 'codex' = 'siwc'
): Promise<string> {
  const extAgentHostId = ensureExtAgentHostId(
    auth.chatgptOAuth?.extAgentHostId
  );
  const { verifier, challenge } = await generatePkcePair();
  const state = await generateRandomToken(24);
  const nonce = await generateRandomToken(24);

  if (variant === 'codex') {
    const params: Record<string, string> = {
      response_type: 'code',
      client_id: OPENAI_CODEX_CLIENT_ID,
      redirect_uri: redirectUri,
      scope: OPENAI_CODEX_SCOPES,
      code_challenge: challenge,
      code_challenge_method: 'S256',
      id_token_add_organizations: 'true',
      codex_cli_simplified_flow: 'true',
      state,
    };

    await savePendingChatGPTPkce({
      state,
      codeVerifier: verifier,
      nonce,
      redirectUri,
      clientIdSent: OPENAI_CODEX_CLIENT_ID,
      extAgentHostId,
      oauthVariant: 'codex',
      createdAt: Date.now(),
    });

    return `${OPENAI_CODEX_AUTH_URL}?${encodeFormBody(params)}`;
  }

  const savedClientId =
    auth.chatgptOAuth?.oauthMode !== 'codex' &&
    auth.chatgptOAuth?.clientId &&
    auth.chatgptOAuth.clientId !== OPENAI_CODEX_CLIENT_ID &&
    auth.chatgptOAuth.clientId !== 'dynamic_agent_client'
      ? auth.chatgptOAuth.clientId.trim()
      : '';
  const effectiveClientId = savedClientId || 'dynamic_agent_client';

  const params: Record<string, string> = {
    client_id: effectiveClientId,
    ext_agent_host_id: extAgentHostId,
    response_type: 'code',
    redirect_uri: redirectUri,
    scope: OPENAI_SIWC_SCOPES,
    resource: OPENAI_RESOURCE,
    state,
    nonce,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  };
  if (effectiveClientId === 'dynamic_agent_client') {
    params.agent_name_hint = 'Plate';
  }

  await savePendingChatGPTPkce({
    state,
    codeVerifier: verifier,
    nonce,
    redirectUri,
    clientIdSent: effectiveClientId,
    extAgentHostId,
    oauthVariant: 'siwc',
    createdAt: Date.now(),
  });

  return `${OPENAI_SIWC_AUTH_URL}?${encodeFormBody(params)}`;
}

async function tryExchangeIdTokenForOpenAIApiKey(
  idToken: string
): Promise<string | undefined> {
  if (!idToken) return undefined;
  try {
    const exRes = await fetch(OPENAI_CODEX_OAUTH_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: encodeFormBody({
        grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
        client_id: OPENAI_CODEX_CLIENT_ID,
        requested_token: 'openai-api-key',
        subject_token: idToken,
        subject_token_type: 'urn:ietf:params:oauth:token-type:id_token',
      }),
    });
    if (exRes.ok) {
      const exData = (await exRes.json()) as Record<string, unknown>;
      const candidateKey = String(exData.access_token || '').trim();
      if (candidateKey) {
        return candidateKey;
      }
    }
  } catch {
    // Optional token-exchange; continue with OAuth session tokens
  }
  return undefined;
}

async function completeOnDeviceChatGPTCallbackInternal(
  rawCallbackInput: string,
  auth: ProviderAuthConfig
): Promise<{ session: ChatGPTOnDeviceSession; apiKeyIssued?: string }> {
  const trimmed = rawCallbackInput.trim();
  if (!trimmed) {
    throw new Error(
      'No callback URL received yet. Tap "Sign in with ChatGPT" to try again.'
    );
  }

  const pending = await loadPendingChatGPTPkce();
  if (!pending) {
    throw new Error(
      'Sign-in session expired. Tap "Sign in with ChatGPT" to start a fresh login.'
    );
  }

  let params: Record<string, string> = {};
  const qIdx = trimmed.indexOf('?');
  if (qIdx >= 0) {
    const queryPart = trimmed.slice(qIdx + 1).split('#')[0] || '';
    params = parseQueryString(queryPart);
  } else if (trimmed.includes('=')) {
    params = parseQueryString(trimmed);
  } else {
    params = { code: trimmed };
  }

  if (params.error) {
    await savePendingChatGPTPkce(null);
    throw new Error(params.error_description || params.error);
  }

  const code = (params.code || '').trim();
  if (!code) {
    throw new Error(
      'Authorization was not completed (no code returned). Please try signing in again.'
    );
  }

  if (params.state && params.state !== pending.state) {
    throw new Error(
      'Sign-in state mismatch (from an older login attempt). Tap "Sign in with ChatGPT" to try again.'
    );
  }

  const isCodexFlow =
    pending.oauthVariant === 'codex' ||
    pending.clientIdSent === OPENAI_CODEX_CLIENT_ID;

  if (isCodexFlow) {
    const res = await fetch(OPENAI_CODEX_OAUTH_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: encodeFormBody({
        grant_type: 'authorization_code',
        client_id: OPENAI_CODEX_CLIENT_ID,
        code,
        redirect_uri: pending.redirectUri,
        code_verifier: pending.codeVerifier,
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(
        `OpenAI token exchange failed (${res.status}): ${errText.slice(0, 220)}`
      );
    }

    const tokenData = (await res.json()) as Record<string, unknown>;
    const accessToken = String(tokenData.access_token || '').trim();
    const refreshToken = String(tokenData.refresh_token || '').trim();
    const idToken = String(tokenData.id_token || '').trim();
    if (!accessToken) {
      throw new Error('OpenAI did not return an access token.');
    }

    const apiKeyIssued = await tryExchangeIdTokenForOpenAIApiKey(idToken);
    const idClaims = decodeJwtClaims(idToken);
    const accessClaims = decodeJwtClaims(accessToken);
    const email =
      (typeof idClaims.email === 'string' && idClaims.email) ||
      (typeof accessClaims.email === 'string' && accessClaims.email) ||
      undefined;
    const name =
      (typeof idClaims.name === 'string' && idClaims.name) ||
      (typeof accessClaims.name === 'string' && accessClaims.name) ||
      undefined;
    const chatgptAccountId = extractChatGPTAccountId(idToken, accessToken);
    const expiresIn = Number(tokenData.expires_in) || 3600;

    await savePendingChatGPTPkce(null);

    return {
      session: {
        connected: true,
        accessToken,
        refreshToken,
        clientId: OPENAI_CODEX_CLIENT_ID,
        extAgentHostId: pending.extAgentHostId,
        expiresAt: Math.floor(Date.now() / 1000) + expiresIn,
        scope:
          (typeof tokenData.scope === 'string' && tokenData.scope) ||
          OPENAI_CODEX_SCOPES,
        email,
        name,
        chatgptAccountId,
        oauthMode: 'codex',
      },
      apiKeyIssued,
    };
  }

  // Official OpenAI "Sign in with ChatGPT" (SIWC) flow
  const issuedClientId = (params.client_id || '').trim();
  const savedClientId =
    auth.chatgptOAuth?.clientId &&
    auth.chatgptOAuth.clientId !== OPENAI_CODEX_CLIENT_ID &&
    auth.chatgptOAuth.clientId !== 'dynamic_agent_client'
      ? auth.chatgptOAuth.clientId.trim()
      : '';

  const candidateClientIds = Array.from(
    new Set(
      [issuedClientId, pending.clientIdSent, savedClientId].filter(Boolean)
    )
  );

  let tokenData: Record<string, unknown> | null = null;
  let lastErrorText = '';
  let lastStatus = 0;

  for (const clientIdAttempt of candidateClientIds) {
    const res = await fetch(OPENAI_SIWC_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: encodeFormBody({
        grant_type: 'authorization_code',
        client_id: clientIdAttempt,
        code,
        redirect_uri: pending.redirectUri,
        code_verifier: pending.codeVerifier,
        resource: OPENAI_RESOURCE,
      }),
    });

    if (res.ok) {
      tokenData = (await res.json()) as Record<string, unknown>;
      break;
    }

    lastStatus = res.status;
    lastErrorText = await res.text();
  }

  if (!tokenData) {
    throw new Error(
      `OpenAI token exchange failed (${lastStatus}): ${lastErrorText.slice(0, 220)}`
    );
  }

  const accessToken = String(tokenData.access_token || '').trim();
  const refreshToken = String(tokenData.refresh_token || '').trim();
  const idToken =
    typeof tokenData.id_token === 'string' ? tokenData.id_token : '';
  if (!accessToken) {
    throw new Error('OpenAI did not return an access token.');
  }

  const idClaims = decodeJwtClaims(idToken || null);
  const accessClaims = decodeJwtClaims(accessToken);
  const resolvedClientId =
    issuedClientId ||
    (typeof tokenData.client_id === 'string' && tokenData.client_id.trim()) ||
    extractAudClientId(idClaims) ||
    savedClientId ||
    pending.clientIdSent;

  const email =
    (typeof idClaims.email === 'string' && idClaims.email) ||
    (typeof accessClaims.email === 'string' && accessClaims.email) ||
    undefined;
  const name =
    (typeof idClaims.name === 'string' && idClaims.name) ||
    (typeof accessClaims.name === 'string' && accessClaims.name) ||
    undefined;
  const chatgptAccountId = extractChatGPTAccountId(idToken, accessToken);
  const expiresIn = Number(tokenData.expires_in) || 3600;

  await savePendingChatGPTPkce(null);

  return {
    session: {
      connected: true,
      accessToken,
      refreshToken,
      clientId: resolvedClientId,
      extAgentHostId: pending.extAgentHostId,
      expiresAt: Math.floor(Date.now() / 1000) + expiresIn,
      scope:
        (typeof tokenData.scope === 'string' && tokenData.scope) ||
        params.scope ||
        OPENAI_SIWC_SCOPES,
      email,
      name,
      chatgptAccountId,
      oauthMode: 'siwc',
    },
  };
}

/**
 * Completes an on-device OpenAI PKCE flow from the callback redirect URL
 * directly on the device without needing any external backend server.
 */
export async function completeOnDeviceChatGPTCallback(
  rawCallbackInput: string,
  auth: ProviderAuthConfig
): Promise<ChatGPTOnDeviceSession> {
  const { session } = await completeOnDeviceChatGPTCallbackInternal(
    rawCallbackInput,
    auth
  );
  return session;
}

export async function cancelPendingChatGPTSignIn(): Promise<void> {
  await stopLoopbackOAuthServer();
  await savePendingChatGPTPkce(null);
}

/**
 * Launches "Sign in with ChatGPT":
 * - On iOS & Android: starts the built-in local loopback listener on `localhost:1455` (`ExpoLoopbackOAuth`),
 *   opens Safari View Controller, automatically intercepts the `http://localhost:1455/auth/callback` redirect,
 *   closes Safari, and exchanges the PKCE code for tokens immediately (never gets stuck on localhost).
 * - If a desktop Companion Server is online on Web/LAN, uses its loopback endpoint.
 */
export async function startChatGPTSignIn(
  auth: ProviderAuthConfig,
  variant: 'siwc' | 'codex' = 'codex'
): Promise<ChatGPTSignInResult> {
  if (!isLocalhostUrlOnNativeDevice(auth.companionUrl)) {
    const companionProbe = await probeCompanionQuickly(
      auth.companionUrl,
      auth.companionToken,
      800
    );
    if (companionProbe?.ok) {
      const st = await runCompanionBrowserOAuthFlow({
        companionUrl: auth.companionUrl,
        companionToken: auth.companionToken,
        startPath: '/api/oauth/openai/start',
        hostOpenPath: '/api/oauth/openai/open-on-host',
        providerKey: 'gpt',
        isConnected: (s) => Boolean(s.chatgptOAuth?.connected),
      });
      return { mode: 'companion_connected', companionStatus: st };
    }
  }

  // Native iOS / Android automatic loopback listener (`http://localhost:1455/auth/callback`)
  if (Platform.OS !== 'web' && isLoopbackOAuthSupported()) {
    let activeVariant: 'siwc' | 'codex' = variant;
    let serverInfo = null;
    try {
      serverInfo = await startLoopbackOAuthServer(
        DEFAULT_LOOPBACK_PORT,
        activeVariant === 'siwc'
      );
    } catch {
      if (activeVariant === 'codex') {
        activeVariant = 'siwc';
        serverInfo = await startLoopbackOAuthServer(0, true);
      }
    }

    if (serverInfo) {
      try {
        const authUrl = await buildOnDeviceOpenAIAuthorizeUrl(
          auth,
          serverInfo.redirectUri,
          activeVariant
        );

        let capturedCallbackUrl: string | null = null;
        const callbackOutcome = waitForLoopbackOAuthCallback(180000)
          .then((url) => {
            capturedCallbackUrl = url;
            return { kind: 'callback' as const, url };
          })
          .catch((err) => ({
            kind: 'callback_error' as const,
            error: err instanceof Error ? err.message : String(err),
          }));

        const browserOutcome = WebBrowser.openBrowserAsync(authUrl, {
          presentationStyle: WebBrowser.WebBrowserPresentationStyle.PAGE_SHEET,
        }).then(() => ({ kind: 'browser_closed' as const }));

        const winner = await Promise.race([callbackOutcome, browserOutcome]);

        if (winner.kind === 'callback') {
          if (Platform.OS === 'ios') {
            await WebBrowser.dismissBrowser().catch(() => {});
          }
          await stopLoopbackOAuthServer();
          const completed = await completeOnDeviceChatGPTCallbackInternal(
            winner.url,
            auth
          );
          return {
            mode: 'on_device_connected',
            session: completed.session,
            apiKeyIssued: completed.apiKeyIssued,
          };
        }

        // User dismissed the Safari sheet manually — allow a brief grace window in case redirect arrived simultaneously
        if (winner.kind === 'browser_closed') {
          const grace = await Promise.race([
            callbackOutcome,
            new Promise<{ kind: 'grace_expired' }>((resolve) =>
              setTimeout(() => resolve({ kind: 'grace_expired' }), 650)
            ),
          ]);
          await stopLoopbackOAuthServer();

          if (grace.kind === 'callback' || capturedCallbackUrl) {
            const urlToUse =
              grace.kind === 'callback' ? grace.url : capturedCallbackUrl!;
            const completed = await completeOnDeviceChatGPTCallbackInternal(
              urlToUse,
              auth
            );
            return {
              mode: 'on_device_connected',
              session: completed.session,
              apiKeyIssued: completed.apiKeyIssued,
            };
          }

          try {
            const clip = (await Clipboard.getStringAsync()).trim();
            if (looksLikeOAuthCallbackInput(clip)) {
              const completed = await completeOnDeviceChatGPTCallbackInternal(
                clip,
                auth
              );
              return {
                mode: 'on_device_connected',
                session: completed.session,
                apiKeyIssued: completed.apiKeyIssued,
              };
            }
          } catch {
            // ignore clipboard check error
          }

          await savePendingChatGPTPkce(null);
          throw new Error('Sign-in closed before authorization completed.');
        }

        await stopLoopbackOAuthServer();
        throw new Error(winner.error || 'Could not complete ChatGPT sign-in.');
      } catch (err) {
        await stopLoopbackOAuthServer();
        throw err;
      }
    }
  }

  // Fallback for Web browser without Companion server
  const authUrl = await buildOnDeviceOpenAIAuthorizeUrl(
    auth,
    DEFAULT_LOOPBACK_REDIRECT,
    variant
  );

  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    window.open(authUrl, '_blank', 'noopener,noreferrer');
    return { mode: 'awaiting_callback', authUrl };
  }

  await WebBrowser.openBrowserAsync(authUrl, {
    presentationStyle: WebBrowser.WebBrowserPresentationStyle.PAGE_SHEET,
  });

  try {
    const clip = (await Clipboard.getStringAsync()).trim();
    if (looksLikeOAuthCallbackInput(clip)) {
      const completed = await completeOnDeviceChatGPTCallbackInternal(
        clip,
        auth
      );
      return {
        mode: 'on_device_connected',
        session: completed.session,
        apiKeyIssued: completed.apiKeyIssued,
      };
    }
  } catch {
    // let user complete manually if native module unavailable
  }

  return { mode: 'awaiting_callback', authUrl };
}

/**
 * Serverless 8-character Device Code Sign-In (https://auth.openai.com/codex/device).
 * Copies the one-time code to clipboard, opens Safari, polls in background, and auto-closes Safari.
 */
export async function startChatGPTDeviceCodeSignIn(
  auth: ProviderAuthConfig,
  onCodeIssued: (info: { userCode: string; verificationUrl: string }) => void,
  signal?: AbortSignal
): Promise<{ session: ChatGPTOnDeviceSession; apiKeyIssued?: string }> {
  const ucRes = await fetch(OPENAI_DEVICE_USERCODE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: OPENAI_CODEX_CLIENT_ID }),
    signal,
  });

  if (ucRes.status === 404) {
    throw new Error(
      'Enable "Device code authorization" in ChatGPT Settings → Security first, or tap Sign in with ChatGPT above.'
    );
  }
  if (!ucRes.ok) {
    throw new Error(
      `Could not request ChatGPT sign-in code (${ucRes.status}). Tap Sign in with ChatGPT above or Keys ↗.`
    );
  }

  const ucJson = (await ucRes.json()) as Record<string, unknown>;
  const deviceAuthId = String(ucJson.device_auth_id || '').trim();
  const userCode = String(ucJson.user_code || ucJson.usercode || '').trim();
  const intervalSec = Math.max(4, Number(ucJson.interval) || 5);

  if (!deviceAuthId || !userCode) {
    throw new Error('Unexpected response from OpenAI device authorization.');
  }

  try {
    await Clipboard.setStringAsync(userCode);
  } catch {
    // ignore clipboard write restrictions
  }

  onCodeIssued({
    userCode,
    verificationUrl: OPENAI_DEVICE_VERIFY_URL,
  });

  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    window.open(OPENAI_DEVICE_VERIFY_URL, '_blank', 'noopener,noreferrer');
  } else {
    void WebBrowser.openBrowserAsync(OPENAI_DEVICE_VERIFY_URL, {
      presentationStyle: WebBrowser.WebBrowserPresentationStyle.PAGE_SHEET,
    }).catch(() => {});
  }

  const deadline = Date.now() + 10 * 60 * 1000;
  let authCode = '';
  let codeVerifier = '';

  while (Date.now() < deadline) {
    if (signal?.aborted) {
      throw new Error('Sign-in cancelled.');
    }

    await new Promise((resolve) => setTimeout(resolve, intervalSec * 1000));
    if (signal?.aborted) {
      throw new Error('Sign-in cancelled.');
    }

    const pollRes = await fetch(OPENAI_DEVICE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        device_auth_id: deviceAuthId,
        user_code: userCode,
      }),
      signal,
    });

    if (pollRes.ok) {
      const codeData = (await pollRes.json()) as Record<string, unknown>;
      authCode = String(codeData.authorization_code || '').trim();
      codeVerifier = String(codeData.code_verifier || '').trim();
      break;
    }

    if (pollRes.status === 403 || pollRes.status === 404) {
      continue;
    }

    throw new Error(`Device code sign-in failed (${pollRes.status}).`);
  }

  if (!authCode || !codeVerifier) {
    throw new Error('Device code sign-in timed out. Please try again.');
  }

  const tokenRes = await fetch(OPENAI_CODEX_OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: encodeFormBody({
      grant_type: 'authorization_code',
      client_id: OPENAI_CODEX_CLIENT_ID,
      code: authCode,
      redirect_uri: OPENAI_DEVICE_CALLBACK_URI,
      code_verifier: codeVerifier,
    }),
    signal,
  });

  if (!tokenRes.ok) {
    const txt = await tokenRes.text();
    throw new Error(
      `Token exchange failed (${tokenRes.status}): ${txt.slice(0, 180)}`
    );
  }

  const tokenData = (await tokenRes.json()) as Record<string, unknown>;
  const accessToken = String(tokenData.access_token || '').trim();
  const refreshToken = String(tokenData.refresh_token || '').trim();
  const idToken = String(tokenData.id_token || '').trim();

  if (Platform.OS === 'ios') {
    try {
      await WebBrowser.dismissBrowser();
    } catch {
      // ignore if already closed by user
    }
  }

  const apiKeyIssued = await tryExchangeIdTokenForOpenAIApiKey(idToken);
  const idClaims = decodeJwtClaims(idToken);
  const accessClaims = decodeJwtClaims(accessToken);
  const email =
    (typeof idClaims.email === 'string' && idClaims.email) ||
    (typeof accessClaims.email === 'string' && accessClaims.email) ||
    undefined;
  const name =
    (typeof idClaims.name === 'string' && idClaims.name) ||
    (typeof accessClaims.name === 'string' && accessClaims.name) ||
    undefined;
  const chatgptAccountId = extractChatGPTAccountId(idToken, accessToken);
  const expiresIn = Number(tokenData.expires_in) || 3600;

  const session: ChatGPTOnDeviceSession = {
    connected: true,
    accessToken,
    refreshToken,
    clientId: OPENAI_CODEX_CLIENT_ID,
    extAgentHostId: ensureExtAgentHostId(auth.chatgptOAuth?.extAgentHostId),
    expiresAt: Math.floor(Date.now() / 1000) + expiresIn,
    scope: typeof tokenData.scope === 'string' ? tokenData.scope : undefined,
    email,
    name,
    chatgptAccountId,
    oauthMode: 'codex',
  };

  return { session, apiKeyIssued };
}

export async function disconnectChatGPTOAuth(
  companionUrl: string,
  companionToken?: string
): Promise<CompanionStatusResponse | null> {
  await stopLoopbackOAuthServer();
  await savePendingChatGPTPkce(null);
  if (isLocalhostUrlOnNativeDevice(companionUrl)) {
    return null;
  }
  const baseUrl = normalizeBaseUrl(companionUrl);
  try {
    await fetch(`${baseUrl}/api/oauth/openai/logout`, {
      method: 'POST',
      headers: buildCompanionHeaders(companionToken),
    });
    return await checkCompanionStatus(baseUrl, companionToken);
  } catch {
    return null;
  }
}

/**
 * Launches Google's official OAuth 2.0 PKCE flow on accounts.google.com
 * (when GOOGLE_OAUTH_CLIENT_ID is configured on the companion server).
 */
export async function signInWithGoogleOAuth(
  companionUrl: string,
  companionToken?: string
): Promise<CompanionStatusResponse> {
  return runCompanionBrowserOAuthFlow({
    companionUrl,
    companionToken,
    startPath: '/api/oauth/google/start',
    providerKey: 'antigravity',
    isConnected: (st) => Boolean(st.googleOAuth?.connected),
  });
}

export async function disconnectGoogleOAuth(
  companionUrl: string,
  companionToken?: string
): Promise<CompanionStatusResponse> {
  const baseUrl = normalizeBaseUrl(companionUrl);
  await fetch(`${baseUrl}/api/oauth/google/logout`, {
    method: 'POST',
    headers: buildCompanionHeaders(companionToken),
  });
  return checkCompanionStatus(baseUrl, companionToken);
}

export function isProviderConfigured(
  provider: AIProviderId,
  auth: ProviderAuthConfig,
  companionStatus: CompanionStatusResponse | null
): { ready: boolean; methodLabel: string } {
  if (provider === 'antigravity') {
    if (companionStatus?.ok && companionStatus.googleOAuth?.connected) {
      const email = companionStatus.googleOAuth.email;
      return {
        ready: true,
        methodLabel: email ? `Google SSO (${email})` : 'Google SSO Connected',
      };
    }
    if (companionStatus?.ok && companionStatus.antigravityReady) {
      return { ready: true, methodLabel: 'Antigravity SDK Ready' };
    }
    if (auth.geminiApiKey.trim()) {
      return {
        ready: true,
        methodLabel: companionStatus?.ok
          ? 'Antigravity SDK + Google Key'
          : 'Google AI Studio Key',
      };
    }
    return { ready: false, methodLabel: 'Connect Google AI Key' };
  }

  if (provider === 'claude') {
    if (auth.claudeApiKey.trim()) {
      return { ready: true, methodLabel: 'Anthropic Console Key' };
    }
    if (companionStatus?.ok && companionStatus.serverProviders?.claude) {
      return { ready: true, methodLabel: 'Companion Anthropic Key' };
    }
    return { ready: false, methodLabel: 'Connect Claude Key' };
  }

  // gpt
  if (auth.openaiApiKey.trim()) {
    return { ready: true, methodLabel: 'OpenAI Platform Key' };
  }
  if (
    auth.chatgptOAuth?.connected &&
    Boolean(auth.chatgptOAuth.accessToken || auth.chatgptOAuth.refreshToken)
  ) {
    const email = auth.chatgptOAuth.email;
    return {
      ready: true,
      methodLabel: email ? `ChatGPT SSO (${email})` : 'ChatGPT SSO Connected',
    };
  }
  if (companionStatus?.ok && companionStatus.chatgptOAuth?.connected) {
    const email = companionStatus.chatgptOAuth.email;
    return {
      ready: true,
      methodLabel: email ? `ChatGPT SSO (${email})` : 'ChatGPT SSO Connected',
    };
  }
  if (companionStatus?.ok && companionStatus.serverProviders?.gpt) {
    return { ready: true, methodLabel: 'Companion OpenAI Key' };
  }
  return { ready: false, methodLabel: 'Sign in with ChatGPT' };
}

export function resolveReadyProvider(
  preferred: AIProviderId,
  auth: ProviderAuthConfig,
  companionStatus: CompanionStatusResponse | null = null
): AIProviderId {
  if (isProviderConfigured(preferred, auth, companionStatus).ready) {
    return preferred;
  }
  const fallbackOrder: AIProviderId[] = ['gpt', 'antigravity', 'claude'];
  for (const candidate of fallbackOrder) {
    if (isProviderConfigured(candidate, auth, companionStatus).ready) {
      return candidate;
    }
  }
  return preferred;
}

function buildUserPrompt(
  mealType?: MealType,
  userNotes?: string,
  hasPhoto?: boolean
): string {
  const parts = [
    'Analyze this meal using strictly metric units (g, kg, mL, L) and output ONLY the requested JSON object.',
  ];
  if (mealType) {
    parts.push(`Meal type: ${mealType}`);
  }
  if (userNotes?.trim()) {
    parts.push(
      `User-provided details (exact grams/mL, ingredients put into it, sauces, cooking method): ${userNotes.trim()}`
    );
  } else if (hasPhoto) {
    parts.push(
      'Estimate realistic metric weights/volumes (g, mL) and macros visually from the photo.'
    );
  }
  return parts.join('\n');
}

function extractJsonFromText(rawText: string): Record<string, unknown> {
  const trimmed = rawText.trim();
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  const candidate = fence ? fence[1].trim() : trimmed;
  const firstBrace = candidate.indexOf('{');
  const lastBrace = candidate.lastIndexOf('}');
  const jsonSlice =
    firstBrace >= 0 && lastBrace > firstBrace
      ? candidate.slice(firstBrace, lastBrace + 1)
      : candidate;
  return JSON.parse(jsonSlice);
}

function normalizeAnalysisPayload(
  raw: Record<string, unknown>,
  provider: AIProviderId,
  modelUsed?: string
): AIMealAnalysisResult {
  const rawItems = Array.isArray(raw.items) ? raw.items : [];
  const items: MealItem[] = rawItems.map((entry, index) => {
    const obj = (entry && typeof entry === 'object' ? entry : {}) as Record<
      string,
      unknown
    >;
    const gramsRaw = obj.grams;
    const gramsNum =
      gramsRaw !== null &&
      gramsRaw !== undefined &&
      !Number.isNaN(Number(gramsRaw))
        ? Math.round(Number(gramsRaw))
        : null;

    const rawPortion = obj.portion ? String(obj.portion).trim() : '';
    const hasNonMetricUnit =
      /\b(oz|fl\.?\s*oz|lbs?|pounds?|cups?|tbsp|tablespoons?|tsp|teaspoons?|inch|inches)\b/i.test(
        rawPortion
      );
    const metricPortion =
      rawPortion && !hasNonMetricUnit
        ? rawPortion
        : gramsNum
          ? `${gramsNum} g`
          : undefined;

    return {
      id: String(obj.id || `item_${Date.now()}_${index}`),
      name: String(obj.name || `Ingredient ${index + 1}`),
      grams: gramsNum,
      portion: metricPortion,
      calories: Math.max(0, Math.round(Number(obj.calories) || 0)),
      protein: Math.max(0, Number((Number(obj.protein) || 0).toFixed(1))),
      carbs: Math.max(0, Number((Number(obj.carbs) || 0).toFixed(1))),
      fat: Math.max(0, Number((Number(obj.fat) || 0).toFixed(1))),
    };
  });

  const calories = items.length
    ? items.reduce((sum, i) => sum + i.calories, 0)
    : Math.max(0, Math.round(Number(raw.calories) || 0));

  const protein = items.length
    ? Number(items.reduce((sum, i) => sum + i.protein, 0).toFixed(1))
    : Math.max(0, Number((Number(raw.protein) || 0).toFixed(1)));

  const carbs = items.length
    ? Number(items.reduce((sum, i) => sum + i.carbs, 0).toFixed(1))
    : Math.max(0, Number((Number(raw.carbs) || 0).toFixed(1)));

  const fat = items.length
    ? Number(items.reduce((sum, i) => sum + i.fat, 0).toFixed(1))
    : Math.max(0, Number((Number(raw.fat) || 0).toFixed(1)));

  const confRaw = String(raw.confidence || 'medium').toLowerCase();
  const confidence: 'high' | 'medium' | 'low' =
    confRaw === 'high' || confRaw === 'low' ? confRaw : 'medium';

  const rawHealth = Number(raw.healthScore);
  const healthScore =
    !Number.isNaN(rawHealth) && rawHealth >= 1 && rawHealth <= 10
      ? Math.round(rawHealth)
      : computeHealthScoreFromMacros(calories, protein, carbs, fat);

  return {
    title: String(raw.title || 'Analyzed Meal'),
    summary: String(
      raw.summary || 'Estimated calories and macros based on your meal.'
    ),
    confidence,
    calories,
    protein,
    carbs,
    fat,
    healthScore,
    items,
    providerUsed: provider,
    modelUsed,
  };
}

export interface AnalyzeMealInput {
  provider: AIProviderId;
  auth: ProviderAuthConfig;
  imageBase64?: string;
  mimeType?: string;
  userNotes?: string;
  mealType?: MealType;
}

export async function analyzeMealWithAI(
  input: AnalyzeMealInput
): Promise<AIMealAnalysisResult> {
  const {
    provider,
    auth,
    imageBase64,
    mimeType = 'image/jpeg',
    userNotes,
    mealType,
  } = input;

  if (!imageBase64 && !userNotes?.trim()) {
    throw new Error(
      'Take or upload a meal photo, or describe what you ate with gram amounts.'
    );
  }

  const effectiveProvider = resolveReadyProvider(provider, auth, null);

  if (effectiveProvider === 'antigravity') {
    return analyzeViaAntigravityOrGemini(
      auth,
      imageBase64,
      mimeType,
      userNotes,
      mealType
    );
  }
  if (effectiveProvider === 'claude') {
    return analyzeViaClaude(auth, imageBase64, mimeType, userNotes, mealType);
  }
  return analyzeViaGpt(auth, imageBase64, mimeType, userNotes, mealType);
}

export async function testAIProviderConnection(
  auth: ProviderAuthConfig,
  preferredProvider?: AIProviderId
): Promise<{ providerUsed: AIProviderId; modelUsed?: string; title: string }> {
  const res = await analyzeMealWithAI({
    provider: preferredProvider || auth.activeProvider,
    auth,
    userNotes: '120 g banana',
    mealType: 'snack',
  });
  return {
    providerUsed: res.providerUsed,
    modelUsed: res.modelUsed,
    title: res.title,
  };
}

async function callCompanionAnalyze(
  auth: ProviderAuthConfig,
  payload: {
    provider: AIProviderId;
    imageBase64?: string;
    mimeType: string;
    userNotes?: string;
    mealType?: MealType;
    apiKey?: string;
    model?: string;
  }
): Promise<AIMealAnalysisResult> {
  const baseUrl = normalizeBaseUrl(auth.companionUrl);
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...buildCompanionHeaders(auth.companionToken),
  };

  const res = await fetch(`${baseUrl}/api/analyze`, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    let detail = await res.text();
    try {
      const errJson = JSON.parse(detail);
      if (errJson?.detail) detail = String(errJson.detail);
    } catch {
      // keep raw
    }
    throw new Error(detail || `Companion server error (${res.status})`);
  }

  const data = await res.json();
  return normalizeAnalysisPayload(data, payload.provider, data.modelUsed);
}

async function analyzeViaAntigravityOrGemini(
  auth: ProviderAuthConfig,
  imageBase64?: string,
  mimeType: string = 'image/jpeg',
  userNotes?: string,
  mealType?: MealType
): Promise<AIMealAnalysisResult> {
  // 1. Direct Google Gemini Vision API when an authorized Google AI Studio key is saved on-device
  if (auth.geminiApiKey.trim()) {
    const preferredModel = auth.geminiModel || 'gemini-2.5-flash';
    const candidateModels = Array.from(
      new Set([preferredModel, 'gemini-2.5-flash', 'gemini-2.0-flash'])
    );
    const parts: Record<string, unknown>[] = [];
    if (imageBase64) {
      parts.push({
        inline_data: {
          mime_type: mimeType,
          data: imageBase64,
        },
      });
    }
    parts.push({
      text: `${NUTRITION_SYSTEM_PROMPT}\n\n${buildUserPrompt(
        mealType,
        userNotes,
        Boolean(imageBase64)
      )}`,
    });

    let lastStatus = 0;
    let lastError = '';

    for (const model of candidateModels) {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(
        auth.geminiApiKey.trim()
      )}`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts }],
          generationConfig: {
            responseMimeType: 'application/json',
            temperature: 0.2,
          },
        }),
      });

      if (res.ok) {
        const data = await res.json();
        const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
        const parsed = extractJsonFromText(text);
        return normalizeAnalysisPayload(parsed, 'antigravity', model);
      }

      lastStatus = res.status;
      lastError = await res.text();
      if (res.status !== 404) {
        break;
      }
    }

    throw new Error(
      `Google Gemini API error (${lastStatus}): ${lastError.slice(0, 220)}`
    );
  }

  // 2. Optional Companion Antigravity SDK / Google OAuth backend when reachable
  if (
    auth.companionUrl.trim() &&
    !isLocalhostUrlOnNativeDevice(auth.companionUrl)
  ) {
    const probe = await probeCompanionQuickly(
      auth.companionUrl,
      auth.companionToken,
      900
    );
    if (probe?.ok) {
      return callCompanionAnalyze(auth, {
        provider: 'antigravity',
        imageBase64,
        mimeType,
        userNotes,
        mealType,
      });
    }
  }

  throw new Error(
    'No AI account connected yet. Open Settings to Sign in with ChatGPT, Google AI Studio, or Claude.'
  );
}

async function analyzeViaClaude(
  auth: ProviderAuthConfig,
  imageBase64?: string,
  mimeType: string = 'image/jpeg',
  userNotes?: string,
  mealType?: MealType
): Promise<AIMealAnalysisResult> {
  // 1. Direct Anthropic Messages API with authorized console key
  if (auth.claudeApiKey.trim()) {
    const model = auth.claudeModel || 'claude-sonnet-4-20250514';
    const contentBlocks: Record<string, unknown>[] = [];
    if (imageBase64) {
      contentBlocks.push({
        type: 'image',
        source: {
          type: 'base64',
          media_type: mimeType,
          data: imageBase64,
        },
      });
    }
    contentBlocks.push({
      type: 'text',
      text: buildUserPrompt(mealType, userNotes, Boolean(imageBase64)),
    });

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': auth.claudeApiKey.trim(),
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model,
        max_tokens: 1600,
        temperature: 0.2,
        system: NUTRITION_SYSTEM_PROMPT,
        messages: [{ role: 'user', content: contentBlocks }],
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(
        `Claude API error (${res.status}): ${errText.slice(0, 220)}`
      );
    }

    const data = await res.json();
    const text = Array.isArray(data?.content)
      ? data.content
          .filter((b: { type?: string }) => b.type === 'text')
          .map((b: { text?: string }) => b.text || '')
          .join('')
      : '';
    const parsed = extractJsonFromText(text);
    return normalizeAnalysisPayload(parsed, 'claude', model);
  }

  // 2. Optional Companion Server when reachable
  if (
    auth.companionUrl.trim() &&
    !isLocalhostUrlOnNativeDevice(auth.companionUrl)
  ) {
    const probe = await probeCompanionQuickly(
      auth.companionUrl,
      auth.companionToken,
      900
    );
    if (probe?.ok && probe.serverProviders?.claude) {
      return callCompanionAnalyze(auth, {
        provider: 'claude',
        imageBase64,
        mimeType,
        userNotes,
        mealType,
        model: auth.claudeModel,
      });
    }
  }

  throw new Error(
    'Claude is not connected yet. Open Settings and tap "Get Claude Key ↗" or Sign in with ChatGPT.'
  );
}

async function getValidOnDeviceChatGPTToken(
  auth: ProviderAuthConfig
): Promise<{ token: string; session: ChatGPTOnDeviceSession } | null> {
  const session = auth.chatgptOAuth;
  if (!session?.connected) return null;

  const nowSec = Math.floor(Date.now() / 1000);
  if (
    session.accessToken &&
    (!session.expiresAt || session.expiresAt - 60 > nowSec)
  ) {
    return { token: session.accessToken, session };
  }

  if (session.refreshToken && session.clientId) {
    try {
      const isCodexClient =
        session.oauthMode === 'codex' ||
        session.clientId === OPENAI_CODEX_CLIENT_ID;
      const tokenUrl = isCodexClient
        ? OPENAI_CODEX_OAUTH_TOKEN_URL
        : OPENAI_SIWC_TOKEN_URL;
      const formFields: Record<string, string> = {
        grant_type: 'refresh_token',
        client_id: session.clientId,
        refresh_token: session.refreshToken,
      };
      if (!isCodexClient) {
        formFields.resource = OPENAI_RESOURCE;
      }

      const res = await fetch(tokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: encodeFormBody(formFields),
      });

      if (res.ok) {
        const tokenData = (await res.json()) as Record<string, unknown>;
        const newAccess = String(tokenData.access_token || '').trim();
        const newRefresh =
          String(tokenData.refresh_token || '').trim() || session.refreshToken;
        const newIdToken =
          typeof tokenData.id_token === 'string' ? tokenData.id_token : '';
        const expiresIn = Number(tokenData.expires_in) || 3600;

        if (newAccess) {
          const refreshedAccountId =
            extractChatGPTAccountId(newIdToken, newAccess) ||
            session.chatgptAccountId;
          const updatedSession: ChatGPTOnDeviceSession = {
            ...session,
            connected: true,
            accessToken: newAccess,
            refreshToken: newRefresh,
            expiresAt: Math.floor(Date.now() / 1000) + expiresIn,
            chatgptAccountId: refreshedAccountId,
          };
          try {
            const latestAuth = await loadAuthConfig();
            await saveAuthConfig({
              ...latestAuth,
              chatgptOAuth: updatedSession,
            });
          } catch {
            // Ignore background persistence race
          }
          return { token: newAccess, session: updatedSession };
        }
      }
    } catch {
      // Fall back to existing accessToken if network refresh encountered a transient failure
    }
  }

  if (session.accessToken) {
    return { token: session.accessToken, session };
  }
  return null;
}

function extractOpenAIResponsesText(data: Record<string, unknown>): string {
  if (typeof data.output_text === 'string' && data.output_text.trim()) {
    return data.output_text;
  }
  const chunks: string[] = [];
  if (Array.isArray(data.output)) {
    for (const item of data.output) {
      if (!item || typeof item !== 'object') continue;
      const contentArr = (item as Record<string, unknown>).content;
      if (!Array.isArray(contentArr)) continue;
      for (const part of contentArr) {
        if (!part || typeof part !== 'object') continue;
        const textVal = (part as Record<string, unknown>).text;
        if (typeof textVal === 'string') {
          chunks.push(textVal);
        }
      }
    }
  }
  return chunks.join('');
}

function parseOpenAISseOrJsonBody(rawBody: string): string {
  const trimmed = rawBody.trim();
  if (!trimmed) {
    throw new Error('Empty response from OpenAI.');
  }

  if (trimmed.startsWith('{')) {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    if (parsed.error && typeof parsed.error === 'object') {
      const errMsg = String(
        (parsed.error as Record<string, unknown>).message || 'OpenAI error'
      );
      throw new Error(errMsg);
    }
    return extractOpenAIResponsesText(parsed);
  }

  const deltaChunks: string[] = [];
  let doneText = '';
  let completedText = '';

  for (const rawLine of trimmed.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line.startsWith('data:')) continue;
    const payloadStr = line.slice(5).trim();
    if (!payloadStr || payloadStr === '[DONE]') continue;

    let evt: Record<string, unknown>;
    try {
      evt = JSON.parse(payloadStr) as Record<string, unknown>;
    } catch {
      continue;
    }

    const evtType = String(evt.type || '');
    if (evtType === 'error' || evtType === 'response.failed') {
      const errObj =
        (evt.error as Record<string, unknown> | undefined) ||
        ((evt.response as Record<string, unknown> | undefined)?.error as
          | Record<string, unknown>
          | undefined);
      const errMsg = String(
        errObj?.message || evt.message || 'OpenAI stream error'
      );
      throw new Error(errMsg);
    }

    if (
      evtType === 'response.output_text.delta' &&
      typeof evt.delta === 'string'
    ) {
      deltaChunks.push(evt.delta);
    } else if (
      evtType === 'response.output_text.done' &&
      typeof evt.text === 'string'
    ) {
      doneText = evt.text;
    } else if (
      evtType === 'response.completed' &&
      evt.response &&
      typeof evt.response === 'object'
    ) {
      completedText = extractOpenAIResponsesText(
        evt.response as Record<string, unknown>
      );
    }
  }

  return deltaChunks.join('') || doneText || completedText;
}

let cachedPlanModel: { tokenPrefix: string; model: string; expiresAt: number } | null =
  null;

async function selectAccessibleOpenAIPlanModel(
  oauthToken: string,
  preferredModel?: string
): Promise<string> {
  const tokenPrefix = oauthToken.slice(0, 24);
  if (
    cachedPlanModel &&
    cachedPlanModel.tokenPrefix === tokenPrefix &&
    cachedPlanModel.expiresAt > Date.now()
  ) {
    return cachedPlanModel.model;
  }

  const priorityOrder = [
    preferredModel,
    'gpt-5.4-mini',
    'gpt-5.4',
    'gpt-5.2',
    'gpt-5-mini',
    'gpt-5',
    'gpt-4.1',
    'gpt-4o',
    'gpt-4o-mini',
  ].filter((m): m is string => Boolean(m && m.trim()));

  try {
    const res = await fetch(OPENAI_PUBLIC_MODELS_URL, {
      method: 'GET',
      headers: { Authorization: `Bearer ${oauthToken}` },
    });
    if (res.ok) {
      const json = (await res.json()) as { data?: { id?: string }[] };
      const available = new Set(
        (json.data || [])
          .map((item) => (typeof item?.id === 'string' ? item.id.trim() : ''))
          .filter(Boolean)
      );
      for (const candidate of priorityOrder) {
        if (available.has(candidate)) {
          cachedPlanModel = {
            tokenPrefix,
            model: candidate,
            expiresAt: Date.now() + 10 * 60 * 1000,
          };
          return candidate;
        }
      }
      const firstGpt = Array.from(available).find((id) =>
        /^gpt-(5|4o|4\.1)/i.test(id)
      );
      if (firstGpt) {
        cachedPlanModel = {
          tokenPrefix,
          model: firstGpt,
          expiresAt: Date.now() + 10 * 60 * 1000,
        };
        return firstGpt;
      }
    }
  } catch {
    // ignore catalog lookup failure and use fallback
  }

  return preferredModel || 'gpt-5';
}

function buildOpenAIResponsesContent(
  imageBase64?: string,
  mimeType: string = 'image/jpeg',
  userNotes?: string,
  mealType?: MealType
): Record<string, unknown>[] {
  const responsesContent: Record<string, unknown>[] = [
    {
      type: 'input_text',
      text: buildUserPrompt(mealType, userNotes, Boolean(imageBase64)),
    },
  ];
  if (imageBase64) {
    responsesContent.push({
      type: 'input_image',
      image_url: `data:${mimeType};base64,${imageBase64}`,
    });
  }
  return responsesContent;
}

async function callDirectOpenAIPlanResponses(
  oauthToken: string,
  preferredModel: string | undefined,
  responsesContent: Record<string, unknown>[]
): Promise<AIMealAnalysisResult> {
  const selectedModel = await selectAccessibleOpenAIPlanModel(
    oauthToken,
    preferredModel
  );
  const candidateModels = Array.from(
    new Set([selectedModel, 'gpt-5', 'gpt-4o'])
  );

  let lastStatus = 0;
  let lastErr = '';

  for (const model of candidateModels) {
    const res = await fetch(OPENAI_PUBLIC_RESPONSES_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${oauthToken}`,
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
      },
      body: JSON.stringify({
        model,
        instructions: NUTRITION_SYSTEM_PROMPT,
        input: [{ role: 'user', content: responsesContent }],
        store: false,
        stream: true,
      }),
    });

    if (res.ok) {
      const rawBody = await res.text();
      const text = parseOpenAISseOrJsonBody(rawBody);
      const parsed = extractJsonFromText(text);
      return normalizeAnalysisPayload(parsed, 'gpt', model);
    }

    lastStatus = res.status;
    lastErr = await res.text();
    if (res.status === 401 || res.status === 403) {
      break;
    }
  }

  const err = new Error(
    `OpenAI Responses API error (${lastStatus}): ${lastErr.slice(0, 220)}`
  ) as Error & { status?: number };
  err.status = lastStatus;
  throw err;
}

async function callCodexSubscriptionResponses(
  oauthToken: string,
  accountId: string | undefined,
  responsesContent: Record<string, unknown>[]
): Promise<AIMealAnalysisResult> {
  const resolvedAccountId =
    accountId || extractChatGPTAccountId(oauthToken);
  const headers: Record<string, string> = {
    Authorization: `Bearer ${oauthToken}`,
    'Content-Type': 'application/json',
    Accept: 'text/event-stream',
    'OpenAI-Beta': 'responses=experimental',
    originator: 'codex_cli_rs',
  };
  if (resolvedAccountId) {
    headers['chatgpt-account-id'] = resolvedAccountId;
  }

  const candidateModels = [
    'gpt-5.4',
    'gpt-5.3-codex',
    'gpt-5.2-codex',
    'gpt-5.2',
    'gpt-5-codex',
    'gpt-5',
  ];
  let lastStatus = 0;
  let lastErr = '';

  for (const model of candidateModels) {
    const res = await fetch(OPENAI_CODEX_RESPONSES_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model,
        instructions: NUTRITION_SYSTEM_PROMPT,
        input: [{ role: 'user', content: responsesContent }],
        store: false,
        stream: true,
      }),
    });

    if (res.ok) {
      const rawBody = await res.text();
      const text = parseOpenAISseOrJsonBody(rawBody);
      const parsed = extractJsonFromText(text);
      return normalizeAnalysisPayload(parsed, 'gpt', model);
    }

    lastStatus = res.status;
    lastErr = await res.text();
    if (res.status === 401 || res.status === 403) {
      break;
    }
  }

  throw new Error(
    `ChatGPT subscription inference error (${lastStatus}): ${lastErr.slice(0, 220)}`
  );
}

async function analyzeViaGpt(
  auth: ProviderAuthConfig,
  imageBase64?: string,
  mimeType: string = 'image/jpeg',
  userNotes?: string,
  mealType?: MealType
): Promise<AIMealAnalysisResult> {
  let apiKeyError: Error | null = null;

  // 1. Direct OpenAI API key when entered on-device (falls through to ChatGPT OAuth if connected and key quota fails)
  if (auth.openaiApiKey.trim()) {
    const model = auth.gptModel || 'gpt-4o';
    const userContent: Record<string, unknown>[] = [
      {
        type: 'text',
        text: buildUserPrompt(mealType, userNotes, Boolean(imageBase64)),
      },
    ];
    if (imageBase64) {
      userContent.push({
        type: 'image_url',
        image_url: { url: `data:${mimeType};base64,${imageBase64}` },
      });
    }

    const requestBody: Record<string, unknown> = {
      model,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: NUTRITION_SYSTEM_PROMPT },
        { role: 'user', content: userContent },
      ],
    };
    if (!/^(gpt-5|o1|o3|o4)/i.test(model)) {
      requestBody.temperature = 0.2;
    }

    try {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${auth.openaiApiKey.trim()}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
      });

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(
          `OpenAI API error (${res.status}): ${errText.slice(0, 220)}`
        );
      }

      const data = await res.json();
      const content = data?.choices?.[0]?.message?.content || '';
      const parsed = extractJsonFromText(content);
      return normalizeAnalysisPayload(parsed, 'gpt', model);
    } catch (err) {
      apiKeyError = err instanceof Error ? err : new Error(String(err));
      if (!auth.chatgptOAuth?.connected) {
        throw apiKeyError;
      }
    }
  }

  // 2. Direct On-Device "Sign in with ChatGPT" OAuth session (no server hosting needed)
  if (auth.chatgptOAuth?.connected) {
    const valid = await getValidOnDeviceChatGPTToken(auth);
    if (valid?.token) {
      const responsesContent = buildOpenAIResponsesContent(
        imageBase64,
        mimeType,
        userNotes,
        mealType
      );
      const isCodexSession =
        valid.session.oauthMode === 'codex' ||
        valid.session.clientId === OPENAI_CODEX_CLIENT_ID;

      if (isCodexSession) {
        try {
          return await callCodexSubscriptionResponses(
            valid.token,
            valid.session.chatgptAccountId,
            responsesContent
          );
        } catch (codexErr) {
          try {
            return await callDirectOpenAIPlanResponses(
              valid.token,
              auth.gptModel,
              responsesContent
            );
          } catch {
            throw codexErr;
          }
        }
      }

      try {
        return await callDirectOpenAIPlanResponses(
          valid.token,
          auth.gptModel,
          responsesContent
        );
      } catch (siwcErr) {
        try {
          return await callCodexSubscriptionResponses(
            valid.token,
            valid.session.chatgptAccountId,
            responsesContent
          );
        } catch {
          throw siwcErr;
        }
      }
    }
  }

  // 3. Optional Companion Server if reachable on desktop / LAN
  if (
    auth.companionUrl.trim() &&
    !isLocalhostUrlOnNativeDevice(auth.companionUrl)
  ) {
    const probe = await probeCompanionQuickly(
      auth.companionUrl,
      auth.companionToken,
      900
    );
    if (
      probe?.ok &&
      (probe.chatgptOAuth?.connected || probe.serverProviders?.gpt)
    ) {
      return callCompanionAnalyze(auth, {
        provider: 'gpt',
        imageBase64,
        mimeType,
        userNotes,
        mealType,
        model: auth.gptModel,
      });
    }
  }

  if (apiKeyError) {
    throw apiKeyError;
  }

  throw new Error(
    'GPT is not signed in yet. Open Settings and tap "Sign in with ChatGPT" or paste an OpenAI key.'
  );
}
