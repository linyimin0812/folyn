import { describe, expect, it } from 'vitest';
import { treeStrategy } from './tree';

// ponytail: treeBranch is the only generator with a real branch (straight
// line vs elbow+bezier). One test per side of the fork is the smallest
// check that fails if the geometry breaks. Other generators are straight
// stubs/lines — trivial, YAGNI applies.
describe('treeStrategy.branch.main (treeBranch)', () => {
  const gen = treeStrategy.branch!.main;
  const base = { pT: 0, pL: 0, pW: 100, pH: 40 };

  it('draws a straight line when parent and child centers align', () => {
    // child at y=0..40 → y2 = 20 = y1 → straight line branch
    const out = gen({
      ...base,
      pT: 0, pL: 0, pW: 100, pH: 40,
      cT: 0, cL: 200, cW: 60, cH: 40,
    });
    expect(out).toBe('M 100 20 L 200 20');
  });

  it('draws an elbow path when centers are offset', () => {
    // child below parent → y2 > y1 → rounded elbow with quadratic corners
    const out = gen({
      ...base,
      pT: 0, pL: 0, pW: 100, pH: 40,
      cT: 60, cL: 200, cW: 60, cH: 40,
    });
    // y1 = 20, y2 = 80, midX = 150, r = 8
    // Path: M 100 20 H 142 Q 150 20 150 28 V 72 Q 150 80 158 80 H 200
    expect(out).toContain('M 100 20');
    expect(out).toMatch(/Q 150 20 150 28/);
    expect(out).toMatch(/Q 150 80 158 80/);
    expect(out).toContain('H 200');
  });
});
