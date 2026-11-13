import * as WebBrowser from 'expo-web-browser';
import { Platform } from 'react-native';
import { computeHealthScoreFromMacros } from '../constants/plateCatalog';
import { getAppVersionMetadata } from '../constants/version';
import {
  AIMealAnalysisResult,
  AIProviderId,
  CompanionStatusResponse,
  MealItem,
  MealType,
  ProviderAuthConfig,
} from '../types/models';

WebBrowser.maybeCompleteAuthSession();

export const PROVIDER_AUTH_PORTALS = {
  antigravity: 'https://aistudio.google.com/apikey',
  claude: 'https://console.anthropic.com/settings/keys',
  gpt: 'https://platform.openai.com/api-keys',
} as const;

const NUTRITION_SYSTEM_PROMPT = `You are an expert registered dietitian and food nutrition analyst for Plate, an iOS calorie tracker app.
Analyze the user's meal from the provided food photo and/or user notes (such as gram weights, home-cooked ingredients, sauces, oils, or portion details).

Rules:
1. If the user specifies exact gram weights, volumes, brands, or ingredients they put into the dish, prioritize those measurements accurately while using the photo to estimate any remaining visible items.
2. Break the meal down into individual food/ingredient items with realistic gram estimates, calories, protein (g), carbs (g), and fat (g).
3. Ensure the top-level calories, protein, carbs, and fat equal the sum of the individual items.
4. Include a "healthScore" integer from 1 to 10 based on nutrient density, whole foods, protein balance, and fiber.
5. Return ONLY valid JSON matching this exact structure:
{
  "title": "Concise appetizing meal name",
  "summary": "1-2 sentence explanation of portion assumptions and key calorie drivers",
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
      "portion": "180g (~1 medium fillet)",
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
  const timeout = setTimeout(() => controller.abort(), 5000);

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

  // Ensure the local companion server is reachable before opening browser SSO
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
    const left = Math.max(0, Math.round(window.screenX + (window.outerWidth - width) / 2));
    const top = Math.max(0, Math.round(window.screenY + (window.outerHeight - height) / 2));
    const popup = window.open(
      startUrl,
      `calorielens_oauth_${options.providerKey}`,
      `width=${width},height=${height},left=${left},top=${top},resizable=yes,scrollbars=yes`
    );

    if (!popup) {
      // If popup blocker intervened, open in a new tab
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
            reject(new Error(data.detail || data.headline || 'OAuth authorization failed.'))
          );
          return;
        }

        try {
          const fresh = await checkCompanionStatus(baseUrl, options.companionToken);
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
          const fresh = await checkCompanionStatus(baseUrl, options.companionToken);
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
          // Give one final check right after popup close
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
          finish(() => reject(new Error('Sign-in window was closed before completing authorization.')));
        }
      }, 1200);

      const overallTimeout = setTimeout(() => {
        finish(() => reject(new Error('Sign-in timed out. Please try again.')));
      }, 180000);
    });
  }

  // Native iOS / Android handling
  const isLanHost =
    /^https?:\/\/(192\.168\.|10\.|172\.(1[6-9]|2\d|3[0-1])\.)/i.test(baseUrl);

  if (isLanHost && options.hostOpenPath) {
    // OpenAI's dynamic_agent_client redirects to 127.0.0.1 on the companion host.
    // Trigger the SSO browser window on the host PC and poll until authorized.
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

  // iOS Simulator (localhost) — open directly in in-app browser
  await WebBrowser.openBrowserAsync(startUrl, {
    presentationStyle: WebBrowser.WebBrowserPresentationStyle.PAGE_SHEET,
  });

  const fresh = await checkCompanionStatus(baseUrl, options.companionToken);
  if (options.isConnected(fresh)) {
    return fresh;
  }
  throw new Error('Authorization was not completed.');
}

/**
 * Launches OpenAI's official "Sign in with ChatGPT" (SIWC) OAuth 2.0 + PKCE flow
 * directly on https://auth.openai.com/api/accounts/authorize.
 */
export async function signInWithChatGPTOAuth(
  companionUrl: string,
  companionToken?: string
): Promise<CompanionStatusResponse> {
  return runCompanionBrowserOAuthFlow({
    companionUrl,
    companionToken,
    startPath: '/api/oauth/openai/start',
    hostOpenPath: '/api/oauth/openai/open-on-host',
    providerKey: 'gpt',
    isConnected: (st) => Boolean(st.chatgptOAuth?.connected),
  });
}

export async function disconnectChatGPTOAuth(
  companionUrl: string,
  companionToken?: string
): Promise<CompanionStatusResponse> {
  const baseUrl = normalizeBaseUrl(companionUrl);
  await fetch(`${baseUrl}/api/oauth/openai/logout`, {
    method: 'POST',
    headers: buildCompanionHeaders(companionToken),
  });
  return checkCompanionStatus(baseUrl, companionToken);
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
    return { ready: false, methodLabel: 'Authorize Google AI' };
  }

  if (provider === 'claude') {
    if (auth.claudeApiKey.trim()) {
      return { ready: true, methodLabel: 'Anthropic Console Key' };
    }
    if (companionStatus?.ok && companionStatus.serverProviders?.claude) {
      return { ready: true, methodLabel: 'Companion Anthropic Key' };
    }
    return { ready: false, methodLabel: 'Authorize on Anthropic' };
  }

  // gpt
  if (companionStatus?.ok && companionStatus.chatgptOAuth?.connected) {
    const email = companionStatus.chatgptOAuth.email;
    return {
      ready: true,
      methodLabel: email ? `ChatGPT SSO (${email})` : 'ChatGPT SSO Connected',
    };
  }
  if (auth.openaiApiKey.trim()) {
    return { ready: true, methodLabel: 'OpenAI Platform Key' };
  }
  if (companionStatus?.ok && companionStatus.serverProviders?.gpt) {
    return { ready: true, methodLabel: 'Companion OpenAI Key' };
  }
  return { ready: false, methodLabel: 'Sign in with ChatGPT' };
}

function buildUserPrompt(
  mealType?: MealType,
  userNotes?: string,
  hasPhoto?: boolean
): string {
  const parts = ['Analyze this meal and output ONLY the requested JSON object.'];
  if (mealType) {
    parts.push(`Meal type: ${mealType}`);
  }
  if (userNotes?.trim()) {
    parts.push(
      `User-provided details (exact grams, ingredients put into it, sauces, cooking method): ${userNotes.trim()}`
    );
  } else if (hasPhoto) {
    parts.push('Estimate realistic gram weights and macros visually from the photo.');
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
      gramsRaw !== null && gramsRaw !== undefined && !Number.isNaN(Number(gramsRaw))
        ? Math.round(Number(gramsRaw))
        : null;

    return {
      id: String(obj.id || `item_${Date.now()}_${index}`),
      name: String(obj.name || `Ingredient ${index + 1}`),
      grams: gramsNum,
      portion: obj.portion
        ? String(obj.portion)
        : gramsNum
          ? `${gramsNum}g`
          : undefined,
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

  if (provider === 'antigravity') {
    return analyzeViaAntigravityOrGemini(
      auth,
      imageBase64,
      mimeType,
      userNotes,
      mealType
    );
  }
  if (provider === 'claude') {
    return analyzeViaClaude(auth, imageBase64, mimeType, userNotes, mealType);
  }
  return analyzeViaGpt(auth, imageBase64, mimeType, userNotes, mealType);
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
  // 1. Try Companion Antigravity SDK / Google OAuth backend first
  if (auth.companionUrl.trim()) {
    try {
      return await callCompanionAnalyze(auth, {
        provider: 'antigravity',
        imageBase64,
        mimeType,
        userNotes,
        mealType,
        apiKey: auth.geminiApiKey.trim() || undefined,
      });
    } catch (companionErr) {
      if (!auth.geminiApiKey.trim()) {
        const msg =
          companionErr instanceof Error
            ? companionErr.message
            : String(companionErr);
        throw new Error(msg);
      }
    }
  }

  // 2. Direct Google Gemini Vision API when an authorized Google AI Studio key is saved on-device
  if (auth.geminiApiKey.trim()) {
    const model = auth.geminiModel || 'gemini-2.5-flash';
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

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Google Gemini API error (${res.status}): ${errText}`);
    }
    const data = await res.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const parsed = extractJsonFromText(text);
    return normalizeAnalysisPayload(parsed, 'antigravity', model);
  }

  throw new Error(
    'Antigravity is not authorized yet. Open Settings and tap "Authorize on Google AI Studio" to connect your Google account.'
  );
}

