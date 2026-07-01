import { describe, it, expect } from 'vitest';
import { computePlanProgress } from './progress';
import type { StudyUnit } from './types';

const unit = (over: Partial<StudyUnit>): StudyUnit => ({
  id: `u-${over.order ?? 0}`,
  order: over.order ?? 0,
  title: over.title ?? 'x',
  done: over.done ?? false,
  est: over.est,
  dep: over.dep,
  prog: over.prog ?? 0,
  lineIndex: over.lineIndex ?? -1,
});

describe('computePlanProgress', () => {
  it('returns zeros for empty unit list', () => {
    expect(computePlanProgress([])).toEqual({ total: 0, done: 0, percent: 0 });
  });

  it('counts done units and rounds percent', () => {
    const units = [
      unit({ order: 1, done: true }),
      unit({ order: 2, done: false }),
      unit({ order: 3, done: true }),
    ];
    expect(computePlanProgress(units)).toEqual({ total: 3, done: 2, percent: 67 });
  });

  it('reaches 100% when all done', () => {
    const units = [unit({ order: 1, done: true }), unit({ order: 2, done: true })];
    expect(computePlanProgress(units)).toEqual({ total: 2, done: 2, percent: 100 });
  });
});
