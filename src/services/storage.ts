import Constants from 'expo-constants';
import { Directory, File, Paths } from 'expo-file-system';
import * as SecureStore from 'expo-secure-store';
import * as SQLite from 'expo-sqlite';
import { Platform } from 'react-native';
import {
  DEFAULT_PLATE_GOALS,
  DEFAULT_PREFERENCES,
  DEFAULT_USER_PROFILE,
} from '../constants/plateCatalog';
import {
  AppPreferences,
  ChatGPTOnDeviceSession,
  DailySummary,
  MealEntry,
  MealItem,
  ProviderAuthConfig,
  UserGoals,
  UserProfile,
} from '../types/models';

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

export const DEFAULT_GOALS: UserGoals = DEFAULT_PLATE_GOALS;

export function inferDefaultCompanionUrl(): string {
  if (Platform.OS === 'web') {
    return 'http://localhost:8787';
  }
  const hostUri = Constants.expoConfig?.hostUri;
  if (hostUri) {
    const host = hostUri.split(':')[0];
    if (host && /^(\d{1,3}\.){3}\d{1,3}$/.test(host)) {
      return `http://${host}:8787`;
    }
  }
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

const SECURE_KEYS = {
  companionToken: 'cl_companion_token',
  claudeApiKey: 'cl_claude_api_key',
  openaiApiKey: 'cl_openai_api_key',
  geminiApiKey: 'cl_gemini_api_key',
  chatgptAccessToken: 'cl_oai_oauth_access',
  chatgptRefreshToken: 'cl_oai_oauth_refresh',
  settingsMirror: 'cl_settings_mirror_v1',
} as const;

const SETTINGS_MIRROR_FILENAME = 'plate-settings-mirror.json';

const MIRRORED_SETTING_KEYS = [
  'user_goals',
  'user_profile',
  'app_preferences',
  'provider_prefs',
  'onboarding_completed',
  'has_seeded_demo',
  'purged_legacy_demo_seed_v1',
] as const;

const MIRRORED_KEY_SET = new Set<string>(MIRRORED_SETTING_KEYS);

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

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

async function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (!dbPromise) {
    dbPromise = (async () => {
      const db = await SQLite.openDatabaseAsync('calorielens.db');
      await db.execAsync(`
        PRAGMA journal_mode = WAL;
        CREATE TABLE IF NOT EXISTS meals (
          id TEXT PRIMARY KEY NOT NULL,
          date_key TEXT NOT NULL,
          created_at TEXT NOT NULL,
          meal_type TEXT NOT NULL,
          title TEXT NOT NULL,
          photo_uri TEXT,
          user_notes TEXT,
          ai_provider TEXT,
          ai_summary TEXT,
          confidence TEXT,
          calories REAL NOT NULL,
          protein REAL NOT NULL,
          carbs REAL NOT NULL,
          fat REAL NOT NULL,
          items_json TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_meals_date_key ON meals(date_key);
        CREATE TABLE IF NOT EXISTS app_settings (
          key TEXT PRIMARY KEY NOT NULL,
          value TEXT NOT NULL
        );
      `);
      return db;
    })();
  }
  return dbPromise;
}

interface MealRow {
  id: string;
  date_key: string;
  created_at: string;
  meal_type: string;
  title: string;
  photo_uri: string | null;
  user_notes: string | null;
  ai_provider: string | null;
  ai_summary: string | null;
  confidence: string | null;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  items_json: string;
}

interface StoredMealEnvelope {
  __v: 2;
  items: MealItem[];
  meta?: {
    entryType?: MealEntry['entryType'];
    presetFoodId?: string;
    servings?: number;
    healthScore?: number;
    exerciseMinutes?: number;
    exerciseIntensity?: MealEntry['exerciseIntensity'];
    exerciseIcon?: MealEntry['exerciseIcon'];
  };
}

function serializeItemsAndMeta(meal: MealEntry): string {
  const envelope: StoredMealEnvelope = {
    __v: 2,
    items: meal.items || [],
    meta: {
      entryType: meal.entryType ?? 'food',
      presetFoodId: meal.presetFoodId,
      servings: meal.servings ?? 1,
      healthScore: meal.healthScore,
      exerciseMinutes: meal.exerciseMinutes,
      exerciseIntensity: meal.exerciseIntensity,
      exerciseIcon: meal.exerciseIcon,
    },
  };
  return JSON.stringify(envelope);
}

