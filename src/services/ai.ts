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
  AIConnectionTestResult,
  AIDiagnosticLogEntry,
  AILogLevel,
  AIMealAnalysisResult,
  AIProviderId,
  ChatGPTOnDeviceSession,
  CompanionStatusResponse,
  MealItem,
  MealType,
  ProviderAuthConfig,
} from '../types/models';
import {
  loadAIDiagnosticLogs,
  loadAuthConfig,
  loadPendingChatGPTPkce,
  saveAIDiagnosticLogs,
  saveAuthConfig,
  savePendingChatGPTPkce,
} from './storage';
import { stripImageMetadataBase64 } from '../utils/imagePrivacy';

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
const CODEX_CLIENT_VERSION = '0.99.0';
const OPENAI_CODEX_MODELS_URL = `https://chatgpt.com/backend-api/codex/models?client_version=${CODEX_CLIENT_VERSION}`;
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

const MAX_DIAGNOSTIC_LOGS = 60;
let diagnosticLogsMemory: AIDiagnosticLogEntry[] = [];
let diagnosticLogsHydrated = false;
let diagnosticLogsHydratePromise: Promise<AIDiagnosticLogEntry[]> | null = null;
const diagnosticListeners = new Set<(logs: AIDiagnosticLogEntry[]) => void>();
const chatgptSessionListeners = new Set<
  (session: ChatGPTOnDeviceSession) => void
>();
let inFlightChatGPTRefresh: Promise<{
  token: string;
  session: ChatGPTOnDeviceSession;
} | null> | null = null;

export function subscribeChatGPTSessionRefresh(
  listener: (session: ChatGPTOnDeviceSession) => void
): () => void {
  chatgptSessionListeners.add(listener);
  return () => {
    chatgptSessionListeners.delete(listener);
  };
}

function notifyChatGPTSessionRefresh(session: ChatGPTOnDeviceSession): void {
  for (const fn of chatgptSessionListeners) {
    try {
      fn(session);
    } catch {
      // ignore listener errors
    }
  }
}

export function redactSensitiveText(raw: string): string {
  if (!raw) return '';
  return raw
    .replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/gi, 'Bearer [REDACTED]')
    .replace(/\bsk-[A-Za-z0-9_-]{12,}/g, 'sk-[REDACTED]')
    .replace(/\bAIza[A-Za-z0-9_-]{16,}/g, 'AIza[REDACTED]')
    .replace(
      /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
      '[REDACTED_JWT]'
    )
    .replace(
      /([?&](?:key|api_key|access_token|refresh_token|id_token|client_secret|code|code_verifier|token)=)[^&\s#"']+/gi,
      '$1[REDACTED]'
    )
    .replace(
      /\b((?:refresh_token|access_token|id_token|code|code_verifier|client_secret|subject_token|api_key)=)[^&\s#"']+/gi,
      '$1[REDACTED]'
    )
    .replace(
      /("(?:access_token|refresh_token|id_token|api_key|apikey|client_secret|code_verifier|companionToken|openaiApiKey|claudeApiKey|geminiApiKey|x-api-key|x-goog-api-key|authorization)"\s*:\s*")[^"]+"/gi,
      '$1[REDACTED]"'
    )
    .replace(
      /data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=\s]{40,}/gi,
      'data:image/[REDACTED_BASE64]'
    );
}

function notifyDiagnosticListeners(): void {
  const snapshot = [...diagnosticLogsMemory];
  for (const fn of diagnosticListeners) {
    try {
      fn(snapshot);
    } catch {
      // ignore listener errors
    }
  }
}

export async function ensureAIDiagnosticLogsLoaded(): Promise<
  AIDiagnosticLogEntry[]
> {
  if (diagnosticLogsHydrated) {
    return diagnosticLogsMemory;
  }
  if (!diagnosticLogsHydratePromise) {
    diagnosticLogsHydratePromise = (async () => {
      const stored = await loadAIDiagnosticLogs();
      if (stored.length > 0 && diagnosticLogsMemory.length === 0) {
        diagnosticLogsMemory = stored.slice(-MAX_DIAGNOSTIC_LOGS);
      } else if (stored.length > 0) {
        const existingIds = new Set(diagnosticLogsMemory.map((e) => e.id));
        const merged = [
          ...stored.filter((e) => !existingIds.has(e.id)),
          ...diagnosticLogsMemory,
        ].slice(-MAX_DIAGNOSTIC_LOGS);
        diagnosticLogsMemory = merged;
      }
      diagnosticLogsHydrated = true;
      notifyDiagnosticListeners();
      return diagnosticLogsMemory;
    })();
  }
  return diagnosticLogsHydratePromise;
}

export function getAIDiagnosticLogs(): AIDiagnosticLogEntry[] {
  if (!diagnosticLogsHydrated) {
    void ensureAIDiagnosticLogsLoaded();
  }
  return [...diagnosticLogsMemory];
}

export function subscribeAIDiagnosticLogs(
  listener: (logs: AIDiagnosticLogEntry[]) => void
): () => void {
  diagnosticListeners.add(listener);
  void ensureAIDiagnosticLogsLoaded();
  return () => {
    diagnosticListeners.delete(listener);
  };
}

export async function clearAIDiagnosticLogs(): Promise<void> {
  diagnosticLogsMemory = [];
  diagnosticLogsHydrated = true;
  notifyDiagnosticListeners();
  await saveAIDiagnosticLogs([]);
}

export function logAIDiagnostic(
  level: AILogLevel,
  scope: string,
  message: string,
  detail?: string
): void {
  const entry: AIDiagnosticLogEntry = {
    id: `log_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    timestamp: new Date().toISOString(),
    level,
    scope,
    message: redactSensitiveText(message),
    detail: detail ? redactSensitiveText(detail).slice(0, 1800) : undefined,
  };
  diagnosticLogsMemory = [...diagnosticLogsMemory, entry].slice(
    -MAX_DIAGNOSTIC_LOGS
  );
  notifyDiagnosticListeners();
  void saveAIDiagnosticLogs(diagnosticLogsMemory);
}

export function formatAIDiagnosticLogsText(
  logs: AIDiagnosticLogEntry[] = diagnosticLogsMemory
): string {
  const { fullBadge, sdkLabel } = getAppVersionMetadata();
  const header = `Plate AI Diagnostics (${fullBadge} · ${sdkLabel} · ${Platform.OS})`;
  if (!logs.length) {
    return `${header}\nNo AI diagnostic events recorded yet.`;
  }
  const lines = logs.map((entry) => {
    const timePart = entry.timestamp.replace('T', ' ').replace('Z', ' UTC');
    const base = `[${timePart}] [${entry.level.toUpperCase()}] [${entry.scope}] ${entry.message}`;
    return entry.detail ? `${base}\n  ${entry.detail}` : base;
  });
  return `${header}\n\n${lines.join('\n\n')}`;
}

async function fetchTextWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs = 35000
): Promise<{ status: number; ok: boolean; bodyText: string; durationMs: number }> {
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      ...init,
      signal: controller.signal,
    });
    const bodyText = await res.text();
    return {
      status: res.status,
      ok: res.ok,
      bodyText,
      durationMs: Date.now() - started,
    };
  } catch (err) {
    const elapsed = Date.now() - started;
    if (controller.signal.aborted) {
      throw new Error(
        `Network timeout after ${(elapsed / 1000).toFixed(1)}s contacting ${redactSensitiveText(url)}`
      );
    }
    const rawMsg = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Network error contacting ${redactSensitiveText(url)}: ${rawMsg}`
    );
  } finally {
    clearTimeout(timer);
  }
}

