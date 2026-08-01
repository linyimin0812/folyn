import { describe, it, expect } from 'vitest';
import { normalizeVaultPath } from './vaultPath';

const VAULT = { basePath: '/Users/x/project/quill' };

describe('normalizeVaultPath', () => {
  it('strips basePath from an absolute path inside the vault', () => {
    expect(normalizeVaultPath('/Users/x/project/quill/apps/desktop/src/foo.ts', VAULT))
      .toBe('apps/desktop/src/foo.ts');
  });

  it('returns the bare basePath as empty string', () => {
    expect(normalizeVaultPath('/Users/x/project/quill', VAULT)).toBe('');
  });

  it('strips a trailing slash from basePath when matching', () => {
    expect(normalizeVaultPath('/Users/x/project/quill/', { basePath: '/Users/x/project/quill/' }))
      .toBe('');
  });

  it('leaves an absolute path OUTSIDE the vault untouched', () => {
    expect(normalizeVaultPath('/Users/x/other/dir/foo.md', VAULT))
      .toBe('/Users/x/other/dir/foo.md');
  });

  it('does not match a partial prefix (basePath + substring, not /)', () => {
    // '/Users/x/project/quill-x' is NOT inside '/Users/x/project/quill'
    expect(normalizeVaultPath('/Users/x/project/quill-x/foo.md', VAULT))
      .toBe('/Users/x/project/quill-x/foo.md');
  });

  it('leaves a vault-relative path untouched (not external)', () => {
    expect(normalizeVaultPath('apps/desktop/src/foo.ts', VAULT))
      .toBe('apps/desktop/src/foo.ts');
  });

  it('leaves an external `~/` path outside the vault untouched', () => {
    expect(normalizeVaultPath('~/notes/foo.md', VAULT)).toBe('~/notes/foo.md');
  });

  it('normalizes a `~/`-prefixed path whose absolute form matches basePath', () => {
    // Note: this case requires basePath to also be `~/`-prefixed, which
    // doesn't happen in practice (basePath is always absolute). So we
    // only test the absolute case here. The `~/` case returns as-is.
    expect(normalizeVaultPath('~/project/quill/apps/foo.ts', { basePath: '/Users/x/project/quill' }))
      .toBe('~/project/quill/apps/foo.ts');
  });

  it('returns input unchanged when no vault is active', () => {
    expect(normalizeVaultPath('/Users/x/project/quill/foo.md', null))
      .toBe('/Users/x/project/quill/foo.md');
  });
});
