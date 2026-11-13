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

export interface CatalogFood {
  id: string;
  name: string;
  kcal: number;
  p: number;
  c: number;
  f: number;
  health: number;
  ing: [string, number][];
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
    ing: [
      ['Sourdough', 180],
      ['Avocado', 160],
      ['Poached egg', 72],
      ['Chili flakes', 8],
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
    ing: [
      ['Sushi rice', 260],
      ['Salmon', 190],
      ['Avocado', 80],
      ['Edamame', 50],
      ['Cucumber', 10],
      ['Sesame', 20],
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
    ing: [
      ['Greek yogurt', 150],
      ['Granola', 100],
      ['Berries', 35],
      ['Honey', 25],
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
    ing: [
      ['Grilled chicken', 220],
      ['Caesar dressing', 140],
      ['Croutons', 70],
      ['Parmesan', 40],
      ['Romaine', 10],
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
    ing: [
      ['Spaghetti', 380],
      ['Beef ragù', 270],
      ['Parmesan', 60],
      ['Basil', 10],
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
    ing: [
      ['Banana', 105],
      ['Spinach', 10],
      ['Mango', 70],
      ['Chia seeds', 55],
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
    ing: [
      ['Brioche bun', 220],
      ['Beef patty', 300],
      ['Cheddar', 110],
      ['Fries', 420],
      ['Sauce', 30],
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
    ing: [
      ['Rolled oats', 190],
      ['Peanut butter', 190],
      ['Banana', 55],
      ['Chia', 25],
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
    desc: '30 min · 5:40 /km',
  },
  {
    name: 'Weight lifting',
    minutes: 45,
    kcal: 220,
    intensity: 'Medium',
    icon: 'dumbbell',
    desc: '45 min · full body',
  },
  {
    name: 'Walk',
    minutes: 40,
    kcal: 150,
    intensity: 'Low',
    icon: 'walk',
    desc: '40 min · easy pace',
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
  return food.ing.map(([name, kcal], idx) => {
    const share = kcal / totalKcal;
    return {
      id: `${food.id}_ing_${idx}`,
      name,
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
