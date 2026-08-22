import { describe, it, expect } from 'vitest';
import {
  resolveVaultRelativePath,
  isLoadableUrlScheme,
  nextResizeWidth,
  figureHTML,
  IMAGE_MIN_WIDTH,
} from './richTextContent';

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

// ponytail: the resize-delta → width math is the only non-trivial logic in the
// Phase 1 drag-to-resize NodeView; it's split out as a pure function so it's
// unit-testable without a prosemirror view (jsdom ceiling — the actual
// pointer-drag is verified by opening a .richtext file in the running app).
describe('nextResizeWidth', () => {
  it('right handle: widens on positive delta, narrows on negative', () => {
    expect(nextResizeWidth('right', 400, 100, 1000)).toBe(500);
    expect(nextResizeWidth('right', 400, -100, 1000)).toBe(300);
  });

  it('left handle: dragging outward (negative delta) widens, inward (positive) narrows', () => {
    expect(nextResizeWidth('left', 400, -100, 1000)).toBe(500);
    expect(nextResizeWidth('left', 400, 100, 1000)).toBe(300);
  });

  it('clamps to IMAGE_MIN_WIDTH on the low end', () => {
    expect(nextResizeWidth('right', 400, -1000, 1000)).toBe(IMAGE_MIN_WIDTH);
    expect(nextResizeWidth('left', 400, 1000, 1000)).toBe(IMAGE_MIN_WIDTH);
  });

  it('clamps to maxWidth on the high end (no upscaling beyond native resolution)', () => {
    expect(nextResizeWidth('right', 400, 1000, 600)).toBe(600);
    expect(nextResizeWidth('left', 400, -1000, 600)).toBe(600);
  });

  it('rounds to integer px so the persisted width attr stays clean', () => {
    expect(nextResizeWidth('right', 400, 33.7, 1000)).toBe(434);
    expect(nextResizeWidth('left', 400, -33.2, 1000)).toBe(433);
  });
});

// ponytail: figureHTML is the pure renderHTML-array builder for the Image
// node. Split out of the extension so jsdom tests can cover the
// figure-vs-img decision without mounting prosemirror. The extension's
// renderHTML just delegates.
describe('figureHTML', () => {
  const baseAttrs = {
    src: 'assets/images/abc.png',
    alt: 'pic',
    title: null,
  };

  it('emits bare <img> when no caption and no alignment (backward compat)', () => {
    expect(figureHTML({ ...baseAttrs, width: null, dataAlign: null, caption: null })).toEqual([
      'img',
      { src: 'assets/images/abc.png', alt: 'pic', title: null },
    ]);
  });

  it('emits bare <img> with width when only width is set (no caption/align)', () => {
    expect(figureHTML({ ...baseAttrs, width: 480, dataAlign: null, caption: null })).toEqual([
      'img',
      { src: 'assets/images/abc.png', alt: 'pic', title: null, width: 480 },
    ]);
  });

  it('emits <figure><img><figcaption> when caption is non-empty', () => {
    expect(figureHTML({ ...baseAttrs, width: null, dataAlign: null, caption: 'A caption' })).toEqual([
      'figure',
      {},
      ['img', { src: 'assets/images/abc.png', alt: 'pic', title: null }],
      ['figcaption', {}, 'A caption'],
    ]);
  });

  it('emits <figure data-align><img> when only alignment is set (no caption)', () => {
    expect(figureHTML({ ...baseAttrs, width: null, dataAlign: 'center', caption: null })).toEqual([
      'figure',
      { 'data-align': 'center' },
      ['img', { src: 'assets/images/abc.png', alt: 'pic', title: null }],
      ['figcaption', {}, ''],
    ]);
  });

  it('emits <figure data-align><img width><figcaption> when all attrs set', () => {
    expect(
      figureHTML({ ...baseAttrs, width: 600, dataAlign: 'right', caption: 'Hello' }),
    ).toEqual([
      'figure',
      { 'data-align': 'right' },
      ['img', { src: 'assets/images/abc.png', alt: 'pic', title: null, width: 600 }],
      ['figcaption', {}, 'Hello'],
    ]);
  });

  it('treats empty-string caption as no caption (bare <img>)', () => {
    expect(figureHTML({ ...baseAttrs, width: null, dataAlign: null, caption: '' })).toEqual([
      'img',
      { src: 'assets/images/abc.png', alt: 'pic', title: null },
    ]);
  });
});
