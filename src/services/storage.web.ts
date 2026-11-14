import {
  DEFAULT_PLATE_GOALS,
  DEFAULT_PREFERENCES,
  DEFAULT_USER_PROFILE,
} from '../constants/plateCatalog';
import {
  AIDiagnosticLogEntry,
  AppPreferences,
  ChatGPTOnDeviceSession,
  DailySummary,
  MealEntry,
  ProviderAuthConfig,
  UserGoals,
  UserProfile,
} from '../types/models';

export const DEFAULT_GOALS: UserGoals = DEFAULT_PLATE_GOALS;

export function inferDefaultCompanionUrl(): string {
  return 'http://localhost:8787';
}

export function getDefaultAuthConfig(): ProviderAuthConfig {
  return {
    activeProvider: 'antigravity',
    companionUrl: inferDefaultCompanionUrl(),
    companionToken: '',
    claudeApiKey: '',
    openaiApiKey: '',
    geminiApiKey: '',
    claudeModel: 'claude-sonnet-4-20250514',
    gptModel: 'gpt-4o',
    geminiModel: 'gemini-2.5-flash',
  };
}

const WEB_MEALS_KEY = 'plate_meals_v2';
const LEGACY_WEB_MEALS_KEY = 'calorielens_meals_v1';
const WEB_GOALS_KEY = 'plate_goals_v2';
const LEGACY_WEB_GOALS_KEY = 'calorielens_goals_v1';
const LEGACY_WEB_AUTH_KEY = 'calorielens_auth_v1';
const WEB_AUTH_PREFS_KEY = 'plate_auth_prefs_v2';
const WEB_AUTH_SECRETS_SESSION_KEY = 'plate_auth_secrets_v2';
const WEB_AI_LOGS_SESSION_KEY = 'plate_ai_diagnostic_logs_v1';
const WEB_ONBOARDING_KEY = 'calorielens_onboarded_v1';
const WEB_PROFILE_KEY = 'plate_profile_v1';
const LEGACY_WEB_PROFILE_KEY = 'calorielens_profile_v1';
const WEB_PREFS_KEY = 'plate_prefs_v1';
const LEGACY_WEB_PREFS_KEY = 'calorielens_prefs_v1';
const WEB_WATER_KEY = 'plate_water_v1';
const WEB_STEPS_KEY = 'plate_steps_v1';
const WEB_SEEDED_KEY = 'plate_seeded_v1';
const WEB_PURGED_DEMO_KEY = 'plate_purged_demo_v1';
const WEB_PENDING_PKCE_KEY = 'plate_pending_chatgpt_pkce_v1';

export interface PlatePortableBackup {
  schema: 'plate-backup-v1';
  exportedAt: string;
  goals: UserGoals;
  profile: UserProfile;
  preferences: AppPreferences;
  authPreferences: {
    activeProvider: ProviderAuthConfig['activeProvider'];
    companionUrl: string;
    claudeModel: string;
    gptModel: string;
    geminiModel: string;
  };
  waterByDate: Record<string, number>;
  stepsByDate: Record<string, number>;
  meals: MealEntry[];
}

export interface PendingChatGPTPkceFlow {
  state: string;
  codeVerifier: string;
  nonce: string;
  redirectUri: string;
  clientIdSent: string;
  extAgentHostId: string;
  oauthVariant?: 'siwc' | 'codex';
  createdAt: number;
}

