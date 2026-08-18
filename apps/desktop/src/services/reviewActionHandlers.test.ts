import { describe, it, expect } from 'vitest';
import {
  extractContradictionClaims,
  applyContradictionToBody,
} from './reviewActionHandlers';

describe('extractContradictionClaims', () => {
  it('extracts new + old claim from the localized description', () => {
    const out = extractContradictionClaims(
      '新说法: "earth is round" vs 已有: "earth is flat" (来源: entities/earth.md)',
      '矛盾: earth is round',
    );
    expect(out).toEqual({ newClaim: 'earth is round', oldClaim: 'earth is flat' });
  });

  it('falls back to title-stripped claim when description regex misses (locale drift)', () => {
    const out = extractContradictionClaims(undefined, '矛盾: earth is round');
    expect(out).toEqual({ newClaim: 'earth is round', oldClaim: '' });
  });

  it('falls back to raw title when prefix is absent', () => {
    const out = extractContradictionClaims(undefined, 'earth is round');
    expect(out).toEqual({ newClaim: 'earth is round', oldClaim: '' });
  });
});

describe('applyContradictionToBody', () => {
  it('replaces the first occurrence of the old claim in the body', () => {
    const out = applyContradictionToBody(
      'The earth is flat and stationary.',
      'earth is round',
      'earth is flat',
    );
    expect(out).toEqual({
      body: 'The earth is round and stationary.',
      replaced: true,
    });
  });

  it('appends a 新说法 (待整合) section when the old claim is not found verbatim', () => {
    const out = applyContradictionToBody('# Earth\n\nno matching text', 'earth is round', 'earth is flat');
    expect(out.replaced).toBe(false);
    expect(out.body).toContain('## 新说法 (待整合)');
    expect(out.body).toContain('earth is round');
  });

  it('appends when oldClaim is empty (regex extraction failed)', () => {
    const out = applyContradictionToBody('# Earth\n\nbody', 'earth is round', '');
    expect(out.replaced).toBe(false);
    expect(out.body.endsWith('earth is round\n')).toBe(true);
  });
});
