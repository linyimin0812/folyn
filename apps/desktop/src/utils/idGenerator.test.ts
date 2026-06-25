import { describe, it, expect } from 'vitest';
import { generateId, generateShortId } from './idGenerator';

describe('generateId', () => {
  it('returns a string with the expected shape', () => {
    const id = generateId();
    expect(typeof id).toBe('string');
    expect(id).toMatch(/^\d+-[a-z0-9]+$/);
  });

  it('produces unique values across rapid calls', () => {
    const ids = new Set(Array.from({ length: 200 }, () => generateId()));
    expect(ids.size).toBeGreaterThan(190);
  });
});

describe('generateShortId', () => {
  it('returns a base-36-ish short string', () => {
    const id = generateShortId();
    expect(typeof id).toBe('string');
    expect(id.length).toBeGreaterThanOrEqual(6);
    expect(id).toMatch(/^[a-z0-9]+$/);
  });
});