function extractCleanServerError(
  rawBody: string,
  status: number,
  prefix: string
): string {
  const trimmed = rawBody.trim();
  if (!trimmed) {
    return `${prefix} (HTTP ${status} — empty error response)`;
  }
  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    if (parsed.error && typeof parsed.error === 'object') {
      const errObj = parsed.error as Record<string, unknown>;
      const msg = String(errObj.message || errObj.code || trimmed);
      const code = errObj.code ? ` [${String(errObj.code)}]` : '';
      return redactSensitiveText(`${prefix} (HTTP ${status}${code}): ${msg}`);
    }
    if (typeof parsed.detail === 'string' && parsed.detail.trim()) {
      return redactSensitiveText(`${prefix} (HTTP ${status}): ${parsed.detail.trim()}`);
    }
    if (typeof parsed.message === 'string' && parsed.message.trim()) {
      return redactSensitiveText(`${prefix} (HTTP ${status}): ${parsed.message.trim()}`);
    }
  } catch {
    // non-JSON response (e.g. HTML gateway or plain text)
  }
  const htmlTitle = trimmed.match(/<title[^>]*>([^<]+)<\/title>/i);
  if (htmlTitle?.[1]) {
    return redactSensitiveText(`${prefix} (HTTP ${status}): ${htmlTitle[1].trim()}`);
  }
  return redactSensitiveText(`${prefix} (HTTP ${status}): ${trimmed.slice(0, 420)}`);
}

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

function isLocalOrPrivateHost(hostname: string): boolean {
  const host = hostname.trim().toLowerCase().replace(/^\[|\]$/g, '');
  if (
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '::1' ||
    host.endsWith('.local')
  ) {
    return true;
  }
  if (/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host)) return true;
  if (/^192\.168\.\d{1,3}\.\d{1,3}$/.test(host)) return true;
  if (/^172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}$/.test(host)) return true;
  if (/^100\.(6[4-9]|[7-9]\d|1[0-1]\d|12[0-7])\.\d{1,3}\.\d{1,3}$/.test(host)) {
    return true;
  }
  return false;
}

export function assertSecureCompanionUrl(rawUrl: string): string {
  const baseUrl = rawUrl.trim().replace(/\/+$/, '');
  if (!baseUrl) {
    throw new Error(
      'Please enter your Companion Backend URL (e.g. http://localhost:8787).'
    );
  }
  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    throw new Error('Invalid Companion Backend URL format.');
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error('Companion Backend URL must use https:// or local http://.');
  }
  if (parsed.protocol === 'http:' && !isLocalOrPrivateHost(parsed.hostname)) {
    throw new Error(
      'Remote Companion URLs must use https:// to keep your credentials and meal data encrypted. Plain http:// is only permitted for localhost and private LAN addresses.'
    );
  }
  return baseUrl;
}

function isAllowedCompanionMessageOrigin(
  eventOrigin: string,
  companionBaseUrl: string
): boolean {
  if (!eventOrigin) return false;
  try {
    const evt = new URL(eventOrigin);
    const comp = new URL(companionBaseUrl);
    if (evt.origin === comp.origin) return true;
    const loopbackSet = new Set(['localhost', '127.0.0.1', '[::1]']);
    if (
      loopbackSet.has(evt.hostname.toLowerCase()) &&
      loopbackSet.has(comp.hostname.toLowerCase()) &&
      evt.port === comp.port &&
      evt.protocol === comp.protocol
    ) {
      return true;
    }
    return false;
  } catch {
    return false;
  }
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
  const baseUrl = assertSecureCompanionUrl(companionUrl);

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
        if (!isAllowedCompanionMessageOrigin(event.origin, baseUrl)) return;
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
  let baseUrl = '';
  try {
    baseUrl = assertSecureCompanionUrl(companionUrl);
  } catch {
    return null;
  }
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
      logAIDiagnostic(
        'error',
        'oauth/codex',
        `Token exchange failed (HTTP ${res.status})`,
        errText
      );
      throw new Error(
        extractCleanServerError(errText, res.status, 'OpenAI token exchange failed')
      );
    }

    const tokenData = (await res.json()) as Record<string, unknown>;
    const accessToken = String(tokenData.access_token || '').trim();
    const refreshToken = String(tokenData.refresh_token || '').trim();
    const idToken = String(tokenData.id_token || '').trim();
    if (!accessToken) {
      logAIDiagnostic('error', 'oauth/codex', 'OpenAI token response had no access_token');
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

    logAIDiagnostic(
      'ok',
      'oauth/codex',
      `Signed in with ChatGPT (${email || 'account connected'})`,
      `oauthMode=codex · expiresIn=${expiresIn}s · accountId=${chatgptAccountId ? 'present' : 'none'} · refreshToken=${refreshToken ? 'present' : 'none'}`
    );

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
  let baseUrl = '';
  try {
    baseUrl = assertSecureCompanionUrl(companionUrl);
  } catch {
    return null;
  }
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
  const baseUrl = assertSecureCompanionUrl(companionUrl);
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

  const sanitizedImageBase64 = imageBase64
    ? stripImageMetadataBase64(imageBase64)
    : undefined;

  const effectiveProvider = resolveReadyProvider(provider, auth, null);
  const imageKb = sanitizedImageBase64
    ? `${Math.round((sanitizedImageBase64.length * 0.75) / 1024)} KB`
    : 'none';
  logAIDiagnostic(
    'info',
    `scan/${effectiveProvider}`,
    `Starting meal analysis (provider=${effectiveProvider}, image=${imageKb}, mealType=${mealType || 'auto'})`,
    userNotes?.trim() ? `Notes: ${userNotes.trim()}` : undefined
  );

  try {
    let result: AIMealAnalysisResult;
    if (effectiveProvider === 'antigravity') {
      result = await analyzeViaAntigravityOrGemini(
        auth,
        sanitizedImageBase64,
        mimeType,
        userNotes,
        mealType
      );
    } else if (effectiveProvider === 'claude') {
      result = await analyzeViaClaude(
        auth,
        sanitizedImageBase64,
        mimeType,
        userNotes,
        mealType
      );
    } else {
      result = await analyzeViaGpt(
        auth,
        sanitizedImageBase64,
        mimeType,
        userNotes,
        mealType
      );
    }

    logAIDiagnostic(
      'ok',
      `scan/${result.providerUsed}`,
      `Meal analyzed: "${result.title}" (${result.calories} kcal · model=${result.modelUsed || 'default'})`
    );
    return result;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logAIDiagnostic(
      'error',
      `scan/${effectiveProvider}`,
      `Meal analysis failed: ${msg}`
    );
    throw err;
  }
}

