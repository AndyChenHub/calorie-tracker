import Constants from 'expo-constants';
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
  DailySummary,
  MealEntry,
  MealItem,
  ProviderAuthConfig,
  UserGoals,
  UserProfile,
} from '../types/models';

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
} as const;

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
    photoUri: row.photo_uri,
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

async function getSettingValue(key: string): Promise<string | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ value: string }>(
    'SELECT value FROM app_settings WHERE key = ?',
    [key]
  );
  return row?.value ?? null;
}

async function setSettingValue(key: string, value: string): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    'INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)',
    [key, value]
  );
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

async function getSecret(key: string): Promise<string> {
  try {
    return (await SecureStore.getItemAsync(key)) || '';
  } catch {
    return '';
  }
}

async function setSecret(key: string, value: string): Promise<void> {
  try {
    if (!value) {
      await SecureStore.deleteItemAsync(key);
    } else {
      await SecureStore.setItemAsync(key, value);
    }
  } catch {
    // ignore keychain errors in restricted environments
  }
}

export async function loadAuthConfig(): Promise<ProviderAuthConfig> {
  const defaults = getDefaultAuthConfig();
  const raw = await getSettingValue('provider_prefs');

  let prefs: Partial<ProviderAuthConfig> = {};
  if (raw) {
    try {
      prefs = JSON.parse(raw);
    } catch {
      prefs = {};
    }
  }

  const [companionToken, claudeApiKey, openaiApiKey, geminiApiKey] =
    await Promise.all([
      getSecret(SECURE_KEYS.companionToken),
      getSecret(SECURE_KEYS.claudeApiKey),
      getSecret(SECURE_KEYS.openaiApiKey),
      getSecret(SECURE_KEYS.geminiApiKey),
    ]);

  return {
    ...defaults,
    ...prefs,
    companionUrl: prefs.companionUrl || defaults.companionUrl,
    companionToken,
    claudeApiKey,
    openaiApiKey,
    geminiApiKey,
  };
}

export async function saveAuthConfig(config: ProviderAuthConfig): Promise<void> {
  const nonSecretPrefs = {
    activeProvider: config.activeProvider,
    companionUrl: config.companionUrl,
    claudeModel: config.claudeModel,
    gptModel: config.gptModel,
    geminiModel: config.geminiModel,
  };

  await setSettingValue('provider_prefs', JSON.stringify(nonSecretPrefs));

  await Promise.all([
    setSecret(SECURE_KEYS.companionToken, config.companionToken),
    setSecret(SECURE_KEYS.claudeApiKey, config.claudeApiKey),
    setSecret(SECURE_KEYS.openaiApiKey, config.openaiApiKey),
    setSecret(SECURE_KEYS.geminiApiKey, config.geminiApiKey),
  ]);
}

export async function loadOnboardingCompleted(): Promise<boolean> {
  return (await getSettingValue('onboarding_completed')) === 'true';
}

export async function saveOnboardingCompleted(
  completed: boolean
): Promise<void> {
  await setSettingValue('onboarding_completed', completed ? 'true' : 'false');
}
