import { describe, it, expect } from 'vitest';
import { sortKeysDeep } from './sortKeysDeep';

describe('sortKeysDeep', () => {
  it('sorts top-level object keys alphabetically', () => {
    const input = { c: 1, a: 2, b: 3 };
    const result = sortKeysDeep(input);
    expect(Object.keys(result as Record<string, unknown>)).toEqual([
      'a',
      'b',
      'c',
    ]);
    expect(result).toEqual({ a: 2, b: 3, c: 1 });
  });

  it('sorts nested objects deep', () => {
    const input = {
      z: { y: 1, x: 2, w: { v: 3, u: 4 } },
      a: { c: 5, b: 6 },
    };
    const result = sortKeysDeep(input) as Record<string, unknown>;
    expect(Object.keys(result)).toEqual(['a', 'z']);
    expect(Object.keys(result.a as Record<string, unknown>)).toEqual([
      'b',
      'c',
    ]);
    const z = result.z as Record<string, unknown>;
    expect(Object.keys(z)).toEqual(['w', 'x', 'y']);
    const w = z.w as Record<string, unknown>;
    expect(Object.keys(w)).toEqual(['u', 'v']);
  });

  it('preserves array order but recurses into elements', () => {
    const input = [{ b: 1, a: 2 }, { d: 3, c: 4 }];
    const result = sortKeysDeep(input) as Array<Record<string, unknown>>;
    expect(result.length).toBe(2);
    expect(Object.keys(result[0])).toEqual(['a', 'b']);
    expect(Object.keys(result[1])).toEqual(['c', 'd']);
  });

  it('preserves top-level array order without sorting values', () => {
    const input = [3, 1, 2];
    const result = sortKeysDeep(input) as number[];
    expect(result).toEqual([3, 1, 2]);
  });

  it('returns primitives as-is', () => {
    expect(sortKeysDeep(42)).toBe(42);
    expect(sortKeysDeep('hello')).toBe('hello');
    expect(sortKeysDeep(true)).toBe(true);
    expect(sortKeysDeep(undefined)).toBe(undefined);
  });

  it('returns null as null without crashing', () => {
    expect(sortKeysDeep(null)).toBe(null);
  });

  it('handles empty objects and arrays', () => {
    expect(sortKeysDeep({})).toEqual({});
    expect(sortKeysDeep([])).toEqual([]);
  });

  it('does not mutate the input object', () => {
    const input = { c: 1, a: 2, b: 3 };
    sortKeysDeep(input);
    expect(Object.keys(input)).toEqual(['c', 'a', 'b']);
  });
});