function resolveStoredPhotoUri(rawUri: string | null | undefined): string | null {
  if (!rawUri) return null;
  if (Platform.OS === 'web') return rawUri;

  // iOS assigns a fresh sandbox container UUID on each .ipa update.
  // Re-anchor meal-photos filenames to the current Paths.document directory.
  const marker = '/meal-photos/';
  const idx = rawUri.lastIndexOf(marker);
  if (idx >= 0) {
    const fileName = rawUri.slice(idx + marker.length).split('?')[0];
    if (fileName) {
      try {
        const currentFile = new File(
          new Directory(Paths.document, 'meal-photos'),
          fileName
        );
        if (currentFile.exists) {
          return currentFile.uri;
        }
      } catch {
        // fall back to stored URI
      }
    }
  }
  return rawUri;
}

function rowToMeal(row: MealRow): MealEntry {
  let items: MealItem[] = [];
  let meta: StoredMealEnvelope['meta'] = {};
  try {
    const parsed = JSON.parse(row.items_json || '[]');
    if (Array.isArray(parsed)) {
      items = parsed;
    } else if (parsed && typeof parsed === 'object') {
      items = Array.isArray(parsed.items) ? parsed.items : [];
      meta = parsed.meta || {};
    }
  } catch {
    items = [];
  }

  return {
    id: row.id,
    dateKey: row.date_key,
    createdAt: row.created_at,
    mealType: row.meal_type as MealEntry['mealType'],
    title: row.title,
    photoUri: resolveStoredPhotoUri(row.photo_uri),
    userNotes: row.user_notes || undefined,
    aiProvider: (row.ai_provider as MealEntry['aiProvider']) || undefined,
    aiSummary: row.ai_summary || undefined,
    confidence: (row.confidence as MealEntry['confidence']) || undefined,
    calories: Math.round(row.calories || 0),
    protein: Number((row.protein || 0).toFixed(1)),
    carbs: Number((row.carbs || 0).toFixed(1)),
    fat: Number((row.fat || 0).toFixed(1)),
    items,
    entryType: meta?.entryType ?? 'food',
    presetFoodId: meta?.presetFoodId,
    servings: meta?.servings ?? 1,
    healthScore: meta?.healthScore,
    status: 'done',
    exerciseMinutes: meta?.exerciseMinutes,
    exerciseIntensity: meta?.exerciseIntensity,
    exerciseIcon: meta?.exerciseIcon,
  };
}

let mirrorCache: Record<string, string> | null = null;
let mirrorLoadPromise: Promise<Record<string, string>> | null = null;

function compactMirrorForKeychain(
  fullMap: Record<string, string>
): Record<string, string> {
  const copy: Record<string, string> = { ...fullMap };
  if (copy.user_profile) {
    try {
      const prof = JSON.parse(copy.user_profile) as UserProfile;
      if (Array.isArray(prof.weightHistory) && prof.weightHistory.length > 36) {
        copy.user_profile = JSON.stringify({
          ...prof,
          weightHistory: prof.weightHistory.slice(-36),
        });
      }
    } catch {
      // keep raw
    }
  }
  return copy;
}

