import { describe, it, expect } from 'vitest';
import { boxesTooClose } from './erLayout';

describe('boxesTooClose', () => {
  it('is true for overlapping boxes', () => {
    const a = { x: 0, y: 0, width: 100, height: 100 };
    const b = { x: 50, y: 50, width: 100, height: 100 };
    expect(boxesTooClose(a, b, 24)).toBe(true);
  });

  it('is true when boxes are separate but within minGap', () => {
    const a = { x: 0, y: 0, width: 100, height: 100 };
    const b = { x: 110, y: 0, width: 100, height: 100 }; // 10px gap on x
    expect(boxesTooClose(a, b, 24)).toBe(true);
  });

  it('is false when boxes are exactly minGap apart', () => {
    const a = { x: 0, y: 0, width: 100, height: 100 };
    const b = { x: 124, y: 0, width: 100, height: 100 }; // exactly 24px gap
    expect(boxesTooClose(a, b, 24)).toBe(false);
  });

  it('is false when boxes are far apart on both axes', () => {
    const a = { x: 0, y: 0, width: 100, height: 100 };
    const b = { x: 500, y: 500, width: 100, height: 100 };
    expect(boxesTooClose(a, b, 24)).toBe(false);
  });

  it('is false when boxes only align on one axis with enough gap on the other', () => {
    // Same x range, but far apart vertically — a real router would still
    // treat this pair as "not obstructing" for a horizontal exit direction.
    const a = { x: 0, y: 0, width: 100, height: 100 };
    const b = { x: 0, y: 300, width: 100, height: 100 };
    expect(boxesTooClose(a, b, 24)).toBe(false);
  });
});
