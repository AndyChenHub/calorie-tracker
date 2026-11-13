import { WeightLogPoint } from '../types/models';

export type PlateIconName =
  | 'flame'
  | 'plus'
  | 'minus'
  | 'home'
  | 'chart'
  | 'sliders'
  | 'camera'
  | 'scan'
  | 'barcode'
  | 'label'
  | 'bookmark'
  | 'search'
  | 'dumbbell'
  | 'x'
  | 'check'
  | 'zap'
  | 'image'
  | 'back'
  | 'activity'
  | 'drop'
  | 'drum'
  | 'wheat'
  | 'heart'
  | 'sparkle'
  | 'swap'
  | 'trash'
  | 'scale'
  | 'down'
  | 'walk';

export interface PlateIconProps {
  name: PlateIconName;
  size?: number;
  color?: string;
  fill?: string;
  strokeWidth?: number;
}

export interface ProgressRingProps {
  size: number;
  strokeWidth: number;
  progress: number;
  color: string;
  trackColor?: string;
  dashedTrack?: string;
  children?: React.ReactNode;
}

export interface WeightAreaChartProps {
  history: WeightLogPoint[];
  currentWeight: number;
  startWeight: number;
  goalWeight: number;
  range: 30 | 90 | 180;
  todayKey: string;
}

export interface WeekBarDayPoint {
  dateKey: string;
  label: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
}

export interface WeeklyMacroBarsChartProps {
  days: WeekBarDayPoint[];
  calorieGoal: number;
  todayKey: string;
}

export function getDefaultStrokeWidth(name: PlateIconName): number {
  if (name === 'check') return 2.6;
  if (
    name === 'plus' ||
    name === 'minus' ||
    name === 'x' ||
    name === 'back' ||
    name === 'down'
  ) {
    return 2.4;
  }
  if (name === 'barcode') return 1.6;
  return 2;
}