async function readDocumentMirrorFile(): Promise<Record<string, string>> {
  if (Platform.OS === 'web') return {};
  try {
    const file = new File(Paths.document, SETTINGS_MIRROR_FILENAME);
    if (!file.exists) return {};
    const txt = await file.text();
    if (!txt) return {};
    const parsed = JSON.parse(txt);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

async function writeDocumentMirrorFile(
  map: Record<string, string>
): Promise<void> {
  if (Platform.OS === 'web') return;
  try {
    const file = new File(Paths.document, SETTINGS_MIRROR_FILENAME);
    file.create({ intermediates: true, overwrite: true });
    await file.write(JSON.stringify(map));
  } catch {
    // ignore file mirror errors
  }
}

async function loadSettingsMirrorMap(): Promise<Record<string, string>> {
  if (mirrorCache) return mirrorCache;
  if (!mirrorLoadPromise) {
    mirrorLoadPromise = (async () => {
      const [docMap, keychainRaw] = await Promise.all([
        readDocumentMirrorFile(),
        getChunkedSecret(SECURE_KEYS.settingsMirror),
      ]);
      let keychainMap: Record<string, string> = {};
      if (keychainRaw) {
        try {
          const parsed = JSON.parse(keychainRaw);
          if (parsed && typeof parsed === 'object') {
            keychainMap = parsed as Record<string, string>;
          }
        } catch {
          keychainMap = {};
        }
      }
      // Document file preserves full history on in-place updates;
      // iOS Keychain survives even uninstall + reinstall under the same bundle ID.
      const merged: Record<string, string> = {
        ...keychainMap,
        ...docMap,
      };
      mirrorCache = merged;
      return merged;
    })();
  }
  return mirrorLoadPromise;
}

async function persistSettingsMirrorKey(
  key: string,
  value: string
): Promise<void> {
  const current = await loadSettingsMirrorMap();
  const next: Record<string, string> = { ...current, [key]: value };
  mirrorCache = next;
  await Promise.all([
    writeDocumentMirrorFile(next),
    setChunkedSecret(
      SECURE_KEYS.settingsMirror,
      JSON.stringify(compactMirrorForKeychain(next))
    ),
  ]);
}

async function getSettingValue(key: string): Promise<string | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ value: string }>(
    'SELECT value FROM app_settings WHERE key = ?',
    [key]
  );
  if (row?.value !== undefined && row?.value !== null) {
    return row.value;
  }

  if (MIRRORED_KEY_SET.has(key)) {
    const mirror = await loadSettingsMirrorMap();
    const recovered = mirror[key];
    if (typeof recovered === 'string' && recovered.length > 0) {
      // Self-heal SQLite from Document / Keychain mirror after update or reinstall
      try {
        await db.runAsync(
          'INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)',
          [key, recovered]
        );
      } catch {
        // ignore self-heal write race
      }
      return recovered;
    }
  }

  return null;
}

async function setSettingValue(key: string, value: string): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    'INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)',
    [key, value]
  );
  try {
    await db.execAsync('PRAGMA wal_checkpoint(PASSIVE);');
  } catch {
    // ignore passive checkpoint warning
  }
  if (MIRRORED_KEY_SET.has(key)) {
    await persistSettingsMirrorKey(key, value);
  }
}

/**
 * Ensures any pre-existing SQLite settings from an earlier version of Plate
 * are backed up into the Documents JSON mirror + iOS Keychain mirror on launch.
 */
export async function ensureSettingsMirrored(): Promise<void> {
  try {
    const db = await getDb();
    const rows = await db.getAllAsync<{ key: string; value: string }>(
      'SELECT key, value FROM app_settings'
    );
    const current = await loadSettingsMirrorMap();
    let changed = false;
    const next: Record<string, string> = { ...current };
    for (const r of rows) {
      if (MIRRORED_KEY_SET.has(r.key) && r.value && next[r.key] !== r.value) {
        next[r.key] = r.value;
        changed = true;
      }
    }
    if (changed) {
      mirrorCache = next;
      await Promise.all([
        writeDocumentMirrorFile(next),
        setChunkedSecret(
          SECURE_KEYS.settingsMirror,
          JSON.stringify(compactMirrorForKeychain(next))
        ),
      ]);
    }
  } catch {
    // non-fatal background mirror sync
  }
}

export async function loadAllMeals(): Promise<MealEntry[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<MealRow>(
    'SELECT * FROM meals ORDER BY date_key DESC, created_at DESC'
  );
  return rows.map(rowToMeal);
}

