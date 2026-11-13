export const plateColors = {
  bg: '#F5F5F7',
  stageBg: '#E9E9ED',
  card: '#FFFFFF',
  ink: '#0B0B0C',
  ink2: '#3A3A3F',
  muted: '#8A8A90',
  faint: '#B9B9BF',
  line: '#ECECEF',
  chip: '#F2F2F4',
  protein: '#F2665A',
  carbs: '#F0A23B',
  fat: '#4C8DF6',
  ok: '#34C77B',
  flame: '#FF8A1F',
  danger: '#E5484D',
  track: '#EFEFF2',
} as const;

export const cardShadow = {
  shadowColor: '#000000',
  shadowOffset: { width: 0, height: 8 },
  shadowOpacity: 0.06,
  shadowRadius: 18,
  elevation: 3,
} as const;

export const colors = {
  background: plateColors.bg,
  backgroundElevated: plateColors.chip,
  surface: plateColors.card,
  surfaceSubtle: plateColors.chip,
  text: plateColors.ink,
  textSecondary: plateColors.muted,
  textMuted: plateColors.faint,
  border: plateColors.line,
  borderLight: plateColors.line,
  borderStrong: '#DCDCE0',
  accent: plateColors.ink,
  accentBright: plateColors.ok,
  accentSoft: 'rgba(52, 199, 123, 0.14)',
  warning: plateColors.carbs,
  danger: plateColors.danger,
  dangerSoft: 'rgba(229, 72, 77, 0.12)',
  macros: {
    protein: plateColors.protein,
    carbs: plateColors.carbs,
    fat: plateColors.fat,
  },
  providers: {
    antigravity: {
      label: 'Antigravity',
      main: '#1A73E8',
      solid: '#1A73E8',
      soft: '#E8F0FE',
    },
    claude: {
      label: 'Claude',
      main: '#D97757',
      solid: '#D97757',
      soft: '#FDF0EB',
    },
    gpt: {
      label: 'GPT',
      main: '#10A37F',
      solid: '#10A37F',
      soft: '#E6F7F2',
    },
  },
} as const;

export const mealTypeMeta = {
  breakfast: { label: 'Breakfast', accent: '#F0A23B', bg: '#FFF6E8' },
  lunch: { label: 'Lunch', accent: '#34C77B', bg: '#E8FAF0' },
  dinner: { label: 'Dinner', accent: '#4C8DF6', bg: '#EAF2FE' },
  snack: { label: 'Snack', accent: '#F2665A', bg: '#FEECEB' },
} as const;

export function getCalorieDayGradient(
  calories: number,
  goal: number,
  mealCount: number
): { gradient: [string, string]; textColor: string; borderColor: string } {
  if (!mealCount || calories <= 0) {
    return {
      gradient: ['#F2F2F4', '#ECECEF'],
      textColor: plateColors.muted,
      borderColor: plateColors.line,
    };
  }
  const ratio = calories / Math.max(1, goal);
  if (ratio <= 1.08) {
    return {
      gradient: ['#34C77B', '#28A965'],
      textColor: '#FFFFFF',
      borderColor: '#28A965',
    };
  }
  return {
    gradient: ['#F2665A', '#E5484D'],
    textColor: '#FFFFFF',
    borderColor: '#E5484D',
  };
}