export function smoothCatmullBezier(pts: [number, number][]): string {
  if (!pts.length) return '';
  if (pts.length === 1) return `M${pts[0][0]},${pts[0][1]}`;
  let d = `M${pts[0][0].toFixed(2)},${pts[0][1].toFixed(2)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] || p2;
    const c1x = p1[0] + (p2[0] - p0[0]) / 6;
    const c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6;
    const c2y = p2[1] - (p3[1] - p1[1]) / 6;
    d += ` C${c1x.toFixed(2)},${c1y.toFixed(2)} ${c2x.toFixed(2)},${c2y.toFixed(2)} ${p2[0].toFixed(2)},${p2[1].toFixed(2)}`;
  }
  return d;
}

function dateKeyToEpochDay(dateKey: string): number {
  const [y, m, d] = dateKey.split('-').map(Number);
  if (!y || !m || !d) return 0;
  return Math.floor(Date.UTC(y, m - 1, d) / 86400000);
}

export function computeWeightChartGeometry({
  history,
  currentWeight,
  startWeight,
  goalWeight,
  range,
  todayKey,
}: WeightAreaChartProps) {
  const W = 318;
  const H = 170;
  const L = 30;
  const T = 12;
  const B = 22;

  const todayDay = dateKeyToEpochDay(todayKey);
  const valid = (history ?? [])
    .filter((pt) => pt && typeof pt.weightKg === 'number' && Boolean(pt.dateKey))
    .map((pt) => ({
      dayOffset: todayDay - dateKeyToEpochDay(pt.dateKey),
      weightKg: pt.weightKg,
    }))
    .filter((pt) => pt.dayOffset >= 0 && pt.dayOffset <= range)
    .sort((a, b) => b.dayOffset - a.dayOffset);

  const pts =
    valid.length > 0 ? valid : [{ dayOffset: 0, weightKg: currentWeight }];

  const allVals = [...pts.map((p) => p.weightKg), goalWeight, startWeight];
  const mn = Math.floor(Math.min(...allVals) - 1.5);
  const mx = Math.max(mn + 3, Math.ceil(Math.max(...allVals) + 1.5));

  const xOfOffset = (dayOffset: number) =>
    L + ((range - dayOffset) / range) * (W - L - 8);
  const yOf = (v: number) => T + (1 - (v - mn) / (mx - mn)) * (H - T - B);

  const coords: [number, number][] = pts.map((p) => [
    xOfOffset(p.dayOffset),
    yOf(p.weightKg),
  ]);
  const hasTrendLine = coords.length >= 2;
  const linePath = hasTrendLine ? smoothCatmullBezier(coords) : '';
  const first = coords[0] || [W - 8, H - B];
  const last = coords[coords.length - 1] || [W - 8, H - B];
  const areaPath = hasTrendLine
    ? `${linePath} L${last[0].toFixed(2)},${H - B} L${first[0].toFixed(2)},${H - B} Z`
    : '';

  const gridLines = [0, 1, 2, 3].map((i) => {
    const val = mn + ((mx - mn) * i) / 3;
    return {
      y: yOf(val),
      label: val.toFixed(0),
    };
  });

  const rawLabels =
    range === 30
      ? ['4w', '3w', '2w', '1w', 'Now']
      : range === 90
        ? ['3mo', '2mo', '1mo', 'Now']
        : ['6mo', '4mo', '2mo', 'Now'];

  const xLabels = rawLabels.map((label, i) => ({
    label,
    x: L + (i / (rawLabels.length - 1)) * (W - L - 22),
    y: H - 4,
  }));

  return {
    W,
    H,
    L,
    T,
    B,
    hasTrendLine,
    linePath,
    areaPath,
    last,
    goalY: yOf(goalWeight),
    gridLines,
    xLabels,
  };
}

export interface ComputedBarRect {
  x: number;
  y: number;
  width: number;
  height: number;
  rx: number;
  color: string;
}

export function computeWeekBarsGeometry(
  days: WeekBarDayPoint[],
  calorieGoal: number
) {
  const W = 318;
  const H = 160;
  const B = 22;
  const T = 10;
  const bw = 26;
  const chartH = H - T - B;

  const maxVal = Math.max(
    calorieGoal * 1.3,
    1000,
    ...days.map((d) =>
      Math.max(d.calories, d.protein * 4 + d.carbs * 4 + d.fat * 9)
    )
  );
  const yOf = (v: number) => T + (1 - v / maxVal) * chartH;
  const gap = (W - 7 * bw) / 7;

  const dayColumns = days.map((d, i) => {
    const x = gap / 2 + i * (bw + gap);
    let base = H - B;
    const segments: ComputedBarRect[] = [];

    const macroTotal = d.protein * 4 + d.carbs * 4 + d.fat * 9;
    const scale =
      macroTotal > 0 && d.calories > 0 ? d.calories / macroTotal : 1;

    const rawSegs: [number, string][] =
      macroTotal > 0
        ? [
            [d.protein * 4 * scale, '#F2665A'],
            [d.carbs * 4 * scale, '#F0A23B'],
            [d.fat * 9 * scale, '#4C8DF6'],
          ]
        : d.calories > 0
          ? [[d.calories, '#0B0B0C']]
          : [];

    rawSegs.forEach(([val, col], idx) => {
      const h = (val / maxVal) * chartH;
      if (h <= 0.5) return;
      segments.push({
        x,
        y: base - h,
        width: bw,
        height: h,
        rx: idx === rawSegs.length - 1 ? 7 : 2,
        color: col,
      });
      base -= h;
    });

    if (segments.length === 0) {
      segments.push({
        x,
        y: H - B - 6,
        width: bw,
        height: 6,
        rx: 3,
        color: '#EEEEF1',
      });
    }

    return {
      dateKey: d.dateKey,
      label: d.label,
      labelX: x + bw / 2,
      labelY: H - 5,
      segments,
    };
  });

  return {
    W,
    H,
    goalY: yOf(calorieGoal),
    dayColumns,
  };
}
