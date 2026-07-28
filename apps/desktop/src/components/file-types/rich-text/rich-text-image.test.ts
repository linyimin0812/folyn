import { describe, it, expect } from 'vitest';
import { resolveVaultRelativePath, isLoadableUrlScheme } from './richTextContent';

// ponytail: the path-resolution pure function is split out of the React
// NodeView (RichTextImage.tsx) so it's unit-testable without Tauri / jsdom
// (same ceiling as the dbml ErDiagram — prosemirror view can't run in jsdom).
// The Tauri `convertFileSrc` + async `~`-resolution wrapper is exercised in-app.

describe('resolveVaultRelativePath', () => {
  const root = '/Users/me/quill/vault';

  it('joins a vault-relative path under the resolved vault root', () => {
    expect(resolveVaultRelativePath('assets/images/abc.png', root)).toBe(
      '/Users/me/quill/vault/assets/images/abc.png',
    );
  });

  it('strips a leading ./ before joining (markdown-style relative ref)', () => {
    expect(resolveVaultRelativePath('./assets/images/abc.png', root)).toBe(
      '/Users/me/quill/vault/assets/images/abc.png',
    );
  });

  it('does NOT join paths that start with a slash (treated as absolute, passthrough)', () => {
    // isExternalPath catches leading-slash first → returned verbatim. This
    // guards against a vault-relative ref accidentally starting with '/'.
    expect(resolveVaultRelativePath('/assets/x.png', root)).toBe('/assets/x.png');
  });

  it('trims a trailing slash on the vault root', () => {
    expect(resolveVaultRelativePath('a/b.png', root + '/')).toBe(
      '/Users/me/quill/vault/a/b.png',
    );
  });

  it('preserves nested subpaths', () => {
    expect(resolveVaultRelativePath('assets/images/sub/deep.png', root)).toBe(
      '/Users/me/quill/vault/assets/images/sub/deep.png',
    );
  });

  it('passes http(s) URLs through unchanged (external image link)', () => {
    expect(resolveVaultRelativePath('https://example.com/x.png', root)).toBe(
      'https://example.com/x.png',
    );
    expect(resolveVaultRelativePath('http://example.com/y.gif', root)).toBe(
      'http://example.com/y.gif',
    );
  });

  it('passes data: URLs through unchanged (inline base64)', () => {
    expect(resolveVaultRelativePath('data:image/png;base64,iVBOR=', root)).toBe(
      'data:image/png;base64,iVBOR=',
    );
  });

  it('passes asset:/tauri:/blob: URLs through unchanged (already-resolved)', () => {
    expect(resolveVaultRelativePath('asset://localhost/x.png', root)).toBe(
      'asset://localhost/x.png',
    );
    expect(resolveVaultRelativePath('tauri://localhost/x.png', root)).toBe(
      'tauri://localhost/x.png',
    );
    expect(resolveVaultRelativePath('blob:https://app/uuid', root)).toBe(
      'blob:https://app/uuid',
    );
  });

  it('passes already-absolute / ~/ / $HOME paths through unchanged', () => {
    expect(resolveVaultRelativePath('/abs/path/x.png', root)).toBe('/abs/path/x.png');
    expect(resolveVaultRelativePath('~/Pictures/x.png', root)).toBe('~/Pictures/x.png');
    expect(resolveVaultRelativePath('$HOME/Pictures/x.png', root)).toBe(
      '$HOME/Pictures/x.png',
    );
  });

  it('returns empty for an empty src', () => {
    expect(resolveVaultRelativePath('', root)).toBe('');
  });

  it('returns the raw src when no vault root is set (no crash)', () => {
    expect(resolveVaultRelativePath('assets/images/x.png', '')).toBe(
      'assets/images/x.png',
    );
  });
});

describe('isLoadableUrlScheme', () => {
  // Guards the NodeView against running convertFileSrc on URL srcs, which
  // would mangle `https://x/y.png` into `asset://localhost/https%3A...`.
  it('returns true for http/https/data/asset/tauri/blob schemes', () => {
    expect(isLoadableUrlScheme('https://example.com/x.png')).toBe(true);
    expect(isLoadableUrlScheme('http://example.com/y.gif')).toBe(true);
    expect(isLoadableUrlScheme('data:image/png;base64,iVBOR=')).toBe(true);
    expect(isLoadableUrlScheme('asset://localhost/x.png')).toBe(true);
    expect(isLoadableUrlScheme('tauri://localhost/x.png')).toBe(true);
    expect(isLoadableUrlScheme('blob:https://app/uuid')).toBe(true);
  });

  it('returns false for vault-relative and absolute filesystem paths', () => {
    expect(isLoadableUrlScheme('assets/images/x.png')).toBe(false);
    expect(isLoadableUrlScheme('./assets/x.png')).toBe(false);
    expect(isLoadableUrlScheme('/abs/path/x.png')).toBe(false);
    expect(isLoadableUrlScheme('~/Pictures/x.png')).toBe(false);
    expect(isLoadableUrlScheme('')).toBe(false);
  });
});
