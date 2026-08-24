import { describe, it, expect } from 'vitest';
import { isExternalPath } from './isExternalPath';

describe('isExternalPath', () => {
  it('treats Unix absolute paths as external', () => {
    expect(isExternalPath('/Users/yiminlin/notes/a.md')).toBe(true);
    expect(isExternalPath('/tmp/x.txt')).toBe(true);
    expect(isExternalPath('/')).toBe(true);
  });

  it('treats home-relative shorthands as external', () => {
    expect(isExternalPath('~/folyn/notes/a.md')).toBe(true);
    expect(isExternalPath('~')).toBe(true);
    expect(isExternalPath('$HOME/Documents/x.md')).toBe(true);
  });

  it('treats Windows drive paths as external', () => {
    expect(isExternalPath('C:\\Users\\foo\\a.md')).toBe(true);
    expect(isExternalPath('C:/Users/foo/a.md')).toBe(true);
    expect(isExternalPath('d:/notes/x.md')).toBe(true);
  });

  it('treats vault-relative paths as NOT external', () => {
    expect(isExternalPath('notes/a.md')).toBe(false);
    expect(isExternalPath('__daily__/2026-01-01.md')).toBe(false);
    expect(isExternalPath('root.md')).toBe(false);
    expect(isExternalPath('sub/deep/file.txt')).toBe(false);
    expect(isExternalPath('')).toBe(false);
  });

  it('does not false-positive on names that merely contain a slash', () => {
    // relative paths with no leading slash are vault paths
    expect(isExternalPath('a/b/c.md')).toBe(false);
  });
});
