import { describe, it, expect } from 'vitest';
import {
  hasContainerSyntax,
  HTML_STYLES,
  renderMarkdownToHtml,
} from './exportService';
import {
  readImageAsDataUrl,
  inlineImages,
  inlineContainerImages,
} from './export/shared';
import { writeFile } from '@tauri-apps/plugin-fs';

describe('hasContainerSyntax', () => {
  it('returns true for ::: container directives', () => {
    expect(hasContainerSyntax(':::note\nthis is a note\n:::')).toBe(true);
    expect(hasContainerSyntax('body\n\n:::warning\nhi\n:::')).toBe(true);
  });

  it('returns false for plain markdown', () => {
    expect(hasContainerSyntax('# heading\n\nbody text')).toBe(false);
  });

  it('returns false for empty content', () => {
    expect(hasContainerSyntax('')).toBe(false);
  });
});

describe('HTML_STYLES', () => {
  it('includes body, heading, and code block styles', () => {
    expect(HTML_STYLES).toContain('body {');
    expect(HTML_STYLES).toContain('h1 {');
    expect(HTML_STYLES.toLowerCase()).toContain('pre');
  });
});

describe('renderMarkdownToHtml', () => {
  it('renders headings and paragraphs to HTML', () => {
    const html = renderMarkdownToHtml('# Title\n\nbody text');
    expect(html).toMatch(/<h1[^>]*>Title<\/h1>/);
    expect(html).toContain('body text');
  });

  it('renders fenced code blocks with highlighting', () => {
    const md = '```js\nconst x = 1;\n```';
    const html = renderMarkdownToHtml(md);
    expect(html).toContain('<pre');
    expect(html).toContain('<code');
    // highlight.js wraps tokens in spans; verify the source is preserved.
    expect(html).toContain('const');
    expect(html).toContain('x');
    expect(html).toContain('1');
  });

  it('renders GFM tables', () => {
    const md = '| a | b |\n| --- | --- |\n| 1 | 2 |';
    const html = renderMarkdownToHtml(md);
    expect(html).toContain('<table');
    expect(html).toContain('<td');
  });

  it('passes through inline HTML when rehype-raw is enabled', () => {
    const md = '<div class="custom">hi</div>';
    const html = renderMarkdownToHtml(md);
    expect(html).toContain('<div class="custom">');
  });

  it('returns an empty string for empty input', () => {
    expect(renderMarkdownToHtml('')).toBe('');
  });
});

describe('readImageAsDataUrl', () => {
  it('returns a data URL with the correct mime type for a PNG', async () => {
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    await writeFile('/mock/img.png', bytes);
    const url = await readImageAsDataUrl('/mock/img.png');
    expect(url.startsWith('data:image/png;base64,')).toBe(true);
  });

  it('uses image/jpeg for .jpg files', async () => {
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
    await writeFile('/mock/photo.jpg', bytes);
    const url = await readImageAsDataUrl('/mock/photo.jpg');
    expect(url.startsWith('data:image/jpeg;base64,')).toBe(true);
  });

  it('falls back to image/png for unknown extensions', async () => {
    await writeFile('/mock/unknown.xyz', new Uint8Array([1, 2, 3]));
    const url = await readImageAsDataUrl('/mock/unknown.xyz');
    expect(url.startsWith('data:image/png;base64,')).toBe(true);
  });

  it('returns an empty string when the file does not exist', async () => {
    expect(await readImageAsDataUrl('/no/such/file.png')).toBe('');
  });
});

describe('inlineContainerImages', () => {
  it('inlines asset://localhost/ URLs by reading the file directly', async () => {
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    await writeFile('/mock/asset.png', bytes);
    const container = document.createElement('div');
    // Real convertFileSrc URL-encodes the path (leading / → %2F).
    container.innerHTML = '<img src="asset://localhost/%2Fmock%2Fasset.png" alt="x">';
    await inlineContainerImages(container);
    expect(container.querySelector('img')!.getAttribute('src')).toMatch(/^data:image\/png;base64,/);
  });

  it('inlines the Windows http://asset.localhost/ form too', async () => {
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    await writeFile('/mock/win.png', bytes);
    const container = document.createElement('div');
    container.innerHTML = '<img src="http://asset.localhost/%2Fmock%2Fwin.png" alt="x">';
    await inlineContainerImages(container);
    expect(container.querySelector('img')!.getAttribute('src')).toMatch(/^data:image\/png;base64,/);
  });

  it('leaves http(s) and data: image srcs untouched', async () => {
    const container = document.createElement('div');
    container.innerHTML = '<img src="https://example.com/a.png"><img src="data:image/png;base64,AAAA">';
    await inlineContainerImages(container);
    const [a, b] = Array.from(container.querySelectorAll('img'));
    expect(a.getAttribute('src')).toBe('https://example.com/a.png');
    expect(b.getAttribute('src')).toBe('data:image/png;base64,AAAA');
  });

  it('leaves an asset URL untouched when the file is missing', async () => {
    const container = document.createElement('div');
    container.innerHTML = '<img src="asset://localhost//mock/missing.png" alt="x">';
    await inlineContainerImages(container);
    expect(container.querySelector('img')!.getAttribute('src')).toBe('asset://localhost//mock/missing.png');
  });
});

describe('inlineImages', () => {
  it('replaces vault-file:// references with base64 data URLs', async () => {
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    await writeFile('/mock/vault/sub/a.png', bytes);
    const html = `<p><img src="vault-file://sub/a.png" alt="pic"/></p>`;
    const inlined = await inlineImages(html, '/mock/vault', undefined);
    expect(inlined).toContain('data:image/png;base64,');
    expect(inlined).not.toContain('vault-file://');
  });

  it('returns the html unchanged when no vault-file images are present', async () => {
    const html = '<p>no images here</p>';
    expect(await inlineImages(html, '/mock/vault', undefined)).toBe(html);
  });

  it('leaves http(s) and data: image srcs untouched', async () => {
    const html = '<img src="https://example.com/a.png" alt="x"/>';
    const inlined = await inlineImages(html, '/mock/vault', undefined);
    expect(inlined).toBe(html);
  });

  it('resolves image paths relative to the current file directory', async () => {
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    await writeFile('/mock/vault/notes/img/b.png', bytes);
    const html = `<img src="vault-file://img/b.png" alt="x"/>`;
    const inlined = await inlineImages(html, '/mock/vault', 'notes/doc.md');
    expect(inlined).toContain('data:image/png;base64,');
  });

  it('expands ~ in vaultRoot via homeDir', async () => {
    const bytes = new Uint8Array([0x89, 0x50]);
    await writeFile('/mock/home/vault/c.png', bytes);
    const html = `<img src="vault-file://c.png" alt="x"/>`;
    const inlined = await inlineImages(html, '~/vault', undefined);
    expect(inlined).toContain('data:image/png;base64,');
  });
});