interface RichAIError extends Error {
  httpStatus?: number;
  endpoint?: string;
  modelAttempted?: string;
}

function makeRichAIError(
  message: string,
  meta?: { httpStatus?: number; endpoint?: string; modelAttempted?: string }
): RichAIError {
  const err = new Error(message) as RichAIError;
  if (meta?.httpStatus !== undefined) err.httpStatus = meta.httpStatus;
  if (meta?.endpoint) err.endpoint = meta.endpoint;
  if (meta?.modelAttempted) err.modelAttempted = meta.modelAttempted;
  return err;
}

const CONNECTION_TEST_SYSTEM =
  'You are Plate AI, a concise metric nutrition assistant. Reply in 1 short plain-text sentence (under 28 words).';
const CONNECTION_TEST_PROMPT =
  'Reply in one short sentence confirming Plate AI is connected and working, and state the approximate calories in 100 g of apple.';

export async function verifyAIConnection(
  auth: ProviderAuthConfig,
  preferredProvider?: AIProviderId,
  companionStatus: CompanionStatusResponse | null = null
): Promise<AIConnectionTestResult> {
  const startedAt = Date.now();
  const targetProvider = preferredProvider || auth.activeProvider;
  const statusInfo = isProviderConfigured(
    targetProvider,
    auth,
    companionStatus
  );

  logAIDiagnostic(
    'info',
    `verify/${targetProvider}`,
    `Sending test message to ${targetProvider.toUpperCase()} (${statusInfo.methodLabel})…`,
    `Prompt: "${CONNECTION_TEST_PROMPT}"`
  );

  try {
    if (targetProvider === 'antigravity') {
      if (auth.geminiApiKey.trim()) {
        const preferredModel = auth.geminiModel || 'gemini-2.5-flash';
        const candidateModels = Array.from(
          new Set([preferredModel, 'gemini-2.5-flash', 'gemini-2.0-flash'])
        );
        let lastStatus = 0;
        let lastBody = '';
        let lastModel = candidateModels[0] || 'gemini-2.5-flash';

        for (const model of candidateModels) {
          lastModel = model;
          const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
          const res = await fetchTextWithTimeout(
            endpoint,
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'x-goog-api-key': auth.geminiApiKey.trim(),
              },
              body: JSON.stringify({
                contents: [
                  {
                    parts: [
                      {
                        text: `${CONNECTION_TEST_SYSTEM}\n\n${CONNECTION_TEST_PROMPT}`,
                      },
                    ],
                  },
                ],
                generationConfig: {
                  temperature: 0.2,
                  maxOutputTokens: 120,
                },
              }),
            },
            25000
          );

          if (res.ok) {
            const data = JSON.parse(res.bodyText);
            const replyText = String(
              data?.candidates?.[0]?.content?.parts?.[0]?.text || ''
            ).trim();
            const latencyMs = Date.now() - startedAt;
            logAIDiagnostic(
              'ok',
              'verify/antigravity',
              `Gemini responded in ${latencyMs} ms (model=${model})`,
              `Reply: ${replyText || '(empty text)'}`
            );
            return {
              ok: true,
              provider: 'antigravity',
              authMethod: 'Google AI Studio Key',
              modelUsed: model,
              endpoint,
              httpStatus: res.status,
              latencyMs,
              replyText: replyText || 'Connected (received HTTP 200 OK).',
              timestamp: new Date().toISOString(),
            };
          }

          lastStatus = res.status;
          lastBody = res.bodyText;
          logAIDiagnostic(
            res.status === 404 ? 'warn' : 'error',
            'verify/antigravity',
            `Gemini ${model} returned HTTP ${res.status} (${res.durationMs} ms)`,
            res.bodyText
          );
          if (res.status !== 404) break;
        }

        throw makeRichAIError(
          extractCleanServerError(lastBody, lastStatus, 'Google Gemini API error'),
          {
            httpStatus: lastStatus,
            endpoint: `https://generativelanguage.googleapis.com/v1beta/models/${lastModel}:generateContent`,
            modelAttempted: lastModel,
          }
        );
      }

      if (
        auth.companionUrl.trim() &&
        !isLocalhostUrlOnNativeDevice(auth.companionUrl)
      ) {
        const probe = await probeCompanionQuickly(
          auth.companionUrl,
          auth.companionToken,
          1200
        );
        if (probe?.ok) {
          const compRes = await callCompanionAnalyze(auth, {
            provider: 'antigravity',
            mimeType: 'image/jpeg',
            userNotes: '100 g apple',
            mealType: 'snack',
          });
          const latencyMs = Date.now() - startedAt;
          const replyText = `${compRes.title} — ${compRes.calories} kcal (${compRes.summary})`;
          logAIDiagnostic(
            'ok',
            'verify/antigravity',
            `Companion Antigravity responded in ${latencyMs} ms`,
            replyText
          );
          return {
            ok: true,
            provider: 'antigravity',
            authMethod: statusInfo.methodLabel,
            modelUsed: compRes.modelUsed || 'companion-antigravity',
            endpoint: `${normalizeBaseUrl(auth.companionUrl)}/api/analyze`,
            httpStatus: 200,
            latencyMs,
            replyText,
            timestamp: new Date().toISOString(),
          };
        }
      }

      throw makeRichAIError(
        'Google AI is not connected yet. Tap "Authorize on Google AI Studio ↗" and paste your AIzaSy... key, or switch to the OpenAI GPT tab.'
      );
    }

    if (targetProvider === 'claude') {
      if (auth.claudeApiKey.trim()) {
        const model = auth.claudeModel || 'claude-sonnet-4-20250514';
        const endpoint = 'https://api.anthropic.com/v1/messages';
        const res = await fetchTextWithTimeout(
          endpoint,
          {
            method: 'POST',
            headers: {
              'x-api-key': auth.claudeApiKey.trim(),
              'anthropic-version': '2023-06-01',
              'anthropic-dangerous-direct-browser-access': 'true',
              'content-type': 'application/json',
            },
            body: JSON.stringify({
              model,
              max_tokens: 120,
              temperature: 0.2,
              system: CONNECTION_TEST_SYSTEM,
              messages: [{ role: 'user', content: CONNECTION_TEST_PROMPT }],
            }),
          },
          25000
        );

        if (!res.ok) {
          logAIDiagnostic(
            'error',
            'verify/claude',
            `Claude ${model} returned HTTP ${res.status} (${res.durationMs} ms)`,
            res.bodyText
          );
          throw makeRichAIError(
            extractCleanServerError(res.bodyText, res.status, 'Claude API error'),
            {
              httpStatus: res.status,
              endpoint,
              modelAttempted: model,
            }
          );
        }

        const data = JSON.parse(res.bodyText);
        const replyText = Array.isArray(data?.content)
          ? data.content
              .filter((b: { type?: string }) => b.type === 'text')
              .map((b: { text?: string }) => b.text || '')
              .join('')
              .trim()
          : '';
        const latencyMs = Date.now() - startedAt;
        logAIDiagnostic(
          'ok',
          'verify/claude',
          `Claude responded in ${latencyMs} ms (model=${model})`,
          `Reply: ${replyText}`
        );
        return {
          ok: true,
          provider: 'claude',
          authMethod: 'Anthropic Console Key',
          modelUsed: model,
          endpoint,
          httpStatus: res.status,
          latencyMs,
          replyText: replyText || 'Connected (received HTTP 200 OK).',
          timestamp: new Date().toISOString(),
        };
      }

      if (
        auth.companionUrl.trim() &&
        !isLocalhostUrlOnNativeDevice(auth.companionUrl)
      ) {
        const probe = await probeCompanionQuickly(
          auth.companionUrl,
          auth.companionToken,
          1200
        );
        if (probe?.ok && probe.serverProviders?.claude) {
          const compRes = await callCompanionAnalyze(auth, {
            provider: 'claude',
            mimeType: 'image/jpeg',
            userNotes: '100 g apple',
            mealType: 'snack',
            model: auth.claudeModel,
          });
          const latencyMs = Date.now() - startedAt;
          const replyText = `${compRes.title} — ${compRes.calories} kcal`;
          logAIDiagnostic(
            'ok',
            'verify/claude',
            `Companion Claude responded in ${latencyMs} ms`,
            replyText
          );
          return {
            ok: true,
            provider: 'claude',
            authMethod: 'Companion Anthropic Key',
            modelUsed: compRes.modelUsed || auth.claudeModel,
            endpoint: `${normalizeBaseUrl(auth.companionUrl)}/api/analyze`,
            httpStatus: 200,
            latencyMs,
            replyText,
            timestamp: new Date().toISOString(),
          };
        }
      }

      throw makeRichAIError(
        'Claude is not connected yet. Tap "Authorize on Anthropic Console ↗" and paste your sk-ant-... key.'
      );
    }

    // OpenAI GPT provider test
    let apiKeyError: RichAIError | null = null;
    if (auth.openaiApiKey.trim()) {
      const model = auth.gptModel || 'gpt-4o';
      const endpoint = 'https://api.openai.com/v1/chat/completions';
      const requestBody: Record<string, unknown> = {
        model,
        messages: [
          { role: 'system', content: CONNECTION_TEST_SYSTEM },
          { role: 'user', content: CONNECTION_TEST_PROMPT },
        ],
      };
      if (!/^(gpt-5|o1|o3|o4)/i.test(model)) {
        requestBody.temperature = 0.2;
      }

      try {
        const res = await fetchTextWithTimeout(
          endpoint,
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${auth.openaiApiKey.trim()}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(requestBody),
          },
          25000
        );

        if (!res.ok) {
          logAIDiagnostic(
            auth.chatgptOAuth?.connected ? 'warn' : 'error',
            'verify/gpt-key',
            `OpenAI API key request returned HTTP ${res.status} (${res.durationMs} ms)`,
            res.bodyText
          );
          throw makeRichAIError(
            extractCleanServerError(res.bodyText, res.status, 'OpenAI API error'),
            { httpStatus: res.status, endpoint, modelAttempted: model }
          );
        }

        const data = JSON.parse(res.bodyText);
        const replyText = String(
          data?.choices?.[0]?.message?.content || ''
        ).trim();
        const latencyMs = Date.now() - startedAt;
        logAIDiagnostic(
          'ok',
          'verify/gpt-key',
          `OpenAI responded in ${latencyMs} ms (model=${model})`,
          `Reply: ${replyText}`
        );
        return {
          ok: true,
          provider: 'gpt',
          authMethod: 'OpenAI Platform Key',
          modelUsed: model,
          endpoint,
          httpStatus: res.status,
          latencyMs,
          replyText: replyText || 'Connected (received HTTP 200 OK).',
          timestamp: new Date().toISOString(),
        };
      } catch (err) {
        apiKeyError =
          err instanceof Error
            ? (err as RichAIError)
            : makeRichAIError(String(err));
        if (!auth.chatgptOAuth?.connected) {
          throw apiKeyError;
        }
        logAIDiagnostic(
          'info',
          'verify/gpt',
          'OpenAI API key failed; falling back to connected ChatGPT SSO session…'
        );
      }
    }

    if (auth.chatgptOAuth?.connected) {
      const testContent: Record<string, unknown>[] = [
        { type: 'input_text', text: CONNECTION_TEST_PROMPT },
      ];
      const oauthReply = await executeOnDeviceChatGPTResponses(auth, {
        instructions: CONNECTION_TEST_SYSTEM,
        responsesContent: testContent,
        requiresVision: false,
        timeoutMs: 25000,
        scopePrefix: 'verify',
      });
      const latencyMs = Date.now() - startedAt;
      const cleanedReply = oauthReply.text.trim();
      logAIDiagnostic(
        'ok',
        'verify/gpt-sso',
        `ChatGPT SSO responded in ${latencyMs} ms (model=${oauthReply.modelUsed})`,
        `Reply: ${cleanedReply}`
      );
      return {
        ok: true,
        provider: 'gpt',
        authMethod: auth.chatgptOAuth.email
          ? `ChatGPT SSO (${auth.chatgptOAuth.email})`
          : 'ChatGPT SSO',
        modelUsed: oauthReply.modelUsed,
        endpoint: oauthReply.endpoint,
        httpStatus: 200,
        latencyMs,
        replyText: cleanedReply || 'Connected (received HTTP 200 OK).',
        timestamp: new Date().toISOString(),
      };
    }

    if (
      auth.companionUrl.trim() &&
      !isLocalhostUrlOnNativeDevice(auth.companionUrl)
    ) {
      const probe = await probeCompanionQuickly(
        auth.companionUrl,
        auth.companionToken,
        1200
      );
      if (
        probe?.ok &&
        (probe.chatgptOAuth?.connected || probe.serverProviders?.gpt)
      ) {
        const compRes = await callCompanionAnalyze(auth, {
          provider: 'gpt',
          mimeType: 'image/jpeg',
          userNotes: '100 g apple',
          mealType: 'snack',
          model: auth.gptModel,
        });
        const latencyMs = Date.now() - startedAt;
        const replyText = `${compRes.title} — ${compRes.calories} kcal`;
        logAIDiagnostic(
          'ok',
          'verify/gpt-companion',
          `Companion GPT responded in ${latencyMs} ms`,
          replyText
        );
        return {
          ok: true,
          provider: 'gpt',
          authMethod: statusInfo.methodLabel,
          modelUsed: compRes.modelUsed || auth.gptModel,
          endpoint: `${normalizeBaseUrl(auth.companionUrl)}/api/analyze`,
          httpStatus: 200,
          latencyMs,
          replyText,
          timestamp: new Date().toISOString(),
        };
      }
    }

    if (apiKeyError) {
      throw apiKeyError;
    }

    throw makeRichAIError(
      'OpenAI GPT is not signed in yet. Tap "Sign in with ChatGPT" above or paste an OpenAI sk-... key.'
    );
  } catch (err) {
    const rich = err as RichAIError;
    const errorMessage = err instanceof Error ? err.message : String(err);
    const latencyMs = Date.now() - startedAt;
    logAIDiagnostic(
      'error',
      `verify/${targetProvider}`,
      `Verification failed after ${latencyMs} ms: ${errorMessage}`,
      rich?.endpoint
        ? `Endpoint: ${rich.endpoint}${rich.modelAttempted ? ` · Model: ${rich.modelAttempted}` : ''}${rich.httpStatus ? ` · HTTP ${rich.httpStatus}` : ''}`
        : undefined
    );
    return {
      ok: false,
      provider: targetProvider,
      authMethod: statusInfo.methodLabel,
      modelUsed: rich?.modelAttempted,
      endpoint: rich?.endpoint,
      httpStatus: rich?.httpStatus,
      latencyMs,
      errorMessage,
      timestamp: new Date().toISOString(),
    };
  }
}