export async function upsertMeal(meal: MealEntry): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `INSERT OR REPLACE INTO meals (
      id, date_key, created_at, meal_type, title, photo_uri, user_notes,
      ai_provider, ai_summary, confidence, calories, protein, carbs, fat, items_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      meal.id,
      meal.dateKey,
      meal.createdAt,
      meal.mealType,
      meal.title,
      meal.photoUri ?? null,
      meal.userNotes ?? null,
      meal.aiProvider ?? null,
      meal.aiSummary ?? null,
      meal.confidence ?? null,
      meal.calories,
      meal.protein,
      meal.carbs,
      meal.fat,
      serializeItemsAndMeta(meal),
    ]
  );
}

export async function replaceAllMeals(meals: MealEntry[]): Promise<void> {
  const db = await getDb();
  await db.withTransactionAsync(async () => {
    await db.runAsync('DELETE FROM meals');
    for (const meal of meals) {
      await db.runAsync(
        `INSERT OR REPLACE INTO meals (
          id, date_key, created_at, meal_type, title, photo_uri, user_notes,
          ai_provider, ai_summary, confidence, calories, protein, carbs, fat, items_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          meal.id,
          meal.dateKey,
          meal.createdAt,
          meal.mealType,
          meal.title,
          meal.photoUri ?? null,
          meal.userNotes ?? null,
          meal.aiProvider ?? null,
          meal.aiSummary ?? null,
          meal.confidence ?? null,
          meal.calories,
          meal.protein,
          meal.carbs,
          meal.fat,
          serializeItemsAndMeta(meal),
        ]
      );
    }
  });
}

