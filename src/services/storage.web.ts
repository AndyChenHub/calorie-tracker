import {
  DEFAULT_PLATE_GOALS,
  DEFAULT_PREFERENCES,
  DEFAULT_USER_PROFILE,
} from '../constants/plateCatalog';
import {
  AppPreferences,
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
const WEB_AUTH_KEY = 'calorielens_auth_v1';
const WEB_ONBOARDING_KEY = 'calorielens_onboarded_v1';
const WEB_PROFILE_KEY = 'plate_profile_v1';
const WEB_PREFS_KEY = 'plate_prefs_v1';
const WEB_WATER_KEY = 'plate_water_v1';
const WEB_STEPS_KEY = 'plate_steps_v1';
const WEB_SEEDED_KEY = 'plate_seeded_v1';

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
    const raw = globalThis.localStorage?.getItem(WEB_GOALS_KEY);
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
    const raw = globalThis.localStorage?.getItem(WEB_PROFILE_KEY);
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
    const raw = globalThis.localStorage?.getItem(WEB_PREFS_KEY);
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

export async function loadAuthConfig(): Promise<ProviderAuthConfig> {
  const defaults = getDefaultAuthConfig();
  try {
    const raw = globalThis.localStorage?.getItem(WEB_AUTH_KEY);
    if (raw) return { ...defaults, ...JSON.parse(raw) };
  } catch {
    // ignore
  }
  return defaults;
}

export async function saveAuthConfig(config: ProviderAuthConfig): Promise<void> {
  try {
    globalThis.localStorage?.setItem(WEB_AUTH_KEY, JSON.stringify(config));
  } catch {
    // ignore
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
