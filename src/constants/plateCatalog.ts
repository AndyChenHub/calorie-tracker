import { ImageSourcePropType } from 'react-native';
import {
  AppPreferences,
  ExerciseIconName,
  MealEntry,
  MealItem,
  UserGoals,
  UserProfile,
  WeightLogPoint,
} from '../types/models';
import { inferMealTypeByHour, toLocalDateKey } from '../utils/date';

export type MetricPortionUnit = 'g' | 'mL';

export const WATER_STEP_ML = 250;
export const WATER_STEP_LITERS = 0.25;

export function waterStepsToMl(steps250ml: number): number {
  return Math.max(0, Math.round((steps250ml || 0) * WATER_STEP_ML));
}

export function mlToWaterSteps(ml: number): number {
  return Math.max(0, Math.round(ml || 0)) / WATER_STEP_ML;
}

export function formatWaterLiters(steps250ml: number): string {
  const ml = waterStepsToMl(steps250ml);
  if (ml === 0) return '0 L';
  const liters = ml / 1000;
  const decimals = ml % 100 === 0 ? 1 : 2;
  return `${liters.toFixed(decimals)} L`;
}

export function estimateStepMeters(
  steps: number,
  heightCm: number = 175
): number {
  const safeHeight = Math.max(120, Math.min(240, heightCm || 175));
  const strideMeters = safeHeight * 0.00414;
  return Math.max(0, Math.round((steps || 0) * strideMeters));
}

export function formatMetersMetric(meters: number): string {
  const safeMeters = Math.max(0, Math.round(meters || 0));
  if (safeMeters < 1000) {
    return `${formatNum(safeMeters)} m`;
  }
  return `${(safeMeters / 1000).toFixed(1)} km`;
}

export function formatHeightMetric(heightCm: number): string {
  const safeCm = Math.max(120, Math.min(240, Math.round(heightCm || 175)));
  return `${safeCm} cm (${(safeCm / 100).toFixed(2)} m)`;
}

export interface CatalogFood {
  id: string;
  name: string;
  kcal: number;
  p: number;
  c: number;
  f: number;
  health: number;
  portionLabel: string;
  ing: [string, number, number, MetricPortionUnit?][];
}

export interface CatalogExercise {
  name: string;
  minutes: number;
  kcal: number;
  intensity: 'Low' | 'Medium' | 'High';
  icon: ExerciseIconName;
  desc: string;
}

export const CATALOG_FOODS: CatalogFood[] = [
  {
    id: 'avocado-toast',
    name: 'Avocado Toast & Egg',
    kcal: 420,
    p: 18,
    c: 38,
    f: 22,
    health: 8,
    portionLabel: '242 g',
    ing: [
      ['Sourdough', 180, 75, 'g'],
      ['Avocado', 160, 100, 'g'],
      ['Poached egg', 72, 65, 'g'],
      ['Chili flakes', 8, 2, 'g'],
    ],
  },
  {
    id: 'poke-bowl',
    name: 'Salmon Poke Bowl',
    kcal: 610,
    p: 34,
    c: 68,
    f: 21,
    health: 9,
    portionLabel: '435 g',
    ing: [
      ['Sushi rice', 260, 200, 'g'],
      ['Salmon', 190, 110, 'g'],
      ['Avocado', 80, 50, 'g'],
      ['Edamame', 50, 40, 'g'],
      ['Cucumber', 10, 30, 'g'],
      ['Sesame', 20, 5, 'g'],
    ],
  },
  {
    id: 'yogurt-bowl',
    name: 'Greek Yogurt & Berries',
    kcal: 310,
    p: 20,
    c: 42,
    f: 7,
    health: 9,
    portionLabel: '285 g',
    ing: [
      ['Greek yogurt', 150, 170, 'g'],
      ['Granola', 100, 25, 'g'],
      ['Berries', 35, 80, 'g'],
      ['Honey', 25, 10, 'g'],
    ],
  },
  {
    id: 'chicken-salad',
    name: 'Chicken Caesar Salad',
    kcal: 480,
    p: 42,
    c: 16,
    f: 27,
    health: 7,
    portionLabel: '305 g',
    ing: [
      ['Grilled chicken', 220, 150, 'g'],
      ['Caesar dressing', 140, 30, 'mL'],
      ['Croutons', 70, 20, 'g'],
      ['Parmesan', 40, 15, 'g'],
      ['Romaine', 10, 90, 'g'],
    ],
  },
  {
    id: 'pasta',
    name: 'Spaghetti Bolognese',
    kcal: 720,
    p: 32,
    c: 92,
    f: 24,
    health: 6,
    portionLabel: '455 g',
    ing: [
      ['Spaghetti', 380, 240, 'g'],
      ['Beef ragù', 270, 195, 'g'],
      ['Parmesan', 60, 15, 'g'],
      ['Basil', 10, 5, 'g'],
    ],
  },
  {
    id: 'smoothie',
    name: 'Green Smoothie',
    kcal: 240,
    p: 6,
    c: 46,
    f: 4,
    health: 9,
    portionLabel: '350 mL',
    ing: [
      ['Banana', 105, 120, 'g'],
      ['Spinach', 10, 40, 'g'],
      ['Mango', 70, 110, 'g'],
      ['Chia seeds', 55, 12, 'g'],
    ],
  },
  {
    id: 'burger',
    name: 'Cheeseburger & Fries',
    kcal: 1080,
    p: 41,
    c: 96,
    f: 58,
    health: 3,
    portionLabel: '395 g',
    ing: [
      ['Brioche bun', 220, 75, 'g'],
      ['Beef patty', 300, 140, 'g'],
      ['Cheddar', 110, 30, 'g'],
      ['Fries', 420, 130, 'g'],
      ['Sauce', 30, 20, 'mL'],
    ],
  },
  {
    id: 'oats',
    name: 'PB Banana Overnight Oats',
    kcal: 460,
    p: 17,
    c: 58,
    f: 18,
    health: 8,
    portionLabel: '250 g',
    ing: [
      ['Rolled oats', 190, 50, 'g'],
      ['Peanut butter', 190, 32, 'g'],
      ['Banana', 55, 60, 'g'],
      ['Chia', 25, 5, 'g'],
    ],
  },
];

