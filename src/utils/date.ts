/**
 * Timezone-safe local calendar date & monthly grid utilities (YYYY-MM-DD).
 */

export function toLocalDateKey(date: Date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function parseLocalDateKey(dateKey: string): Date {
  const [y, m, d] = dateKey.split('-').map((n) => parseInt(n, 10));
  if (!y || !m || !d) return new Date();
  return new Date(y, m - 1, d, 12, 0, 0, 0);
}

export function shiftDateKey(dateKey: string, deltaDays: number): string {
  const d = parseLocalDateKey(dateKey);
  d.setDate(d.getDate() + deltaDays);
  return toLocalDateKey(d);
}

export function isTodayKey(dateKey: string): boolean {
  return dateKey === toLocalDateKey();
}

export function isFutureDateKey(dateKey: string): boolean {
  return dateKey > toLocalDateKey();
}

export function formatFriendlyDate(dateKey: string): string {
  const today = toLocalDateKey();
  const yesterday = shiftDateKey(today, -1);

  const date = parseLocalDateKey(dateKey);
  const shortMonthDay = date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });

  if (dateKey === today) return `Today · ${shortMonthDay}`;
  if (dateKey === yesterday) return `Yesterday · ${shortMonthDay}`;

  return date.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: date.getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined,
  });
}

export function formatMonthYear(year: number, monthIndex: number): string {
  const d = new Date(year, monthIndex, 1, 12, 0, 0);
  return d.toLocaleDateString(undefined, {
    month: 'long',
    year: 'numeric',
  });
}

export interface CalendarCell {
  dateKey: string;
  dayNumber: number;
  inCurrentMonth: boolean;
  isToday: boolean;
  isFuture: boolean;
}

/**
 * Generates a Monday-first calendar grid (weeks of 7 days) for the given year & 0-indexed month.
 */
export function buildMonthCalendarGrid(year: number, monthIndex: number): CalendarCell[][] {
  const todayKey = toLocalDateKey();
  const firstOfMonth = new Date(year, monthIndex, 1, 12, 0, 0);
  const daysInMonth = new Date(year, monthIndex + 1, 0, 12, 0, 0).getDate();

  // Convert JS Sunday=0..Saturday=6 into Monday=0..Sunday=6
  const startOffset = (firstOfMonth.getDay() + 6) % 7;

  const totalCells = Math.ceil((startOffset + daysInMonth) / 7) * 7;
  const startCellDate = new Date(year, monthIndex, 1 - startOffset, 12, 0, 0);

  const flat: CalendarCell[] = [];
  for (let i = 0; i < totalCells; i++) {
    const cellDate = new Date(startCellDate);
    cellDate.setDate(startCellDate.getDate() + i);
    const key = toLocalDateKey(cellDate);
    flat.push({
      dateKey: key,
      dayNumber: cellDate.getDate(),
      inCurrentMonth: cellDate.getMonth() === monthIndex && cellDate.getFullYear() === year,
      isToday: key === todayKey,
      isFuture: key > todayKey,
    });
  }

  const weeks: CalendarCell[][] = [];
  for (let i = 0; i < flat.length; i += 7) {
    weeks.push(flat.slice(i, i + 7));
  }
  return weeks;
}

export function formatTimeShort(isoString: string): string {
  const d = new Date(isoString);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function inferMealTypeByHour(
  date: Date = new Date()
): 'breakfast' | 'lunch' | 'dinner' | 'snack' {
  const h = date.getHours();
  if (h >= 5 && h < 11) return 'breakfast';
  if (h >= 11 && h < 15) return 'lunch';
  if (h >= 17 && h < 22) return 'dinner';
  return 'snack';
}