export async function testAIProviderConnection(
  auth: ProviderAuthConfig,
  preferredProvider?: AIProviderId
): Promise<{
  providerUsed: AIProviderId;
  modelUsed?: string;
  title: string;
  replyText?: string;
  latencyMs?: number;
}> {
  const res = await verifyAIConnection(auth, preferredProvider, null);
  if (!res.ok) {
    throw new Error(res.errorMessage || 'AI connection test failed');
  }
  return {
    providerUsed: res.provider,
    modelUsed: res.modelUsed,
    title: res.replyText || 'Connected',
    replyText: res.replyText,
    latencyMs: res.latencyMs,
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
  const baseUrl = assertSecureCompanionUrl(auth.companionUrl);
  const endpoint = `${baseUrl}/api/analyze`;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...buildCompanionHeaders(auth.companionToken),
  };

  logAIDiagnostic(
    'info',
    `companion/${payload.provider}`,
    `POST ${endpoint}`
  );
  const res = await fetchTextWithTimeout(
    endpoint,
    {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    },
    45000
  );

  if (!res.ok) {
    logAIDiagnostic(
      'error',
      `companion/${payload.provider}`,
      `Companion returned HTTP ${res.status} (${res.durationMs} ms)`,
      res.bodyText
    );
    throw makeRichAIError(
      extractCleanServerError(
        res.bodyText,
        res.status,
        'Companion server error'
      ),
      { httpStatus: res.status, endpoint }
    );
  }

  const data = JSON.parse(res.bodyText);
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
    let lastModel = candidateModels[0] || 'gemini-2.5-flash';

    for (const model of candidateModels) {
      lastModel = model;
      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
      logAIDiagnostic('info', 'gemini/api', `POST ${endpoint}`);
      const res = await fetchTextWithTimeout(
        endpoint,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': auth.geminiApiKey.trim(),
          },
          body: JSON.stringify({
            contents: [{ parts }],
            generationConfig: {
              responseMimeType: 'application/json',
              temperature: 0.2,
            },
          }),
        },
        45000
      );

      if (res.ok) {
        const data = JSON.parse(res.bodyText);
        const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
        const parsed = extractJsonFromText(text);
        return normalizeAnalysisPayload(parsed, 'antigravity', model);
      }

      lastStatus = res.status;
      lastError = res.bodyText;
      logAIDiagnostic(
        res.status === 404 ? 'warn' : 'error',
        'gemini/api',
        `Gemini ${model} returned HTTP ${res.status} (${res.durationMs} ms)`,
        res.bodyText
      );
      if (res.status !== 404) {
        break;
      }
    }

    throw makeRichAIError(
      extractCleanServerError(lastError, lastStatus, 'Google Gemini API error'),
      {
        httpStatus: lastStatus,
        endpoint: `https://generativelanguage.googleapis.com/v1beta/models/${lastModel}:generateContent`,
        modelAttempted: lastModel,
      }
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
    const endpoint = 'https://api.anthropic.com/v1/messages';
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

    logAIDiagnostic('info', 'claude/api', `POST ${endpoint} (model=${model})`);
    const res = await fetchTextWithTimeout(
      endpoint,
      {
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
      },
      45000
    );

    if (!res.ok) {
      logAIDiagnostic(
        'error',
        'claude/api',
        `Claude ${model} returned HTTP ${res.status} (${res.durationMs} ms)`,
        res.bodyText
      );
      throw makeRichAIError(
        extractCleanServerError(res.bodyText, res.status, 'Claude API error'),
        { httpStatus: res.status, endpoint, modelAttempted: model }
      );
    }

    const data = JSON.parse(res.bodyText);
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
    'Claude is not connected yet. Open Settings and tap "Authorize on Anthropic Console ↗" or Sign in with ChatGPT.'
  );
}