async function analyzeViaClaude(
  auth: ProviderAuthConfig,
  imageBase64?: string,
  mimeType: string = 'image/jpeg',
  userNotes?: string,
  mealType?: MealType
): Promise<AIMealAnalysisResult> {
  // 1. Route through Companion Server when configured (avoids any browser CORS friction)
  if (auth.companionUrl.trim()) {
    try {
      return await callCompanionAnalyze(auth, {
        provider: 'claude',
        imageBase64,
        mimeType,
        userNotes,
        mealType,
        apiKey: auth.claudeApiKey.trim() || undefined,
        model: auth.claudeModel,
      });
    } catch (companionErr) {
      if (!auth.claudeApiKey.trim()) {
        throw companionErr;
      }
    }
  }

  // 2. Direct Anthropic Messages API with authorized console key
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
      throw new Error(`Claude API error (${res.status}): ${errText}`);
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

  throw new Error(
    'Claude is not authorized yet. Open Settings and tap "Authorize on Anthropic Console" to connect Claude.'
  );
}

async function analyzeViaGpt(
  auth: ProviderAuthConfig,
  imageBase64?: string,
  mimeType: string = 'image/jpeg',
  userNotes?: string,
  mealType?: MealType
): Promise<AIMealAnalysisResult> {
  // 1. Direct OpenAI API key when explicitly entered on-device
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

    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${auth.openaiApiKey.trim()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: NUTRITION_SYSTEM_PROMPT },
          { role: 'user', content: userContent },
        ],
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`OpenAI API error (${res.status}): ${errText}`);
    }

    const data = await res.json();
    const content = data?.choices?.[0]?.message?.content || '';
    const parsed = extractJsonFromText(content);
    return normalizeAnalysisPayload(parsed, 'gpt', model);
  }

  // 2. Companion Server (uses official "Sign in with ChatGPT" OAuth session or server OPENAI_API_KEY)
  if (auth.companionUrl.trim()) {
    return callCompanionAnalyze(auth, {
      provider: 'gpt',
      imageBase64,
      mimeType,
      userNotes,
      mealType,
      model: auth.gptModel,
    });
  }

  throw new Error(
    'GPT is not signed in yet. Open Settings to Sign in with ChatGPT (OpenAI SSO) or authorize an OpenAI key.'
  );
}
