import { ImageSourcePropType } from 'react-native';
import {
  AppPreferences,
  ExerciseIconName,
  MealEntry,
  MealItem,
  UserGoals,
  UserProfile,
} from '../types/models';
import { inferMealTypeByHour, toLocalDateKey } from '../utils/date';

export const FOOD_IMAGES: Record<string, ImageSourcePropType> = {
  'avocado-toast': require('../../assets/foods/avocado-toast.jpg'),
  'poke-bowl': require('../../assets/foods/poke-bowl.jpg'),
  'yogurt-bowl': require('../../assets/foods/yogurt-bowl.jpg'),
  'chicken-salad': require('../../assets/foods/chicken-salad.jpg'),
  pasta: require('../../assets/foods/pasta.jpg'),
  smoothie: require('../../assets/foods/smoothie.jpg'),
  burger: require('../../assets/foods/burger.jpg'),
  oats: require('../../assets/foods/oats.jpg'),
};

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
  name: 'Alex Morgan',
  weightKg: 78.4,
  goalWeightKg: 72,
  startWeightKg: 84.6,
  heightCm: 180,
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
  if (meal.presetFoodId && FOOD_IMAGES[meal.presetFoodId]) {
    return FOOD_IMAGES[meal.presetFoodId];
  }
  return null;
}

export function mulberry32(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
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
    presetFoodId: food.id,
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

export function generateDemoSeedData(): {
  meals: MealEntry[];
  waterByDate: Record<string, number>;
  stepsByDate: Record<string, number>;
} {
  const rnd = mulberry32(42);
  const meals: MealEntry[] = [];
  const waterByDate: Record<string, number> = {};
  const stepsByDate: Record<string, number> = {};

  for (let i = 1; i < 21; i++) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const k = toLocalDateKey(d);
    const pool = [...CATALOG_FOODS]
      .sort(() => rnd() - 0.5)
      .slice(0, 3 + (i % 2));

    pool.forEach((f, j) => {
      const entryDate = new Date(
        d.getFullYear(),
        d.getMonth(),
        d.getDate(),
        8 + j * 4,
        10 + j * 7
      );
      meals.push(createFoodMealEntry(f, entryDate, k));
    });

    if (i % 3 === 0) {
      const exDate = new Date(
        d.getFullYear(),
        d.getMonth(),
        d.getDate(),
        18,
        30
      );
      meals.push(
        createExerciseMealEntry(CATALOG_EXERCISES[i % 3], exDate, k)
      );
    }

    waterByDate[k] = 4 + Math.floor(rnd() * 5);
    stepsByDate[k] = 5200 + Math.floor(rnd() * 6500);
  }

  const todayKey = toLocalDateKey();
  const ago = (hours: number) => new Date(Date.now() - hours * 3600 * 1000);
  const poke = findCatalogFood('poke-bowl')!;
  const yogurt = findCatalogFood('yogurt-bowl')!;

  meals.push(createFoodMealEntry(poke, ago(0.6), todayKey));
  meals.push(createExerciseMealEntry(CATALOG_EXERCISES[0], ago(2.4), todayKey));
  meals.push(createFoodMealEntry(yogurt, ago(3.3), todayKey));

  waterByDate[todayKey] = 3;
  stepsByDate[todayKey] = 6240;

  meals.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return { meals, waterByDate, stepsByDate };
}

export function buildWeightSeries(profile: UserProfile): number[] {
  const rnd = mulberry32(7);
  const n = 180;
  const out: number[] = [];
  let w = profile.startWeightKg;
  for (let i = 0; i < n; i++) {
    w += -0.036 + (rnd() - 0.5) * 0.38;
    out.push(w);
  }
  const diff = profile.weightKg - out[n - 1];
  return out.map((v, i) => v + diff * (i / (n - 1)));
}

export function formatNum(n: number): string {
  return Math.round(n || 0).toLocaleString('en-US');
}