async function getValidOnDeviceChatGPTToken(
  auth: ProviderAuthConfig,
  forceRefresh = false
): Promise<{ token: string; session: ChatGPTOnDeviceSession } | null> {
  let session = auth.chatgptOAuth;
  if (!session?.connected) return null;

  const nowSec = Math.floor(Date.now() / 1000);
  let remainingSec = session.expiresAt ? session.expiresAt - nowSec : 3600;

  if (
    !forceRefresh &&
    session.accessToken &&
    (!session.expiresAt || remainingSec > 60)
  ) {
    return { token: session.accessToken, session };
  }

  // Check persisted storage first in case a rotated token was already saved
  try {
    const storedAuth = await loadAuthConfig();
    const storedSession = storedAuth.chatgptOAuth;
    if (storedSession?.connected) {
      const storedRemaining = storedSession.expiresAt
        ? storedSession.expiresAt - nowSec
        : 0;
      if (
        !forceRefresh &&
        storedSession.accessToken &&
        storedRemaining > 60 &&
        storedSession.accessToken !== session.accessToken
      ) {
        notifyChatGPTSessionRefresh(storedSession);
        return { token: storedSession.accessToken, session: storedSession };
      }
      if ((storedSession.expiresAt ?? 0) >= (session.expiresAt ?? 0)) {
        session = storedSession;
        remainingSec = storedSession.expiresAt
          ? storedSession.expiresAt - nowSec
          : 3600;
      }
    }
  } catch {
    // Proceed with in-memory session
  }

  if (session.refreshToken && session.clientId) {
    if (inFlightChatGPTRefresh) {
      return inFlightChatGPTRefresh;
    }

    const activeSession = session;
    const isCodexClient =
      activeSession.oauthMode === 'codex' ||
      activeSession.clientId === OPENAI_CODEX_CLIENT_ID;
    const tokenUrl = isCodexClient
      ? OPENAI_CODEX_OAUTH_TOKEN_URL
      : OPENAI_SIWC_TOKEN_URL;
    const formFields: Record<string, string> = {
      grant_type: 'refresh_token',
      client_id: activeSession.clientId!,
      refresh_token: activeSession.refreshToken!,
    };
    if (!isCodexClient) {
      formFields.resource = OPENAI_RESOURCE;
    }

    const refreshTask = (async (): Promise<{
      token: string;
      session: ChatGPTOnDeviceSession;
    } | null> => {
      logAIDiagnostic(
        'info',
        'oauth/refresh',
        `Refreshing ChatGPT OAuth token (${isCodexClient ? 'codex' : 'siwc'}, force=${forceRefresh})…`
      );

      try {
        const res = await fetchTextWithTimeout(
          tokenUrl,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: encodeFormBody(formFields),
          },
          15000
        );

        if (res.ok) {
          const tokenData = JSON.parse(res.bodyText) as Record<string, unknown>;
          const newAccess = String(tokenData.access_token || '').trim();
          const newRefresh =
            String(tokenData.refresh_token || '').trim() ||
            activeSession.refreshToken;
          const newIdToken =
            typeof tokenData.id_token === 'string' ? tokenData.id_token : '';
          const expiresIn = Number(tokenData.expires_in) || 3600;

          if (newAccess) {
            const refreshedAccountId =
              extractChatGPTAccountId(newIdToken, newAccess) ||
              activeSession.chatgptAccountId;
            const updatedSession: ChatGPTOnDeviceSession = {
              ...activeSession,
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
            notifyChatGPTSessionRefresh(updatedSession);
            logAIDiagnostic(
              'ok',
              'oauth/refresh',
              `ChatGPT OAuth token refreshed (valid for ${Math.round(expiresIn / 60)}m)`
            );
            return { token: newAccess, session: updatedSession };
          }
        } else {
          const cleanDetail = extractCleanServerError(
            res.bodyText,
            res.status,
            'Token refresh failed'
          );
          logAIDiagnostic(
            'error',
            'oauth/refresh',
            `Token refresh failed (HTTP ${res.status}): ${cleanDetail}`,
            res.bodyText
          );
          if (forceRefresh || (activeSession.expiresAt && remainingSec <= 0)) {
            throw makeRichAIError(
              `ChatGPT login expired and token refresh failed (${cleanDetail}). Open Settings → Sign out, then Sign in with ChatGPT again.`,
              { httpStatus: res.status, endpoint: tokenUrl }
            );
          }
        }
      } catch (err) {
        if (
          err instanceof Error &&
          err.message.includes('ChatGPT login expired')
        ) {
          throw err;
        }
        logAIDiagnostic(
          'warn',
          'oauth/refresh',
          `Token refresh encountered error: ${err instanceof Error ? err.message : String(err)}`
        );
        if (forceRefresh) {
          throw err;
        }
      }

      if (activeSession.accessToken) {
        return { token: activeSession.accessToken, session: activeSession };
      }
      return null;
    })();

    inFlightChatGPTRefresh = refreshTask;
    try {
      return await refreshTask;
    } finally {
      inFlightChatGPTRefresh = null;
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

  const combined = deltaChunks.join('') || doneText || completedText;
  if (!combined) {
    throw new Error(
      `Unexpected stream format from OpenAI (${trimmed.slice(0, 180)})`
    );
  }
  return combined;
}

interface DiscoveredCodexModel {
  slug: string;
  supportsImage: boolean;
}

let cachedCodexCatalog: {
  tokenPrefix: string;
  models: DiscoveredCodexModel[];
  expiresAt: number;
} | null = null;

function buildCodexHeaders(
  oauthToken: string,
  accountId: string | undefined,
  accept: string = 'text/event-stream'
): Record<string, string> {
  const resolvedAccountId = accountId || extractChatGPTAccountId(oauthToken);
  const headers: Record<string, string> = {
    Authorization: `Bearer ${oauthToken}`,
    'Content-Type': 'application/json',
    Accept: accept,
    'OpenAI-Beta': 'responses=experimental',
    originator: 'codex_cli_rs',
    'User-Agent': `codex_cli_rs/${CODEX_CLIENT_VERSION}`,
  };
  if (resolvedAccountId) {
    headers['ChatGPT-Account-ID'] = resolvedAccountId;
  }
  return headers;
}

async function selectAccessibleCodexModels(
  oauthToken: string,
  accountId: string | undefined,
  requiresVision: boolean
): Promise<string[]> {
  const defaultFallbacks = [
    'gpt-5.3-codex',
    'gpt-5.4',
    'gpt-5.2-codex',
    'gpt-5.2',
    'gpt-5-codex',
    'gpt-5',
  ];

  const tokenPrefix = oauthToken.slice(0, 24);
  let catalogModels: DiscoveredCodexModel[] | null = null;

  if (
    cachedCodexCatalog &&
    cachedCodexCatalog.tokenPrefix === tokenPrefix &&
    cachedCodexCatalog.expiresAt > Date.now()
  ) {
    catalogModels = cachedCodexCatalog.models;
  } else {
    try {
      const res = await fetchTextWithTimeout(
        OPENAI_CODEX_MODELS_URL,
        {
          method: 'GET',
          headers: buildCodexHeaders(oauthToken, accountId, 'application/json'),
        },
        5500
      );
      if (res.ok) {
        const parsed = JSON.parse(res.bodyText) as {
          models?: Record<string, unknown>[];
          data?: Record<string, unknown>[];
        };
        const rawList = Array.isArray(parsed.models)
          ? parsed.models
          : Array.isArray(parsed.data)
            ? parsed.data
            : [];
        const extracted: DiscoveredCodexModel[] = [];
        for (const entry of rawList) {
          if (!entry || typeof entry !== 'object') continue;
          const slug = String(entry.slug || entry.id || '').trim();
          if (!slug) continue;
          const inputModalities = Array.isArray(entry.input)
            ? entry.input.map((x) => String(x).toLowerCase())
            : Array.isArray(entry.input_modalities)
              ? entry.input_modalities.map((x) => String(x).toLowerCase())
              : null;
          const supportsImage = inputModalities
            ? inputModalities.includes('image')
            : true;
          extracted.push({ slug, supportsImage });
        }
        if (extracted.length > 0) {
          catalogModels = extracted;
          cachedCodexCatalog = {
            tokenPrefix,
            models: extracted,
            expiresAt: Date.now() + 10 * 60 * 1000,
          };
          logAIDiagnostic(
            'ok',
            'codex/models',
            `Discovered ${extracted.length} permitted ChatGPT model(s) in ${res.durationMs} ms`,
            extracted.map((m) => m.slug).join(', ')
          );
        }
      } else {
        logAIDiagnostic(
          'warn',
          'codex/models',
          `Model catalog returned HTTP ${res.status}; using default model candidates`,
          res.bodyText
        );
      }
    } catch (err) {
      logAIDiagnostic(
        'warn',
        'codex/models',
        `Model catalog lookup skipped: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  if (!catalogModels || catalogModels.length === 0) {
    return defaultFallbacks;
  }

  const eligible = requiresVision
    ? catalogModels.filter((m) => m.supportsImage)
    : catalogModels;
  const pool = eligible.length > 0 ? eligible : catalogModels;
  const poolSlugs = pool.map((m) => m.slug);
  const poolSet = new Set(poolSlugs);

  const preferredOrder = [
    'gpt-5.4-mini',
    'gpt-5.4',
    'gpt-5.3-codex',
    'gpt-5.2-codex',
    'gpt-5.2',
    'gpt-5-codex-mini',
    'gpt-5-codex',
    'gpt-5',
  ];

  const ordered: string[] = [];
  for (const pref of preferredOrder) {
    if (poolSet.has(pref)) {
      ordered.push(pref);
    }
  }
  for (const s of poolSlugs) {
    if (!ordered.includes(s)) {
      ordered.push(s);
    }
  }

  return ordered.slice(0, 4);
}

let cachedPlanModel: {
  tokenPrefix: string;
  model: string;
  expiresAt: number;
} | null = null;

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
    const res = await fetchTextWithTimeout(
      OPENAI_PUBLIC_MODELS_URL,
      {
        method: 'GET',
        headers: { Authorization: `Bearer ${oauthToken}` },
      },
      5500
    );
    if (res.ok) {
      const json = JSON.parse(res.bodyText) as { data?: { id?: string }[] };
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
  mealType?: MealType,
  includeImageDetail = true
): Record<string, unknown>[] {
  const responsesContent: Record<string, unknown>[] = [
    {
      type: 'input_text',
      text: buildUserPrompt(mealType, userNotes, Boolean(imageBase64)),
    },
  ];
  if (imageBase64) {
    const imgBlock: Record<string, unknown> = {
      type: 'input_image',
      image_url: `data:${mimeType};base64,${imageBase64}`,
    };
    if (includeImageDetail) {
      imgBlock.detail = 'auto';
    }
    responsesContent.push(imgBlock);
  }
  return responsesContent;
}

function stripDetailFromImageContent(
  responsesContent: Record<string, unknown>[]
): Record<string, unknown>[] {
  return responsesContent.map((part) => {
    if (part.type === 'input_image' && 'detail' in part) {
      const rest = { ...part };
      delete rest.detail;
      return rest;
    }
    return part;
  });
}

async function runPublicOpenAIResponsesRaw(
  oauthToken: string,
  preferredModel: string | undefined,
  instructions: string,
  responsesContent: Record<string, unknown>[],
  timeoutMs = 40000,
  scopePrefix = 'scan'
): Promise<{ text: string; modelUsed: string; endpoint: string }> {
  const selectedModel = await selectAccessibleOpenAIPlanModel(
    oauthToken,
    preferredModel
  );
  const candidateModels = Array.from(
    new Set([selectedModel, 'gpt-5', 'gpt-4o'])
  );

  let lastStatus = 0;
  let lastErr = '';
  let lastModel = candidateModels[0] || 'gpt-5';

  for (const model of candidateModels) {
    lastModel = model;
    logAIDiagnostic(
      'info',
      `${scopePrefix}/oai-responses`,
      `POST ${OPENAI_PUBLIC_RESPONSES_URL} (model=${model})`
    );
    const res = await fetchTextWithTimeout(
      OPENAI_PUBLIC_RESPONSES_URL,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${oauthToken}`,
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
        },
        body: JSON.stringify({
          model,
          instructions,
          input: [
            {
              type: 'message',
              role: 'user',
              content: responsesContent,
            },
          ],
          store: false,
          stream: true,
        }),
      },
      timeoutMs
    );

    if (res.ok) {
      const text = parseOpenAISseOrJsonBody(res.bodyText);
      logAIDiagnostic(
        'ok',
        `${scopePrefix}/oai-responses`,
        `200 OK from ${model} in ${res.durationMs} ms`
      );
      return {
        text,
        modelUsed: model,
        endpoint: OPENAI_PUBLIC_RESPONSES_URL,
      };
    }

    lastStatus = res.status;
    lastErr = res.bodyText;
    logAIDiagnostic(
      res.status === 401 ? 'error' : 'warn',
      `${scopePrefix}/oai-responses`,
      `Model ${model} returned HTTP ${res.status} (${res.durationMs} ms)`,
      res.bodyText
    );
    if (res.status === 401 || res.status === 403) {
      break;
    }
  }

  throw makeRichAIError(
    extractCleanServerError(
      lastErr,
      lastStatus,
      'OpenAI Responses API error'
    ),
    {
      httpStatus: lastStatus,
      endpoint: OPENAI_PUBLIC_RESPONSES_URL,
      modelAttempted: lastModel,
    }
  );
}

async function runCodexSubscriptionResponsesRaw(
  oauthToken: string,
  accountId: string | undefined,
  instructions: string,
  responsesContent: Record<string, unknown>[],
  requiresVision: boolean,
  timeoutMs = 40000,
  scopePrefix = 'scan'
): Promise<{ text: string; modelUsed: string; endpoint: string }> {
  const headers = buildCodexHeaders(oauthToken, accountId, 'text/event-stream');
  const candidateModels = await selectAccessibleCodexModels(
    oauthToken,
    accountId,
    requiresVision
  );

  let lastStatus = 0;
  let lastErr = '';
  let lastModel = candidateModels[0] || 'gpt-5.3-codex';

  for (const model of candidateModels) {
    lastModel = model;
    logAIDiagnostic(
      'info',
      `${scopePrefix}/codex`,
      `POST ${OPENAI_CODEX_RESPONSES_URL} (model=${model})`
    );

    let res = await fetchTextWithTimeout(
      OPENAI_CODEX_RESPONSES_URL,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model,
          instructions,
          input: [
            {
              type: 'message',
              role: 'user',
              content: responsesContent,
            },
          ],
          store: false,
          stream: true,
        }),
      },
      timeoutMs
    );

    // If a model schema rejects `detail` on input_image, retry immediately without `detail`
    if (
      !res.ok &&
      requiresVision &&
      (res.status === 400 || res.status === 422) &&
      /detail/i.test(res.bodyText)
    ) {
      const strippedContent = stripDetailFromImageContent(responsesContent);
      res = await fetchTextWithTimeout(
        OPENAI_CODEX_RESPONSES_URL,
        {
          method: 'POST',
          headers,
          body: JSON.stringify({
            model,
            instructions,
            input: [
              {
                type: 'message',
                role: 'user',
                content: strippedContent,
              },
            ],
            store: false,
            stream: true,
          }),
        },
        timeoutMs
      );
    }

    if (res.ok) {
      const text = parseOpenAISseOrJsonBody(res.bodyText);
      logAIDiagnostic(
        'ok',
        `${scopePrefix}/codex`,
        `200 OK from ${model} in ${res.durationMs} ms`
      );
      return {
        text,
        modelUsed: model,
        endpoint: OPENAI_CODEX_RESPONSES_URL,
      };
    }

    lastStatus = res.status;
    lastErr = res.bodyText;
    logAIDiagnostic(
      res.status === 401 ? 'error' : 'warn',
      `${scopePrefix}/codex`,
      `Codex ${model} returned HTTP ${res.status} (${res.durationMs} ms)`,
      res.bodyText
    );

    // Only stop trying fallback models on 401 (invalid token), NOT on model-specific 400/403/404
    if (res.status === 401) {
      break;
    }
  }

  throw makeRichAIError(
    extractCleanServerError(
      lastErr,
      lastStatus,
      'ChatGPT subscription inference error'
    ),
    {
      httpStatus: lastStatus,
      endpoint: OPENAI_CODEX_RESPONSES_URL,
      modelAttempted: lastModel,
    }
  );
}

