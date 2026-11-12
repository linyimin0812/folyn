import { describe, it, expect } from 'vitest';
import { classifyLinkHref, resolveLinkPath } from './linkTarget';

describe('classifyLinkHref', () => {
  it('treats only http(s) and www. hrefs as web links', () => {
    expect(classifyLinkHref('https://a.com', 'n.md')).toEqual({ kind: 'web', url: 'https://a.com' });
    expect(classifyLinkHref('HTTP://a.com', 'n.md')).toEqual({ kind: 'web', url: 'HTTP://a.com' });
    expect(classifyLinkHref('www.baidu.com', 'n.md')).toEqual({ kind: 'web', url: 'https://www.baidu.com' });
  });

  it('routes mailto/tel/ftp to the system handler', () => {
    expect(classifyLinkHref('mailto:a@b.c', 'n.md')).toEqual({ kind: 'system', url: 'mailto:a@b.c' });
  });

  it('keeps in-page anchors', () => {
    expect(classifyLinkHref('#intro', 'n.md')).toEqual({ kind: 'anchor' });
  });

  it('resolves a relative document link against the linking file (repro)', () => {
    expect(classifyLinkHref('references/repository-evidence.md', 'skills/foo/SKILL.md'))
      .toEqual({ kind: 'file', path: 'skills/foo/references/repository-evidence.md' });
  });
});

describe('resolveLinkPath', () => {
  it('handles ./ and ../ segments', () => {
    expect(resolveLinkPath('./b.md', 'docs/a.md')).toBe('docs/b.md');
    expect(resolveLinkPath('../x/b.md', 'docs/sub/a.md')).toBe('docs/x/b.md');
    expect(resolveLinkPath('b.md', 'a.md')).toBe('b.md');
  });

  it('keeps an external linking file absolute', () => {
    expect(resolveLinkPath('refs/b.md', '/Users/me/notes/a.md')).toBe('/Users/me/notes/refs/b.md');
  });

  it('passes absolute and home-relative targets through', () => {
    expect(resolveLinkPath('/tmp/b.md', 'docs/a.md')).toBe('/tmp/b.md');
    expect(resolveLinkPath('~/b.md', 'docs/a.md')).toBe('~/b.md');
  });

  it('drops the fragment and decodes escapes', () => {
    expect(resolveLinkPath('my%20note.md#section', 'docs/a.md')).toBe('docs/my note.md');
  });
});
