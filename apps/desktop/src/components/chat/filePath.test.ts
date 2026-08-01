import { describe, it, expect, beforeEach } from 'vitest';
import { matchFilePath, clearPathExistsCache, checkPathExists } from './filePath';

describe('matchFilePath', () => {
  it('matches a bare filename with known extension', () => {
    expect(matchFilePath('foo.md')).toEqual({ path: 'foo.md' });
    expect(matchFilePath('note.ts')).toEqual({ path: 'note.ts' });
  });

  it('matches a multi-segment vault-relative path', () => {
    expect(matchFilePath('apps/desktop/src/foo.ts')).toEqual({
      path: 'apps/desktop/src/foo.ts',
    });
  });

  it('matches an absolute path', () => {
    expect(matchFilePath('/Users/x/notes/foo.md')).toEqual({
      path: '/Users/x/notes/foo.md',
    });
  });

  it('matches a home-relative path', () => {
    expect(matchFilePath('~/notes/foo.md')).toEqual({
      path: '~/notes/foo.md',
    });
  });

  it('matches with a :line suffix', () => {
    expect(matchFilePath('foo.ts:12')).toEqual({
      path: 'foo.ts',
      line: 12,
    });
  });

  it('matches with a :line:col suffix', () => {
    expect(matchFilePath('apps/desktop/src/foo.ts:42:8')).toEqual({
      path: 'apps/desktop/src/foo.ts',
      line: 42,
      col: 8,
    });
  });

  it('rejects URLs', () => {
    expect(matchFilePath('https://example.com/foo.md')).toBeNull();
    expect(matchFilePath('http://foo.dev/bar.ts')).toBeNull();
    expect(matchFilePath('ftp://host/file.md')).toBeNull();
  });

  it('rejects strings with spaces', () => {
    expect(matchFilePath('see foo.md')).toBeNull();
    expect(matchFilePath('foo .md')).toBeNull();
  });

  it('rejects strings starting with ( or [ (function calls / brackets)', () => {
    expect(matchFilePath('(foo.ts)')).toBeNull();
    expect(matchFilePath('[foo.ts]')).toBeNull();
    expect(matchFilePath('{foo.ts}')).toBeNull();
  });

  it('rejects unknown extensions', () => {
    expect(matchFilePath('foo.xyz')).toBeNull();
    expect(matchFilePath('README')).toBeNull();
    expect(matchFilePath('foo.')).toBeNull();
  });

  it('rejects plain numbers / dates without extension', () => {
    expect(matchFilePath('2026-01-01')).toBeNull();
    expect(matchFilePath('12345')).toBeNull();
  });

  it('rejects function-call shapes', () => {
    expect(matchFilePath('foo()')).toBeNull();
    expect(matchFilePath('foo(bar).ts')).toBeNull();
  });

  it('treats :line without col as line-only', () => {
    expect(matchFilePath('foo.ts:5')).toEqual({ path: 'foo.ts', line: 5 });
  });

  it('rejects :non-numeric suffix', () => {
    // `foo.ts:abc` — the regex's optional :line:col can't match `:abc`, so
    // the whole string becomes the path; the path no longer ends in a
    // known extension (it ends in `:abc`), so matchFilePath returns null.
    expect(matchFilePath('foo.ts:abc')).toBeNull();
  });
});

describe('checkPathExists cache', () => {
  beforeEach(() => {
    clearPathExistsCache();
  });

  it('dedupes concurrent and repeated calls', async () => {
    let calls = 0;
    const resolver = async (raw: string): Promise<boolean> => {
      calls++;
      await new Promise((r) => setTimeout(r, 10));
      return raw === 'exists.md';
    };

    const [a, b] = await Promise.all([
      checkPathExists('exists.md', resolver),
      checkPathExists('exists.md', resolver), // concurrent — should dedupe
    ]);
    expect(a).toBe(true);
    expect(b).toBe(true);
    expect(calls).toBe(1);

    const c = await checkPathExists('exists.md', resolver); // cached
    expect(c).toBe(true);
    expect(calls).toBe(1);

    const d = await checkPathExists('nope.md', resolver);
    expect(d).toBe(false);
    expect(calls).toBe(2);
  });

  it('swallows resolver errors as false', async () => {
    const resolver = async (): Promise<boolean> => {
      throw new Error('boom');
    };
    const ok = await checkPathExists('whatever.md', resolver);
    expect(ok).toBe(false);
  });
});