async function executeOnDeviceChatGPTResponses(
  auth: ProviderAuthConfig,
  options: {
    instructions: string;
    responsesContent: Record<string, unknown>[];
    requiresVision: boolean;
    timeoutMs?: number;
    scopePrefix?: string;
  }
): Promise<{ text: string; modelUsed: string; endpoint: string }> {
  const {
    instructions,
    responsesContent,
    requiresVision,
    timeoutMs = 40000,
    scopePrefix = 'scan',
  } = options;

  const attemptWithToken = async (
    token: string,
    session: ChatGPTOnDeviceSession
  ) => {
    const isCodexSession =
      session.oauthMode === 'codex' ||
      session.clientId === OPENAI_CODEX_CLIENT_ID;

    if (isCodexSession) {
      try {
        return await runCodexSubscriptionResponsesRaw(
          token,
          session.chatgptAccountId,
          instructions,
          responsesContent,
          requiresVision,
          timeoutMs,
          scopePrefix
        );
      } catch (codexErr) {
        const codexRich = codexErr as RichAIError;
        if (codexRich?.httpStatus === 401) {
          throw codexErr;
        }
        try {
          return await runPublicOpenAIResponsesRaw(
            token,
            auth.gptModel,
            instructions,
            responsesContent,
            timeoutMs,
            scopePrefix
          );
        } catch {
          throw codexErr;
        }
      }
    }

    try {
      return await runPublicOpenAIResponsesRaw(
        token,
        auth.gptModel,
        instructions,
        responsesContent,
        timeoutMs,
        scopePrefix
      );
    } catch (siwcErr) {
      const siwcRich = siwcErr as RichAIError;
      if (siwcRich?.httpStatus === 401) {
        throw siwcErr;
      }
      try {
        return await runCodexSubscriptionResponsesRaw(
          token,
          session.chatgptAccountId,
          instructions,
          responsesContent,
          requiresVision,
          timeoutMs,
          scopePrefix
        );
      } catch {
        throw siwcErr;
      }
    }
  };

  const valid = await getValidOnDeviceChatGPTToken(auth, false);
  if (!valid?.token) {
    throw makeRichAIError(
      'ChatGPT session has no valid token saved. Open Settings → Sign out, then Sign in with ChatGPT again.'
    );
  }

  try {
    return await attemptWithToken(valid.token, valid.session);
  } catch (firstErr) {
    const firstRich = firstErr as RichAIError;
    if (firstRich?.httpStatus === 401 && valid.session.refreshToken) {
      logAIDiagnostic(
        'warn',
        `${scopePrefix}/oauth`,
        'Access token returned HTTP 401 — refreshing OAuth token and retrying once…'
      );
      const refreshed = await getValidOnDeviceChatGPTToken(auth, true);
      if (refreshed?.token) {
        return await attemptWithToken(refreshed.token, refreshed.session);
      }
    }
    throw firstErr;
  }
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
    const endpoint = 'https://api.openai.com/v1/chat/completions';
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
      logAIDiagnostic('info', 'scan/gpt-key', `POST ${endpoint} (model=${model})`);
      const res = await fetchTextWithTimeout(
        endpoint,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${auth.openaiApiKey.trim()}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(requestBody),
        },
        45000
      );

      if (!res.ok) {
        logAIDiagnostic(
          auth.chatgptOAuth?.connected ? 'warn' : 'error',
          'scan/gpt-key',
          `OpenAI API key returned HTTP ${res.status} (${res.durationMs} ms)`,
          res.bodyText
        );
        throw makeRichAIError(
          extractCleanServerError(res.bodyText, res.status, 'OpenAI API error'),
          { httpStatus: res.status, endpoint, modelAttempted: model }
        );
      }

      const data = JSON.parse(res.bodyText);
      const content = data?.choices?.[0]?.message?.content || '';
      const parsed = extractJsonFromText(content);
      return normalizeAnalysisPayload(parsed, 'gpt', model);
    } catch (err) {
      apiKeyError = err instanceof Error ? err : new Error(String(err));
      if (!auth.chatgptOAuth?.connected) {
        throw apiKeyError;
      }
      logAIDiagnostic(
        'info',
        'scan/gpt',
        'OpenAI API key failed; falling back to connected ChatGPT SSO session…'
      );
    }
  }

  // 2. Direct On-Device "Sign in with ChatGPT" OAuth session (no server hosting needed)
  if (auth.chatgptOAuth?.connected) {
    const responsesContent = buildOpenAIResponsesContent(
      imageBase64,
      mimeType,
      userNotes,
      mealType,
      true
    );
    const rawResult = await executeOnDeviceChatGPTResponses(auth, {
      instructions: NUTRITION_SYSTEM_PROMPT,
      responsesContent,
      requiresVision: Boolean(imageBase64),
      timeoutMs: 45000,
      scopePrefix: 'scan',
    });
    const parsed = extractJsonFromText(rawResult.text);
    return normalizeAnalysisPayload(parsed, 'gpt', rawResult.modelUsed);
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