function readWebMeals(): MealEntry[] {
  try {
    const raw =
      globalThis.localStorage?.getItem(WEB_MEALS_KEY) ??
      globalThis.localStorage?.getItem(LEGACY_WEB_MEALS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((m: MealEntry) => ({
      ...m,
      entryType: m.entryType ?? 'food',
      servings: m.servings ?? 1,
      status: 'done',
    }));
  } catch {
    return [];
  }
}

function writeWebMeals(meals: MealEntry[]): void {
  try {
    const sanitized = meals.map((m) => ({
      ...m,
      status: m.status === 'pending' ? 'done' : (m.status ?? 'done'),
    }));
    globalThis.localStorage?.setItem(WEB_MEALS_KEY, JSON.stringify(sanitized));
  } catch {
    // Ignore storage quota errors
  }
}

export async function loadAllMeals(): Promise<MealEntry[]> {
  const meals = readWebMeals();
  return meals.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function upsertMeal(meal: MealEntry): Promise<void> {
  const existing = readWebMeals();
  const idx = existing.findIndex((m) => m.id === meal.id);
  if (idx >= 0) {
    existing[idx] = meal;
  } else {
    existing.unshift(meal);
  }
  writeWebMeals(existing);
}

export async function replaceAllMeals(meals: MealEntry[]): Promise<void> {
  writeWebMeals(meals);
}

export async function deleteMealById(id: string): Promise<void> {
  const filtered = readWebMeals().filter((m) => m.id !== id);
  writeWebMeals(filtered);
}

export function computeDailySummaries(
  meals: MealEntry[]
): Record<string, DailySummary> {
  const map: Record<string, DailySummary> = {};
  for (const meal of meals) {
    if (!map[meal.dateKey]) {
      map[meal.dateKey] = {
        dateKey: meal.dateKey,
        calories: 0,
        protein: 0,
        carbs: 0,
        fat: 0,
        burnedCalories: 0,
        mealCount: 0,
      };
    }
    const day = map[meal.dateKey];
    if (meal.entryType === 'exercise') {
      day.burnedCalories += Math.round(meal.calories || 0);
      continue;
    }
    if (meal.status === 'pending') {
      continue;
    }
    const mult = meal.servings ?? 1;
    day.calories += Math.round((meal.calories || 0) * mult);
    day.protein = Number((day.protein + (meal.protein || 0) * mult).toFixed(1));
    day.carbs = Number((day.carbs + (meal.carbs || 0) * mult).toFixed(1));
    day.fat = Number((day.fat + (meal.fat || 0) * mult).toFixed(1));
    day.mealCount += 1;
  }
  return map;
}

export async function loadGoals(): Promise<UserGoals> {
  try {
    const raw =
      globalThis.localStorage?.getItem(WEB_GOALS_KEY) ??
      globalThis.localStorage?.getItem(LEGACY_WEB_GOALS_KEY);
    if (raw) return { ...DEFAULT_GOALS, ...JSON.parse(raw) };
  } catch {
    // ignore
  }
  return DEFAULT_GOALS;
}

export async function saveGoals(goals: UserGoals): Promise<void> {
  try {
    globalThis.localStorage?.setItem(WEB_GOALS_KEY, JSON.stringify(goals));
  } catch {
    // ignore
  }
}

export async function loadUserProfile(): Promise<UserProfile> {
  try {
    const raw =
      globalThis.localStorage?.getItem(WEB_PROFILE_KEY) ??
      globalThis.localStorage?.getItem(LEGACY_WEB_PROFILE_KEY);
    if (raw) return { ...DEFAULT_USER_PROFILE, ...JSON.parse(raw) };
  } catch {
    // ignore
  }
  return DEFAULT_USER_PROFILE;
}

export async function saveUserProfile(profile: UserProfile): Promise<void> {
  try {
    globalThis.localStorage?.setItem(WEB_PROFILE_KEY, JSON.stringify(profile));
  } catch {
    // ignore
  }
}

export async function loadPreferences(): Promise<AppPreferences> {
  try {
    const raw =
      globalThis.localStorage?.getItem(WEB_PREFS_KEY) ??
      globalThis.localStorage?.getItem(LEGACY_WEB_PREFS_KEY);
    if (raw) return { ...DEFAULT_PREFERENCES, ...JSON.parse(raw) };
  } catch {
    // ignore
  }
  return DEFAULT_PREFERENCES;
}

export async function savePreferences(prefs: AppPreferences): Promise<void> {
  try {
    globalThis.localStorage?.setItem(WEB_PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // ignore
  }
}

export async function loadWaterByDate(): Promise<Record<string, number>> {
  try {
    const raw = globalThis.localStorage?.getItem(WEB_WATER_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : {};
    }
  } catch {
    // ignore
  }
  return {};
}

export async function saveWaterByDate(
  water: Record<string, number>
): Promise<void> {
  try {
    globalThis.localStorage?.setItem(WEB_WATER_KEY, JSON.stringify(water));
  } catch {
    // ignore
  }
}

export async function loadStepsByDate(): Promise<Record<string, number>> {
  try {
    const raw = globalThis.localStorage?.getItem(WEB_STEPS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : {};
    }
  } catch {
    // ignore
  }
  return {};
}

export async function saveStepsByDate(
  steps: Record<string, number>
): Promise<void> {
  try {
    globalThis.localStorage?.setItem(WEB_STEPS_KEY, JSON.stringify(steps));
  } catch {
    // ignore
  }
}

export async function loadHasSeededDemo(): Promise<boolean> {
  try {
    return globalThis.localStorage?.getItem(WEB_SEEDED_KEY) === 'true';
  } catch {
    return false;
  }
}

export async function saveHasSeededDemo(seeded: boolean): Promise<void> {
  try {
    globalThis.localStorage?.setItem(WEB_SEEDED_KEY, seeded ? 'true' : 'false');
  } catch {
    // ignore
  }
}

export async function loadHasPurgedLegacyDemoSeed(): Promise<boolean> {
  try {
    return globalThis.localStorage?.getItem(WEB_PURGED_DEMO_KEY) === 'true';
  } catch {
    return false;
  }
}

export async function saveHasPurgedLegacyDemoSeed(
  purged: boolean
): Promise<void> {
  try {
    globalThis.localStorage?.setItem(
      WEB_PURGED_DEMO_KEY,
      purged ? 'true' : 'false'
    );
  } catch {
    // ignore
  }
}

interface WebAuthSecrets {
  companionToken?: string;
  claudeApiKey?: string;
  openaiApiKey?: string;
  geminiApiKey?: string;
  chatgptAccessToken?: string;
  chatgptRefreshToken?: string;
}

interface WebAuthNonSecretPrefs {
  activeProvider?: ProviderAuthConfig['activeProvider'];
  companionUrl?: string;
  claudeModel?: string;
  gptModel?: string;
  geminiModel?: string;
  chatgptOAuthMeta?: Omit<
    ChatGPTOnDeviceSession,
    'accessToken' | 'refreshToken'
  >;
}

export async function loadAuthConfig(): Promise<ProviderAuthConfig> {
  const defaults = getDefaultAuthConfig();
  let nonSecret: WebAuthNonSecretPrefs = {};
  let secrets: WebAuthSecrets = {};

  try {
    const rawPrefs = globalThis.localStorage?.getItem(WEB_AUTH_PREFS_KEY);
    if (rawPrefs) {
      nonSecret = JSON.parse(rawPrefs) as WebAuthNonSecretPrefs;
    }
  } catch {
    nonSecret = {};
  }

  try {
    const rawSecrets = globalThis.sessionStorage?.getItem(
      WEB_AUTH_SECRETS_SESSION_KEY
    );
    if (rawSecrets) {
      secrets = JSON.parse(rawSecrets) as WebAuthSecrets;
    }
  } catch {
    secrets = {};
  }

  // Migrate and immediately purge any legacy plaintext localStorage auth blob
  try {
    const legacyRaw = globalThis.localStorage?.getItem(LEGACY_WEB_AUTH_KEY);
    if (legacyRaw) {
      const legacy = JSON.parse(legacyRaw) as Partial<ProviderAuthConfig>;
      nonSecret = {
        activeProvider: legacy.activeProvider ?? nonSecret.activeProvider,
        companionUrl: legacy.companionUrl ?? nonSecret.companionUrl,
        claudeModel: legacy.claudeModel ?? nonSecret.claudeModel,
        gptModel: legacy.gptModel ?? nonSecret.gptModel,
        geminiModel: legacy.geminiModel ?? nonSecret.geminiModel,
        chatgptOAuthMeta: legacy.chatgptOAuth
          ? {
              connected: Boolean(legacy.chatgptOAuth.connected),
              clientId: legacy.chatgptOAuth.clientId || '',
              extAgentHostId: legacy.chatgptOAuth.extAgentHostId || '',
              expiresAt: legacy.chatgptOAuth.expiresAt || 0,
              scope: legacy.chatgptOAuth.scope,
              email: legacy.chatgptOAuth.email,
              name: legacy.chatgptOAuth.name,
              chatgptAccountId: legacy.chatgptOAuth.chatgptAccountId,
              oauthMode: legacy.chatgptOAuth.oauthMode,
            }
          : nonSecret.chatgptOAuthMeta,
      };
      secrets = {
        companionToken: legacy.companionToken || secrets.companionToken || '',
        claudeApiKey: legacy.claudeApiKey || secrets.claudeApiKey || '',
        openaiApiKey: legacy.openaiApiKey || secrets.openaiApiKey || '',
        geminiApiKey: legacy.geminiApiKey || secrets.geminiApiKey || '',
        chatgptAccessToken:
          legacy.chatgptOAuth?.accessToken || secrets.chatgptAccessToken || '',
        chatgptRefreshToken:
          legacy.chatgptOAuth?.refreshToken || secrets.chatgptRefreshToken || '',
      };
      globalThis.localStorage?.setItem(
        WEB_AUTH_PREFS_KEY,
        JSON.stringify(nonSecret)
      );
      globalThis.sessionStorage?.setItem(
        WEB_AUTH_SECRETS_SESSION_KEY,
        JSON.stringify(secrets)
      );
      globalThis.localStorage?.removeItem(LEGACY_WEB_AUTH_KEY);
    }
  } catch {
    // ignore migration parse failure
  }

  const meta = nonSecret.chatgptOAuthMeta;
  const accessToken = secrets.chatgptAccessToken || '';
  const refreshToken = secrets.chatgptRefreshToken || '';
  const hasTokens = Boolean(accessToken || refreshToken);
  const chatgptOAuth: ChatGPTOnDeviceSession | undefined =
    meta || hasTokens
      ? {
          connected: meta ? Boolean(meta.connected && hasTokens) : hasTokens,
          accessToken,
          refreshToken,
          clientId: meta?.clientId || '',
          extAgentHostId: meta?.extAgentHostId || '',
          expiresAt: meta?.expiresAt || 0,
          scope: meta?.scope,
          email: meta?.email,
          name: meta?.name,
          chatgptAccountId: meta?.chatgptAccountId,
          oauthMode: meta?.oauthMode,
        }
      : undefined;

  return {
    ...defaults,
    activeProvider: nonSecret.activeProvider || defaults.activeProvider,
    companionUrl: nonSecret.companionUrl || defaults.companionUrl,
    claudeModel: nonSecret.claudeModel || defaults.claudeModel,
    gptModel: nonSecret.gptModel || defaults.gptModel,
    geminiModel: nonSecret.geminiModel || defaults.geminiModel,
    companionToken: secrets.companionToken || '',
    claudeApiKey: secrets.claudeApiKey || '',
    openaiApiKey: secrets.openaiApiKey || '',
    geminiApiKey: secrets.geminiApiKey || '',
    chatgptOAuth,
  };
}

export async function saveAuthConfig(config: ProviderAuthConfig): Promise<void> {
  const oai = config.chatgptOAuth;
  const nonSecret: WebAuthNonSecretPrefs = {
    activeProvider: config.activeProvider,
    companionUrl: config.companionUrl,
    claudeModel: config.claudeModel,
    gptModel: config.gptModel,
    geminiModel: config.geminiModel,
    chatgptOAuthMeta: oai
      ? {
          connected: Boolean(
            oai.connected && (oai.accessToken || oai.refreshToken)
          ),
          clientId: oai.clientId || '',
          extAgentHostId: oai.extAgentHostId || '',
          expiresAt: oai.expiresAt || 0,
          scope: oai.scope,
          email: oai.email,
          name: oai.name,
          chatgptAccountId: oai.chatgptAccountId,
          oauthMode: oai.oauthMode,
        }
      : undefined,
  };
  const secrets: WebAuthSecrets = {
    companionToken: config.companionToken || '',
    claudeApiKey: config.claudeApiKey || '',
    openaiApiKey: config.openaiApiKey || '',
    geminiApiKey: config.geminiApiKey || '',
    chatgptAccessToken: oai?.connected ? oai.accessToken : '',
    chatgptRefreshToken: oai?.connected ? oai.refreshToken : '',
  };

  try {
    globalThis.localStorage?.setItem(
      WEB_AUTH_PREFS_KEY,
      JSON.stringify(nonSecret)
    );
    globalThis.localStorage?.removeItem(LEGACY_WEB_AUTH_KEY);
  } catch {
    // ignore storage write error
  }
  try {
    globalThis.sessionStorage?.setItem(
      WEB_AUTH_SECRETS_SESSION_KEY,
      JSON.stringify(secrets)
    );
  } catch {
    // ignore sessionStorage error
  }
}

export async function loadOnboardingCompleted(): Promise<boolean> {
  try {
    return globalThis.localStorage?.getItem(WEB_ONBOARDING_KEY) === 'true';
  } catch {
    return false;
  }
}

export async function saveOnboardingCompleted(
  completed: boolean
): Promise<void> {
  try {
    globalThis.localStorage?.setItem(
      WEB_ONBOARDING_KEY,
      completed ? 'true' : 'false'
    );
  } catch {
    // ignore
  }
}

export async function loadPendingChatGPTPkce(): Promise<PendingChatGPTPkceFlow | null> {
  try {
    const raw =
      globalThis.sessionStorage?.getItem(WEB_PENDING_PKCE_KEY) ??
      globalThis.localStorage?.getItem(WEB_PENDING_PKCE_KEY);
    globalThis.localStorage?.removeItem(WEB_PENDING_PKCE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PendingChatGPTPkceFlow;
    if (
      !parsed?.state ||
      !parsed?.codeVerifier ||
      Date.now() - (parsed.createdAt || 0) > 20 * 60 * 1000
    ) {
      globalThis.sessionStorage?.removeItem(WEB_PENDING_PKCE_KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export async function savePendingChatGPTPkce(
  flow: PendingChatGPTPkceFlow | null
): Promise<void> {
  try {
    globalThis.localStorage?.removeItem(WEB_PENDING_PKCE_KEY);
    if (!flow) {
      globalThis.sessionStorage?.removeItem(WEB_PENDING_PKCE_KEY);
    } else {
      globalThis.sessionStorage?.setItem(
        WEB_PENDING_PKCE_KEY,
        JSON.stringify(flow)
      );
    }
  } catch {
    // ignore
  }
}

export async function loadAIDiagnosticLogs(): Promise<AIDiagnosticLogEntry[]> {
  try {
    const raw = globalThis.sessionStorage?.getItem(WEB_AI_LOGS_SESSION_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as AIDiagnosticLogEntry[]) : [];
  } catch {
    return [];
  }
}

export async function saveAIDiagnosticLogs(
  logs: AIDiagnosticLogEntry[]
): Promise<void> {
  try {
    const trimmed = logs.slice(-60);
    globalThis.sessionStorage?.setItem(
      WEB_AI_LOGS_SESSION_KEY,
      JSON.stringify(trimmed)
    );
  } catch {
    // ignore sessionStorage error
  }
}

export async function ensureSettingsMirrored(): Promise<void> {
  // Web storage persists directly in browser storage
}

export async function hasStoredUserConfiguration(): Promise<boolean> {
  try {
    const store = globalThis.localStorage;
    if (!store) return false;
    return Boolean(
      store.getItem(WEB_ONBOARDING_KEY) === 'true' ||
        store.getItem(WEB_GOALS_KEY) ||
        store.getItem(LEGACY_WEB_GOALS_KEY) ||
        store.getItem(WEB_PREFS_KEY) ||
        store.getItem(LEGACY_WEB_PREFS_KEY) ||
        store.getItem(WEB_PROFILE_KEY) ||
        store.getItem(LEGACY_WEB_PROFILE_KEY) ||
        store.getItem(WEB_AUTH_PREFS_KEY) ||
        store.getItem(LEGACY_WEB_AUTH_KEY)
    );
  } catch {
    return false;
  }
}

function sanitizeBackupCompanionUrl(rawUrl: string): string {
  const trimmed = (rawUrl || '').trim();
  if (!trimmed) return inferDefaultCompanionUrl();
  try {
    const parsed = new URL(trimmed);
    parsed.username = '';
    parsed.password = '';
    parsed.search = '';
    parsed.hash = '';
    return parsed.toString().replace(/\/+$/, '');
  } catch {
    return inferDefaultCompanionUrl();
  }
}

export async function createPortableBackupJson(): Promise<string> {
  const [goals, profile, preferences, auth, waterByDate, stepsByDate, meals] =
    await Promise.all([
      loadGoals(),
      loadUserProfile(),
      loadPreferences(),
      loadAuthConfig(),
      loadWaterByDate(),
      loadStepsByDate(),
      loadAllMeals(),
    ]);

  const portableMeals: MealEntry[] = meals.map((m) => ({
    ...m,
    photoUri:
      m.photoUri && m.photoUri.startsWith('file://') ? null : m.photoUri,
  }));

  const payload: PlatePortableBackup = {
    schema: 'plate-backup-v1',
    exportedAt: new Date().toISOString(),
    goals,
    profile,
    preferences,
    authPreferences: {
      activeProvider: auth.activeProvider,
      companionUrl: sanitizeBackupCompanionUrl(auth.companionUrl),
      claudeModel: auth.claudeModel,
      gptModel: auth.gptModel,
      geminiModel: auth.geminiModel,
    },
    waterByDate,
    stepsByDate,
    meals: portableMeals,
  };

  return JSON.stringify(payload, null, 2);
}

export async function restorePortableBackupJson(rawJson: string): Promise<{
  goals: UserGoals;
  profile: UserProfile;
  preferences: AppPreferences;
  auth: ProviderAuthConfig;
  waterByDate: Record<string, number>;
  stepsByDate: Record<string, number>;
  meals: MealEntry[];
}> {
  const parsed = JSON.parse(rawJson.trim()) as Partial<PlatePortableBackup>;
  if (!parsed || parsed.schema !== 'plate-backup-v1') {
    throw new Error('Clipboard does not contain a valid Plate backup JSON.');
  }

  const currentAuth = await loadAuthConfig();
  const nextGoals: UserGoals = { ...DEFAULT_GOALS, ...(parsed.goals || {}) };
  const nextProfile: UserProfile = {
    ...DEFAULT_USER_PROFILE,
    ...(parsed.profile || {}),
  };
  const nextPreferences: AppPreferences = {
    ...DEFAULT_PREFERENCES,
    ...(parsed.preferences || {}),
  };
  const nextAuth: ProviderAuthConfig = {
    ...currentAuth,
    ...(parsed.authPreferences || {}),
  };
  const nextWater =
    parsed.waterByDate && typeof parsed.waterByDate === 'object'
      ? parsed.waterByDate
      : {};
  const nextSteps =
    parsed.stepsByDate && typeof parsed.stepsByDate === 'object'
      ? parsed.stepsByDate
      : {};
  const nextMeals = Array.isArray(parsed.meals) ? parsed.meals : [];

  await Promise.all([
    saveGoals(nextGoals),
    saveUserProfile(nextProfile),
    savePreferences(nextPreferences),
    saveAuthConfig(nextAuth),
    saveWaterByDate(nextWater),
    saveStepsByDate(nextSteps),
    replaceAllMeals(nextMeals),
    saveOnboardingCompleted(true),
    saveHasSeededDemo(true),
  ]);

  return {
    goals: nextGoals,
    profile: nextProfile,
    preferences: nextPreferences,
    auth: nextAuth,
    waterByDate: nextWater,
    stepsByDate: nextSteps,
    meals: nextMeals,
  };
}
