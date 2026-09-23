import { describe, expect, it } from 'vitest';
import {
  addDays,
  calendarGrid,
  dateKey,
  formatPeriodRange,
  isCurrentPeriod,
  pickDay,
  quickRange,
  sameDay,
  startOfWeek,
  taskDayProgress,
  weekNumber,
} from './period';

const ref = new Date(2026, 8, 23); // Wed 2026-09-23

describe('period math', () => {
  it('startOfWeek is Monday-based', () => {
    const mon = startOfWeek(ref);
    expect(mon.getDay()).toBe(1);
    expect(dateKey(mon)).toBe('2026-09-21');
    expect(dateKey(addDays(mon, 6))).toBe('2026-09-27');
  });

  it('quickRange today/week/month', () => {
    expect(quickRange('today', ref)).toMatchObject({ mode: 'today' });
    expect(sameDay(quickRange('today', ref).start, ref)).toBe(true);
    const w = quickRange('week', ref);
    expect(dateKey(w.start)).toBe('2026-09-21');
    expect(dateKey(w.end)).toBe('2026-09-27');
    const m = quickRange('month', ref);
    expect(dateKey(m.start)).toBe('2026-09-01');
    expect(dateKey(m.end)).toBe('2026-09-30');
  });

  it('weekNumber matches the prototype formula', () => {
    expect(weekNumber(new Date(2026, 0, 1))).toBe(1);
    expect(weekNumber(ref)).toBe(39);
  });

  it('isCurrentPeriod covers ref and rejects history/future', () => {
    expect(isCurrentPeriod(quickRange('week', ref), ref)).toBe(true);
    expect(isCurrentPeriod(quickRange('week', addDays(ref, -14)), ref)).toBe(false);
    expect(isCurrentPeriod({ mode: 'custom', start: addDays(ref, -2), end: addDays(ref, -1) }, ref)).toBe(false);
    expect(isCurrentPeriod({ mode: 'custom', start: addDays(ref, -2), end: addDays(ref, 2) }, ref)).toBe(true);
  });
});

describe('unified range label (calendar trigger)', () => {
  it('every mode renders the same numeric format — single day short, range full', () => {
    expect(formatPeriodRange(quickRange('today', ref), 'zh-CN')).toBe('2026/09/23');
    const w = quickRange('week', ref);
    expect(formatPeriodRange(w, 'zh-CN')).toBe('2026/09/21 – 2026/09/27');
    expect(formatPeriodRange(quickRange('month', ref), 'zh-CN')).toBe('2026/09/01 – 2026/09/30');
    expect(
      formatPeriodRange({ mode: 'custom', start: new Date(2026, 8, 10), end: new Date(2026, 8, 18) }, 'zh-CN'),
    ).toBe('2026/09/10 – 2026/09/18');
    // Ranges spanning years repeat the year on the end side (same formatter).
    expect(
      formatPeriodRange({ mode: 'custom', start: new Date(2025, 11, 28), end: new Date(2026, 0, 3) }, 'zh-CN'),
    ).toBe('2025/12/28 – 2026/01/03');
  });
});

describe('calendar grid + pick semantics', () => {
  it('grid is Monday-first with null lead/trailing cells', () => {
    // Sept 2026 starts on a Tuesday → 1 lead null.
    const grid = calendarGrid(2026, 8);
    expect(grid[0]).toBeNull();
    expect(dateKey(grid[1]!)).toBe('2026-09-01');
    expect(dateKey(grid[30]!)).toBe('2026-09-30');
    expect(grid.length % 7).toBe(0);
  });

  it('first pick selects a single day, later second pick selects a range', () => {
    const d1 = new Date(2026, 8, 10);
    const first = pickDay(null, d1);
    expect(first.pickStart && dateKey(first.pickStart)).toBe('2026-09-10');
    expect(first.period.mode).toBe('custom');
    expect(dateKey(first.period.end)).toBe('2026-09-10');

    const second = pickDay(d1, new Date(2026, 8, 18));
    expect(second.pickStart).toBeNull();
    expect(dateKey(second.period.start)).toBe('2026-09-10');
    expect(dateKey(second.period.end)).toBe('2026-09-18');
  });

  it('earlier second pick restarts the selection', () => {
    const d1 = new Date(2026, 8, 18);
    const second = pickDay(d1, new Date(2026, 8, 10));
    expect(second.pickStart && dateKey(second.pickStart)).toBe('2026-09-10');
    expect(dateKey(second.period.start)).toBe('2026-09-10');
    expect(dateKey(second.period.end)).toBe('2026-09-10');
  });
});

describe('ongoing task progress', () => {
  it('computes 第X/Y天 clamped to the window', () => {
    const DAY = 86_400_000;
    const start = ref.getTime() - 3 * DAY;
    const due = ref.getTime() + 6 * DAY; // 10-day window, day 4
    expect(taskDayProgress(start, due, ref)).toEqual({ current: 4, total: 10 });
    // Before the window starts → clamped to day 1.
    expect(taskDayProgress(start, due, addDays(ref, -10))).toEqual({ current: 1, total: 10 });
    // After it ends → clamped to total.
    expect(taskDayProgress(start, due, addDays(ref, 10))).toEqual({ current: 10, total: 10 });
  });
});