export const CATALOG_EXERCISES: CatalogExercise[] = [
  {
    name: 'Run',
    minutes: 30,
    kcal: 310,
    intensity: 'High',
    icon: 'activity',
    desc: '30 min · 5.3 km · 5:40 /km',
  },
  {
    name: 'Weight lifting',
    minutes: 45,
    kcal: 220,
    intensity: 'Medium',
    icon: 'dumbbell',
    desc: '45 min · full body (kg)',
  },
  {
    name: 'Walk',
    minutes: 40,
    kcal: 150,
    intensity: 'Low',
    icon: 'walk',
    desc: '40 min · 3,200 m (3.2 km)',
  },
];

export const DEFAULT_PLATE_GOALS: UserGoals = {
  dailyCalories: 2250,
  proteinGrams: 160,
  carbsGrams: 220,
  fatGrams: 70,
  waterGlasses: 8,
  dailySteps: 10000,
};

export const DEFAULT_USER_PROFILE: UserProfile = {
  name: 'You',
  weightKg: 75,
  goalWeightKg: 70,
  startWeightKg: 75,
  heightCm: 175,
  weightHistory: [],
};

export const DEFAULT_PREFERENCES: AppPreferences = {
  addBurned: true,
  rollover: false,
  reminders: true,
  showEaten: false,
};

export function findCatalogFood(id?: string | null): CatalogFood | undefined {
  if (!id) return undefined;
  return CATALOG_FOODS.find((f) => f.id === id);
}

export function resolveMealImageSource(
  meal: Pick<MealEntry, 'photoUri' | 'presetFoodId'>
): ImageSourcePropType | null {
  if (meal.photoUri) {
    return { uri: meal.photoUri };
  }
  return null;
}

function makeUid(): string {
  return Math.random().toString(36).slice(2, 10);
}

export function catalogFoodToItems(food: CatalogFood): MealItem[] {
  const totalKcal = Math.max(1, food.kcal);
  return food.ing.map(([name, kcal, amount, unit = 'g'], idx) => {
    const share = kcal / totalKcal;
    return {
      id: `${food.id}_ing_${idx}`,
      name,
      grams: unit === 'g' ? amount : null,
      portion: `${amount} ${unit}`,
      calories: kcal,
      protein: Number((food.p * share).toFixed(1)),
      carbs: Number((food.c * share).toFixed(1)),
      fat: Number((food.f * share).toFixed(1)),
    };
  });
}

export function createFoodMealEntry(
  food: CatalogFood,
  date: Date = new Date(),
  overrideDateKey?: string
): MealEntry {
  return {
    id: `food_${date.getTime()}_${makeUid()}`,
    dateKey: overrideDateKey ?? toLocalDateKey(date),
    createdAt: date.toISOString(),
    mealType: inferMealTypeByHour(date),
    title: food.name,
    entryType: 'food',
    servings: 1,
    healthScore: food.health,
    status: 'done',
    confidence: 'high',
    calories: food.kcal,
    protein: food.p,
    carbs: food.c,
    fat: food.f,
    items: catalogFoodToItems(food),
  };
}

export function createExerciseMealEntry(
  ex: CatalogExercise,
  date: Date = new Date(),
  overrideDateKey?: string
): MealEntry {
  return {
    id: `ex_${date.getTime()}_${makeUid()}`,
    dateKey: overrideDateKey ?? toLocalDateKey(date),
    createdAt: date.toISOString(),
    mealType: 'snack',
    title: ex.name,
    entryType: 'exercise',
    status: 'done',
    calories: ex.kcal,
    protein: 0,
    carbs: 0,
    fat: 0,
    items: [],
    exerciseMinutes: ex.minutes,
    exerciseIntensity: ex.intensity,
    exerciseIcon: ex.icon,
  };
}

export function computeHealthScoreFromMacros(
  calories: number,
  protein: number,
  carbs: number,
  fat: number
): number {
  if (calories <= 0) return 7;
  const proteinRatio = (protein * 4) / calories;
  const fatRatio = (fat * 9) / calories;
  let score = 7;
  if (proteinRatio >= 0.25) score += 1.5;
  else if (proteinRatio >= 0.16) score += 0.5;
  if (calories <= 650) score += 0.8;
  else if (calories > 950) score -= 2.5;
  if (fatRatio > 0.45) score -= 1.5;
  return Math.max(1, Math.min(10, Math.round(score)));
}

export function upsertWeightLogPoint(
  history: WeightLogPoint[] | undefined,
  dateKey: string,
  weightKg: number
): WeightLogPoint[] {
  const rounded = Math.round(weightKg * 10) / 10;
  const filtered = (history ?? []).filter((pt) => pt.dateKey !== dateKey);
  filtered.push({ dateKey, weightKg: rounded });
  filtered.sort((a, b) => a.dateKey.localeCompare(b.dateKey));
  return filtered;
}

export function formatNum(n: number): string {
  return Math.round(n || 0).toLocaleString('en-US');
}
