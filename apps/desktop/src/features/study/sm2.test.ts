import { describe, it, expect } from 'vitest';
import { reviewAtom, addDays, isDue } from './sm2';
import type { Sm2State } from './types';

const TODAY = '2026-06-29';

const FRESH: Sm2State = { rep: 0, ef: 2.5, ivl: 1, lapses: 0 };

describe('addDays', () => {
  it('adds days across month boundary', () => {
    expect(addDays('2026-06-29', 1)).toBe('2026-06-30');
    expect(addDays('2026-06-29', 6)).toBe('2026-07-05');
    expect(addDays('2026-06-29', 15)).toBe('2026-07-14');
  });
  it('passes through invalid date strings unchanged', () => {
    expect(addDays('not-a-date', 5)).toBe('not-a-date');
  });
});

describe('isDue', () => {
  it('treats next <= today as due', () => {
    expect(isDue('2026-06-29', TODAY)).toBe(true);
    expect(isDue('2026-06-28', TODAY)).toBe(true);
  });
  it('treats future next as not due', () => {
    expect(isDue('2026-07-02', TODAY)).toBe(false);
  });
});

describe('reviewAtom (SM-2 worked example from prd.md)', () => {
  // Fresh: rep:0 ef:2.5 ivl:1 lapses:0
  it('Good → rep1 / ivl1 / next+1 / ef 2.5', () => {
    const r = reviewAtom(FRESH, 'good', TODAY);
    expect(r.rep).toBe(1);
    expect(r.ivl).toBe(1);
    expect(r.ef).toBe(2.5);
    expect(r.lapses).toBe(0);
    expect(r.next).toBe('2026-06-30');
  });

  it('Good again → rep2 / ivl6 / next+6', () => {
    const r = reviewAtom({ rep: 1, ef: 2.5, ivl: 1, lapses: 0 }, 'good', TODAY);
    expect(r.rep).toBe(2);
    expect(r.ivl).toBe(6);
    expect(r.ef).toBeCloseTo(2.5, 5);
    expect(r.next).toBe('2026-07-05');
  });

  it('Good third → rep3 / ivl15 (round(6*2.5))', () => {
    const r = reviewAtom({ rep: 2, ef: 2.5, ivl: 6, lapses: 0 }, 'good', TODAY);
    expect(r.rep).toBe(3);
    expect(r.ivl).toBe(15);
    expect(r.next).toBe('2026-07-14');
  });

  it('Hard → ef drops to 2.36', () => {
    // 从 rep:3 ivl:15 ef:2.5 评级 Hard
    const r = reviewAtom({ rep: 3, ef: 2.5, ivl: 15, lapses: 0 }, 'hard', TODAY);
    expect(r.ef).toBeCloseTo(2.36, 5);
    expect(r.rep).toBe(4);
    // ivl = round(15 * 2.5) = 38
    expect(r.ivl).toBe(38);
  });

  it('Again → rep0 / ivl1 / lapses+1 / ef unchanged (no ease hell)', () => {
    const r = reviewAtom({ rep: 4, ef: 2.36, ivl: 38, lapses: 0 }, 'again', TODAY);
    expect(r.rep).toBe(0);
    expect(r.ivl).toBe(1);
    expect(r.lapses).toBe(1);
    expect(r.ef).toBeCloseTo(2.36, 5); // 不降 ef
    expect(r.next).toBe('2026-06-30');
  });
});

describe('reviewAtom (rating → q mapping)', () => {
  it('Easy (q=5) keeps ef at 2.5 and grows ivl', () => {
    const r = reviewAtom({ rep: 2, ef: 2.5, ivl: 6, lapses: 0 }, 'easy', TODAY);
    // ef = 2.5 + (0.1 - 0*(...)) = 2.6
    expect(r.ef).toBeCloseTo(2.6, 5);
    expect(r.ivl).toBe(15);
    expect(r.rep).toBe(3);
  });

  it('ef floors at 1.3', () => {
    // 让 ef 跌穿下限：从 1.3 反复 Hard 会更低，但下限保护
    const r = reviewAtom({ rep: 5, ef: 1.3, ivl: 100, lapses: 0 }, 'hard', TODAY);
    // ef = 1.3 + (0.1 - 2*(0.08+0.04)) = 1.3 + (0.1 - 0.24) = 1.16 → 钳到 1.3
    expect(r.ef).toBe(1.3);
  });
});

describe('reviewAtom (lapse → good recovery)', () => {
  it('after Again, a Good restarts the rep ladder without resetting lapses', () => {
    // 模拟：先 Again（lapse），再 Good 恢复
    const afterLapse = reviewAtom({ rep: 4, ef: 2.5, ivl: 38, lapses: 0 }, 'again', TODAY);
    expect(afterLapse.lapses).toBe(1);
    expect(afterLapse.rep).toBe(0);
    // 恢复：Good 后 rep→1, ivl=1, ef 不变（Again 没降 ef）
    const recovered = reviewAtom(afterLapse, 'good', TODAY);
    expect(recovered.rep).toBe(1);
    expect(recovered.ivl).toBe(1);
    expect(recovered.lapses).toBe(1); // lapses 不重置
    expect(recovered.ef).toBeCloseTo(2.5, 5);
    expect(recovered.next).toBe('2026-06-30');
  });
});
