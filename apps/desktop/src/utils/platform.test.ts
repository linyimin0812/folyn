import { describe, it, expect } from 'vitest';
import { isTauri } from './platform';

describe('isTauri', () => {
  it('always returns true in desktop builds', () => {
    expect(isTauri()).toBe(true);
  });
});
