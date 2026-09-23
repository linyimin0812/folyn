/**
 * Period + calendar math for the activity page (design §7.1). Pure date
 * helpers — no React, no i18n side effects. Locale-dependent LABELS are built
 * via `formatPeriodLabel` with an injected locale + week-label formatter.
 */

export type PeriodMode = 'today' | 'week' | 'month' | 'custom';

export interface Period {
  mode: PeriodMode;
  start: Date;
  end: Date;
}

export function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function endOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
}

export function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

/** Monday-based week start (matches the prototype's calendar). */
export function startOfWeek(d: Date): Date {
  const r = startOfDay(d);
  const day = (r.getDay() + 6) % 7;
  r.setDate(r.getDate() - day);
  return r;
}

export function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

export function endOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0);
}

/** ISO-ish week number (matches the prototype's formula). */
export function weekNumber(d: Date): number {
  const start = new Date(d.getFullYear(), 0, 1);
  const diff = (d.getTime() - start.getTime()) / 86_400_000;
  return Math.ceil((diff + start.getDay() + 1) / 7);
}

/** `YYYY-MM-DD` key — the contract of `activity_daily_digest_input`. */
export function dateKey(d: Date): string {
  const pad = (n: number) => (n < 10 ? `0${n}` : `${n}`);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export function quickRange(mode: 'today' | 'week' | 'month', ref: Date): Period {
  if (mode === 'today') return { mode, start: startOfDay(ref), end: startOfDay(ref) };
  if (mode === 'week') {
    const mon = startOfWeek(ref);
    return { mode, start: mon, end: addDays(mon, 6) };
  }
  return { mode, start: startOfMonth(ref), end: endOfMonth(ref) };
}

/** Does this period contain "now"? (Ongoing module shows only when true.) */
export function isCurrentPeriod(p: Period, ref: Date): boolean {
  const day = startOfDay(ref);
  return p.start <= day && p.end >= day;
}

/**
 * One month of calendar cells, Monday-first, always 42 cells (6 rows) —
 * `null` for cells outside the month. Pure: (year, month) → grid.
 */
export function calendarGrid(year: number, month: number): (Date | null)[] {
  const first = new Date(year, month, 1);
  const lead = (first.getDay() + 6) % 7;
  const days = new Date(year, month + 1, 0).getDate();
  const cells: (Date | null)[] = [];
  for (let i = 0; i < lead; i++) cells.push(null);
  for (let d = 1; d <= days; d++) cells.push(new Date(year, month, d));
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

/**
 * Prototype calendar pick semantics: first click = that single day; second
 * click on a LATER day = range (start..day); second click on the same/earlier
 * day = restart the pick at that day. Future days are rejected by the caller
 * before invoking this.
 */
export function pickDay(
  pickStart: Date | null,
  day: Date,
): { pickStart: Date | null; period: Period } {
  if (pickStart && day.getTime() > pickStart.getTime()) {
    return { pickStart: null, period: { mode: 'custom', start: pickStart, end: day } };
  }
  return { pickStart: day, period: { mode: 'custom', start: day, end: day } };
}

/**
 * Human label for the current period. `weekLabel` renders "第N周/Week N"
 * (i18n-owned); the date spans use Intl with the passed locale.
 */
export function formatPeriodLabel(
  p: Period,
  locale: string,
  weekLabel: (n: number) => string,
): string {
  const sameYear = p.start.getFullYear() === p.end.getFullYear();
  const md = new Intl.DateTimeFormat(locale, { month: 'long', day: 'numeric' });
  const m = new Intl.DateTimeFormat(locale, { month: 'long' });
  if (p.mode === 'week') {
    return `${weekLabel(weekNumber(p.start))} · ${md.format(p.start)} – ${md.format(p.end)}`;
  }
  if (p.mode === 'month') {
    const y = new Intl.DateTimeFormat(locale, { year: 'numeric' });
    return `${y.format(p.start)} ${m.format(p.start)}`;
  }
  if (sameDay(p.start, p.end)) return md.format(p.start);
  if (sameYear) return `${md.format(p.start)} – ${md.format(p.end)}`;
  const ymd = new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'long', day: 'numeric' });
  return `${ymd.format(p.start)} – ${ymd.format(p.end)}`;
}

/** "第 X/Y 天" progress for an ongoing task (metadata start/due, epoch ms). */
export function taskDayProgress(
  startDate: number,
  dueDate: number,
  today: Date,
): { current: number; total: number } {
  const t = startOfDay(today).getTime();
  const DAY = 86_400_000;
  const total = Math.max(1, Math.floor((dueDate - startDate) / DAY) + 1);
  const current = Math.min(total, Math.max(1, Math.floor((t - startDate) / DAY) + 1));
  return { current, total };
}
