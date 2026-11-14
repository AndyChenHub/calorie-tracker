import { computeHealthScoreFromMacros } from '../constants/plateCatalog';
import { MealItem } from '../types/models';

export interface BarcodePer100Stats {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  unit: 'g' | 'mL';
}

export interface BarcodeProductResult {
  barcode: string;
  title: string;
  brand?: string;
  metricPortion: string;
  grams: number | null;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  healthScore: number;
  summary: string;
  items: MealItem[];
  per100?: BarcodePer100Stats;
  rawServingSize?: string;
  packageQuantity?: string;
}

interface OfflineBarcodeSeed {
  title: string;
  brand: string;
  amount: number;
  unit: 'g' | 'mL';
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  nutriscore?: 'a' | 'b' | 'c' | 'd' | 'e';
  rawServingSize?: string;
}

const OFFLINE_BARCODE_FALLBACKS: Record<string, OfflineBarcodeSeed> = {
  '3017620422003': {
    title: 'Nutella Hazelnut Spread',
    brand: 'Ferrero',
    amount: 15,
    unit: 'g',
    calories: 81,
    protein: 0.9,
    carbs: 8.6,
    fat: 4.6,
    nutriscore: 'e',
  },
  '5449000000996': {
    title: 'Coca-Cola Original Taste',
    brand: 'Coca-Cola',
    amount: 330,
    unit: 'mL',
    calories: 139,
    protein: 0,
    carbs: 35,
    fat: 0,
    nutriscore: 'e',
  },
  '8076800195057': {
    title: 'Spaghetti No. 5',
    brand: 'Barilla',
    amount: 85,
    unit: 'g',
    calories: 305,
    protein: 11.1,
    carbs: 60.5,
    fat: 1.7,
    nutriscore: 'a',
  },
  '818290012937': {
    title: 'Plain Non-Fat Greek Yogurt',
    brand: 'Chobani',
    amount: 170,
    unit: 'g',
    calories: 90,
    protein: 16,
    carbs: 6,
    fat: 0,
    nutriscore: 'a',
  },
  '0028400090896': {
    title: 'Classic Potato Chips',
    brand: "Lay's",
    amount: 28,
    unit: 'g',
    calories: 160,
    protein: 2,
    carbs: 15,
    fat: 10,
    nutriscore: 'd',
    rawServingSize: '28 g (about 15 chips)',
  },
};

function nutriscoreToHealthScore(
  grade: string | undefined,
  calories: number,
  protein: number,
  carbs: number,
  fat: number
): number {
  const g = (grade || '').trim().toLowerCase();
  if (g === 'a') return 9;
  if (g === 'b') return 8;
  if (g === 'c') return 6;
  if (g === 'd') return 4;
  if (g === 'e') return 3;
  return computeHealthScoreFromMacros(calories, protein, carbs, fat);
}

function parseMetricServing(
  servingQuantityRaw: unknown,
  servingUnitRaw: unknown,
  servingSizeText: string,
  quantityText: string
): { amount: number; unit: 'g' | 'mL' } {
  const combinedHint = `${String(servingUnitRaw || '')} ${servingSizeText} ${quantityText}`;
  const isLiquid =
    /\b(ml|millilit|litr|liter|\bl\b)/i.test(combinedHint) &&
    !/\b\d+\s*g\b/i.test(servingSizeText);
  const defaultUnit: 'g' | 'mL' = isLiquid ? 'mL' : 'g';

  const explicitNum = Number(servingQuantityRaw);
  if (!Number.isNaN(explicitNum) && explicitNum > 0 && explicitNum <= 5000) {
    const unitStr = String(servingUnitRaw || '').trim().toLowerCase();
    if (unitStr === 'l') {
      return { amount: Math.round(explicitNum * 1000), unit: 'mL' };
    }
    if (unitStr === 'kg') {
      return { amount: Math.round(explicitNum * 1000), unit: 'g' };
    }
    if (unitStr === 'ml') {
      return { amount: Math.round(explicitNum), unit: 'mL' };
    }
    return { amount: Math.round(explicitNum), unit: defaultUnit };
  }

  const metricMatch = servingSizeText.match(
    /(\d+(?:[.,]\d+)?)\s*(ml|g|kg|l)\b/i
  );
  if (metricMatch) {
    const val = parseFloat((metricMatch[1] || '100').replace(',', '.'));
    const u = (metricMatch[2] || 'g').toLowerCase();
    if (val > 0) {
      if (u === 'l') return { amount: Math.round(val * 1000), unit: 'mL' };
      if (u === 'kg') return { amount: Math.round(val * 1000), unit: 'g' };
      if (u === 'ml') return { amount: Math.round(val), unit: 'mL' };
      return { amount: Math.round(val), unit: 'g' };
    }
  }

  const ozMatch = servingSizeText.match(/(\d+(?:[.,]\d+)?)\s*(fl\.?\s*oz|oz)\b/i);
  if (ozMatch) {
    const val = parseFloat((ozMatch[1] || '1').replace(',', '.'));
    const isFlOz = /fl/i.test(ozMatch[2] || '');
    if (val > 0) {
      return isFlOz
        ? { amount: Math.round(val * 29.57), unit: 'mL' }
        : { amount: Math.round(val * 28.35), unit: 'g' };
    }
  }

  return { amount: 100, unit: defaultUnit };
}