export async function deleteMealById(id: string): Promise<void> {
  const db = await getDb();
  await db.runAsync('DELETE FROM meals WHERE id = ?', [id]);
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
  const raw = await getSettingValue('user_goals');
  if (!raw) return DEFAULT_GOALS;
  try {
    return { ...DEFAULT_GOALS, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_GOALS;
  }
}

export async function saveGoals(goals: UserGoals): Promise<void> {
  await setSettingValue('user_goals', JSON.stringify(goals));
}

export async function loadUserProfile(): Promise<UserProfile> {
  const raw = await getSettingValue('user_profile');
  if (!raw) return DEFAULT_USER_PROFILE;
  try {
    return { ...DEFAULT_USER_PROFILE, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_USER_PROFILE;
  }
}

export async function saveUserProfile(profile: UserProfile): Promise<void> {
  await setSettingValue('user_profile', JSON.stringify(profile));
}

export async function loadPreferences(): Promise<AppPreferences> {
  const raw = await getSettingValue('app_preferences');
  if (!raw) return DEFAULT_PREFERENCES;
  try {
    return { ...DEFAULT_PREFERENCES, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_PREFERENCES;
  }
}

export async function savePreferences(prefs: AppPreferences): Promise<void> {
  await setSettingValue('app_preferences', JSON.stringify(prefs));
}

export async function loadWaterByDate(): Promise<Record<string, number>> {
  const raw = await getSettingValue('water_by_date');
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export async function saveWaterByDate(
  water: Record<string, number>
): Promise<void> {
  await setSettingValue('water_by_date', JSON.stringify(water));
}

export async function loadStepsByDate(): Promise<Record<string, number>> {
  const raw = await getSettingValue('steps_by_date');
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export async function saveStepsByDate(
  steps: Record<string, number>
): Promise<void> {
  await setSettingValue('steps_by_date', JSON.stringify(steps));
}

export async function loadHasSeededDemo(): Promise<boolean> {
  return (await getSettingValue('has_seeded_demo')) === 'true';
}

export async function saveHasSeededDemo(seeded: boolean): Promise<void> {
  await setSettingValue('has_seeded_demo', seeded ? 'true' : 'false');
}

export async function loadHasPurgedLegacyDemoSeed(): Promise<boolean> {
  return (await getSettingValue('purged_legacy_demo_seed_v1')) === 'true';
}

export async function saveHasPurgedLegacyDemoSeed(
  purged: boolean
): Promise<void> {
  await setSettingValue(
    'purged_legacy_demo_seed_v1',
    purged ? 'true' : 'false'
  );
}

function isMirrorKey(key: string): boolean {
  return key.startsWith(SECURE_KEYS.settingsMirror);
}

async function getFallbackSecret(key: string): Promise<string> {
  if (isMirrorKey(key)) return '';
  try {
    const db = await getDb();
    const row = await db.getFirstAsync<{ value: string }>(
      'SELECT value FROM app_settings WHERE key = ?',
      [`sec_fb_${key}`]
    );
    if (row?.value) return row.value;
  } catch {
    // ignore sqlite fallback read error
  }
  try {
    const docMap = await readDocumentMirrorFile();
    return docMap[`sec_fb_${key}`] || '';
  } catch {
    return '';
  }
}

async function setFallbackSecret(key: string, value: string): Promise<void> {
  if (isMirrorKey(key)) return;
  const fbKey = `sec_fb_${key}`;
  try {
    const db = await getDb();
    if (!value) {
      await db.runAsync('DELETE FROM app_settings WHERE key = ?', [fbKey]);
    } else {
      await db.runAsync(
        'INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)',
        [fbKey, value]
      );
    }
  } catch {
    // ignore sqlite fallback write error
  }
  try {
    const docMap = await readDocumentMirrorFile();
    if (!value) {
      if (fbKey in docMap) {
        delete docMap[fbKey];
        await writeDocumentMirrorFile(docMap);
      }
    } else if (docMap[fbKey] !== value) {
      docMap[fbKey] = value;
      await writeDocumentMirrorFile(docMap);
    }
  } catch {
    // ignore document mirror fallback error
  }
}

async function getSecret(key: string): Promise<string> {
  try {
    const val = await SecureStore.getItemAsync(key);
    if (val) return val;
  } catch {
    // fall through to sandbox fallback (e.g. unsigned/sideloaded IPA keychain entitlement restrictions)
  }
  return getFallbackSecret(key);
}

async function setSecret(key: string, value: string): Promise<void> {
  let storedInKeychain = false;
  try {
    if (!value) {
      await SecureStore.deleteItemAsync(key);
      storedInKeychain = true;
    } else {
      await SecureStore.setItemAsync(key, value);
      const readBack = await SecureStore.getItemAsync(key);
      storedInKeychain = readBack === value;
    }
  } catch {
    storedInKeychain = false;
  }

  if (!value || !storedInKeychain || Platform.OS !== 'web') {
    await setFallbackSecret(key, value);
  }
}

const CHUNK_SIZE = 1600;
const MAX_CHUNKS = 8;

async function getChunkedSecret(baseKey: string): Promise<string> {
  const parts: string[] = [];
  for (let i = 0; i < MAX_CHUNKS; i += 1) {
    const chunk = await getSecret(`${baseKey}_${i}`);
    if (!chunk) break;
    parts.push(chunk);
  }
  return parts.join('');
}

async function setChunkedSecret(baseKey: string, value: string): Promise<void> {
  for (let i = 0; i < MAX_CHUNKS; i += 1) {
    const slice = value ? value.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE) : '';
    await setSecret(`${baseKey}_${i}`, slice);
  }
}

export async function loadAuthConfig(): Promise<ProviderAuthConfig> {
  const defaults = getDefaultAuthConfig();
  const raw = await getSettingValue('provider_prefs');

  let prefs: Partial<ProviderAuthConfig> & {
    chatgptOAuthMeta?: Omit<
      ChatGPTOnDeviceSession,
      'accessToken' | 'refreshToken'
    >;
  } = {};
  if (raw) {
    try {
      prefs = JSON.parse(raw);
    } catch {
      prefs = {};
    }
  }

  const [
    companionToken,
    claudeApiKey,
    openaiApiKey,
    geminiApiKey,
    chatgptAccessToken,
    chatgptRefreshToken,
  ] = await Promise.all([
    getSecret(SECURE_KEYS.companionToken),
    getSecret(SECURE_KEYS.claudeApiKey),
    getSecret(SECURE_KEYS.openaiApiKey),
    getSecret(SECURE_KEYS.geminiApiKey),
    getChunkedSecret(SECURE_KEYS.chatgptAccessToken),
    getChunkedSecret(SECURE_KEYS.chatgptRefreshToken),
  ]);

  const meta = prefs.chatgptOAuthMeta;
  const hasTokens = Boolean(chatgptAccessToken || chatgptRefreshToken);
  const isChatGptConnected = meta
    ? Boolean(meta.connected && hasTokens)
    : hasTokens;
  const chatgptOAuth: ChatGPTOnDeviceSession | undefined =
    meta || hasTokens
      ? {
          connected: isChatGptConnected,
          accessToken: chatgptAccessToken,
          refreshToken: chatgptRefreshToken,
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

  const inferredProvider: ProviderAuthConfig['activeProvider'] =
    prefs.activeProvider ||
    (isChatGptConnected || openaiApiKey
      ? 'gpt'
      : claudeApiKey
        ? 'claude'
        : geminiApiKey
          ? 'antigravity'
          : defaults.activeProvider);

  return {
    ...defaults,
    activeProvider: inferredProvider,
    companionUrl: prefs.companionUrl || defaults.companionUrl,
    claudeModel: prefs.claudeModel || defaults.claudeModel,
    gptModel: prefs.gptModel || defaults.gptModel,
    geminiModel: prefs.geminiModel || defaults.geminiModel,
    companionToken,
    claudeApiKey,
    openaiApiKey,
    geminiApiKey,
    chatgptOAuth,
  };
}

export async function saveAuthConfig(config: ProviderAuthConfig): Promise<void> {
  const oai = config.chatgptOAuth;
  const nonSecretPrefs = {
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

  await setSettingValue('provider_prefs', JSON.stringify(nonSecretPrefs));

  await Promise.all([
    setSecret(SECURE_KEYS.companionToken, config.companionToken),
    setSecret(SECURE_KEYS.claudeApiKey, config.claudeApiKey),
    setSecret(SECURE_KEYS.openaiApiKey, config.openaiApiKey),
    setSecret(SECURE_KEYS.geminiApiKey, config.geminiApiKey),
    setChunkedSecret(
      SECURE_KEYS.chatgptAccessToken,
      oai?.connected ? oai.accessToken : ''
    ),
    setChunkedSecret(
      SECURE_KEYS.chatgptRefreshToken,
      oai?.connected ? oai.refreshToken : ''
    ),
  ]);
}

export async function loadPendingChatGPTPkce(): Promise<PendingChatGPTPkceFlow | null> {
  const raw = await getSettingValue('pending_chatgpt_pkce');
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as PendingChatGPTPkceFlow;
    if (
      !parsed?.state ||
      !parsed?.codeVerifier ||
      Date.now() - (parsed.createdAt || 0) > 20 * 60 * 1000
    ) {
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
  await setSettingValue(
    'pending_chatgpt_pkce',
    flow ? JSON.stringify(flow) : ''
  );
}

export async function loadOnboardingCompleted(): Promise<boolean> {
  return (await getSettingValue('onboarding_completed')) === 'true';
}

export async function saveOnboardingCompleted(
  completed: boolean
): Promise<void> {
  await setSettingValue('onboarding_completed', completed ? 'true' : 'false');
}

/**
 * Detects whether the user already has saved settings, preferences, goals, profile,
 * or AI credentials from a previous version/install so app updates keep their setup
 * and never force them back through first-time onboarding.
 */
export async function hasStoredUserConfiguration(): Promise<boolean> {
  const [goalsRaw, prefsRaw, profileRaw, providerRaw, onboardRaw] =
    await Promise.all([
      getSettingValue('user_goals'),
      getSettingValue('app_preferences'),
      getSettingValue('user_profile'),
      getSettingValue('provider_prefs'),
      getSettingValue('onboarding_completed'),
    ]);

  if (
    onboardRaw === 'true' ||
    Boolean(goalsRaw || prefsRaw || profileRaw || providerRaw)
  ) {
    return true;
  }

  const [claudeKey, openaiKey, geminiKey, oaiAccess, oaiRefresh] =
    await Promise.all([
      getSecret(SECURE_KEYS.claudeApiKey),
      getSecret(SECURE_KEYS.openaiApiKey),
      getSecret(SECURE_KEYS.geminiApiKey),
      getChunkedSecret(SECURE_KEYS.chatgptAccessToken),
      getChunkedSecret(SECURE_KEYS.chatgptRefreshToken),
    ]);

  return Boolean(
    claudeKey || openaiKey || geminiKey || oaiAccess || oaiRefresh
  );
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

  const payload: PlatePortableBackup = {
    schema: 'plate-backup-v1',
    exportedAt: new Date().toISOString(),
    goals,
    profile,
    preferences,
    authPreferences: {
      activeProvider: auth.activeProvider,
      companionUrl: auth.companionUrl,
      claudeModel: auth.claudeModel,
      gptModel: auth.gptModel,
      geminiModel: auth.geminiModel,
    },
    waterByDate,
    stepsByDate,
    meals,
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