function toSafeNum(val: unknown): number | null {
  if (val === null || val === undefined || val === '') return null;
  const n = Number(val);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function buildSeedResult(barcode: string, seed: OfflineBarcodeSeed): BarcodeProductResult {
  const metricPortion = `${seed.amount} ${seed.unit}`;
  const fullTitle = seed.brand ? `${seed.brand} ${seed.title}` : seed.title;
  const factor100 = 100 / Math.max(1, seed.amount);
  const healthScore = nutriscoreToHealthScore(
    seed.nutriscore,
    seed.calories,
    seed.protein,
    seed.carbs,
    seed.fat
  );
  return {
    barcode,
    title: fullTitle,
    brand: seed.brand,
    metricPortion,
    grams: seed.unit === 'g' ? seed.amount : null,
    calories: seed.calories,
    protein: seed.protein,
    carbs: seed.carbs,
    fat: seed.fat,
    healthScore,
    summary: `Verified barcode ${barcode} · per ${metricPortion} metric serving.`,
    per100: {
      calories: Math.round(seed.calories * factor100),
      protein: Number((seed.protein * factor100).toFixed(1)),
      carbs: Number((seed.carbs * factor100).toFixed(1)),
      fat: Number((seed.fat * factor100).toFixed(1)),
      unit: seed.unit,
    },
    rawServingSize: seed.rawServingSize || metricPortion,
    items: [
      {
        id: `bc_${barcode}`,
        name: fullTitle,
        grams: seed.unit === 'g' ? seed.amount : null,
        portion: metricPortion,
        calories: seed.calories,
        protein: seed.protein,
        carbs: seed.carbs,
        fat: seed.fat,
      },
    ],
  };
}

export function sanitizeBarcodeDigits(raw: string): string {
  return raw.replace(/[\s-]+/g, '').trim();
}

/**
 * Queries Open Food Facts v2 using only numeric barcode digits (zero credentials,
 * zero referrer, zero user profile metadata) and normalizes nutrition to SI metric units.
 */
export async function lookupFoodBarcode(
  rawBarcode: string
): Promise<BarcodeProductResult> {
  const digits = sanitizeBarcodeDigits(rawBarcode);
  if (!/^\d{6,18}$/.test(digits)) {
    throw new Error('Enter a valid 6–18 digit food barcode (EAN / UPC).');
  }

  const endpoint = `https://world.openfoodfacts.org/api/v2/product/${digits}.json?fields=product_name,product_name_en,brands,quantity,serving_size,serving_quantity,serving_quantity_unit,nutriments,nutriscore_grade`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 9000);

  try {
    const res = await fetch(endpoint, {
      method: 'GET',
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });

    if (res.ok) {
      const json = (await res.json()) as {
        status?: number;
        product?: Record<string, unknown>;
      };
      const prod = json?.product;
      if (json?.status === 1 && prod && typeof prod === 'object') {
        const rawName = String(
          prod.product_name_en || prod.product_name || ''
        ).trim();
        const rawBrand = String(prod.brands || '')
          .split(',')[0]
          ?.trim();
        const lowerName = rawName.toLowerCase();
        const lowerBrand = rawBrand.toLowerCase();
        const brandAlreadyInName =
          Boolean(lowerName && lowerBrand) &&
          (lowerName.includes(lowerBrand) || lowerBrand.startsWith(lowerName));
        const title =
          rawName && rawBrand && !brandAlreadyInName
            ? `${rawBrand} ${rawName}`
            : rawName || rawBrand || `Packaged Food (${digits})`;

        const serving = parseMetricServing(
          prod.serving_quantity,
          prod.serving_quantity_unit,
          String(prod.serving_size || ''),
          String(prod.quantity || '')
        );
        const nutriments = (prod.nutriments || {}) as Record<string, unknown>;
        const ratio = serving.amount / 100;

        const kcal100 =
          toSafeNum(nutriments['energy-kcal_100g']) ??
          (toSafeNum(nutriments.energy_100g) !== null
            ? (toSafeNum(nutriments.energy_100g) as number) / 4.184
            : null);
        const kcalServing = toSafeNum(nutriments['energy-kcal_serving']);
        const calories = Math.round(
          kcal100 !== null ? kcal100 * ratio : (kcalServing ?? 0)
        );

        const p100 = toSafeNum(nutriments.proteins_100g);
        const pServ = toSafeNum(nutriments.proteins_serving);
        const protein = Number(
          (p100 !== null ? p100 * ratio : (pServ ?? 0)).toFixed(1)
        );

        const c100 = toSafeNum(nutriments.carbohydrates_100g);
        const cServ = toSafeNum(nutriments.carbohydrates_serving);
        const carbs = Number(
          (c100 !== null ? c100 * ratio : (cServ ?? 0)).toFixed(1)
        );

        const f100 = toSafeNum(nutriments.fat_100g);
        const fServ = toSafeNum(nutriments.fat_serving);
        const fat = Number(
          (f100 !== null ? f100 * ratio : (fServ ?? 0)).toFixed(1)
        );

        const metricPortion = `${serving.amount} ${serving.unit}`;
        const healthScore = nutriscoreToHealthScore(
          typeof prod.nutriscore_grade === 'string'
            ? prod.nutriscore_grade
            : undefined,
          calories,
          protein,
          carbs,
          fat
        );

        const safeRatio = ratio > 0 ? ratio : 1;
        const per100: BarcodePer100Stats = {
          calories: Math.round(
            kcal100 !== null ? kcal100 : calories / safeRatio
          ),
          protein: Number(
            (p100 !== null ? p100 : protein / safeRatio).toFixed(1)
          ),
          carbs: Number(
            (c100 !== null ? c100 : carbs / safeRatio).toFixed(1)
          ),
          fat: Number((f100 !== null ? f100 : fat / safeRatio).toFixed(1)),
          unit: serving.unit,
        };
        const rawServingSize = String(prod.serving_size || '').trim() || undefined;
        const packageQuantity = String(prod.quantity || '').trim() || undefined;

        return {
          barcode: digits,
          title,
          brand: rawBrand || undefined,
          metricPortion,
          grams: serving.unit === 'g' ? serving.amount : null,
          calories,
          protein,
          carbs,
          fat,
          healthScore,
          summary: `Open Food Facts barcode ${digits} · nutrition per ${metricPortion}.`,
          per100,
          rawServingSize,
          packageQuantity,
          items: [
            {
              id: `bc_${digits}`,
              name: title,
              grams: serving.unit === 'g' ? serving.amount : null,
              portion: metricPortion,
              calories,
              protein,
              carbs,
              fat,
            },
          ],
        };
      }
    }

    if (OFFLINE_BARCODE_FALLBACKS[digits]) {
      return buildSeedResult(digits, OFFLINE_BARCODE_FALLBACKS[digits]);
    }

    throw new Error(
      `Barcode ${digits} was not found in the food database. Switch to "Food label" or "Scan food" to analyze the package with AI.`
    );
  } catch (err) {
    if (OFFLINE_BARCODE_FALLBACKS[digits]) {
      return buildSeedResult(digits, OFFLINE_BARCODE_FALLBACKS[digits]);
    }
    if (err instanceof Error && err.message.includes('not found')) {
      throw err;
    }
    throw new Error(
      `Could not look up barcode ${digits}. Check your connection or scan the nutrition label with AI.`
    );
  } finally {
    clearTimeout(timer);
  }
}
