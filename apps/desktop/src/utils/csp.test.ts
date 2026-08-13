import { describe, it, expect, afterEach } from 'vitest';
import { buildCsp, applyCsp, isValidSource, type CspConfig } from './csp';

const NETWORK_DIRECTIVES = [
  'script-src', 'style-src', 'font-src', 'img-src', 'media-src',
  'connect-src', 'worker-src', 'frame-src',
];

describe('buildCsp', () => {
  it('keeps the Tauri-required baseline', () => {
    const p = buildCsp({ mode: 'custom', allowedUrls: [] }, { dev: false });
    expect(p).toContain("default-src 'self'");
    expect(p).toContain("script-src 'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval' blob: quill-plugin:");
    expect(p).toContain("img-src 'self' data: blob: asset:");
    expect(p).toContain("connect-src 'self' ipc: http://ipc.localhost quill-plugin:");
    expect(p).toContain("frame-src 'self' blob: data: quill-plugin:");
  });

  it('appends custom URLs to every network directive, trimmed and deduped', () => {
    const config: CspConfig = {
      mode: 'custom',
      allowedUrls: ['https://example.com', '  https://cdn.example.net ', 'https://example.com'],
    };
    const p = buildCsp(config, { dev: false });
    for (const d of NETWORK_DIRECTIVES) {
      const directive = p.split('; ').find((x) => x.startsWith(`${d} `))!;
      expect(directive).toContain('https://example.com');
      expect(directive).toContain('https://cdn.example.net');
      expect(directive.match(/https:\/\/example\.com/g)).toHaveLength(1);
    }
  });

  it('all mode uses a wildcard source instead of a URL list', () => {
    const p = buildCsp({ mode: 'all', allowedUrls: ['https://ignored.example.com'] }, { dev: false });
    for (const d of NETWORK_DIRECTIVES) {
      expect(p).toContain(`${d} `);
      expect(p).toContain('*');
    }
    expect(p).not.toContain('https://ignored.example.com');
  });

  it('drops invalid user sources', () => {
    const p = buildCsp(
      { mode: 'custom', allowedUrls: ['bad url; evil', 'ok.example.com', "https://x'y"] },
      { dev: false },
    );
    expect(p).not.toContain('bad');
    expect(p).not.toContain("x'y");
    expect(p).toContain('ok.example.com');
  });

  it('adds the Vite dev-server endpoints only in dev', () => {
    const cfg: CspConfig = { mode: 'custom', allowedUrls: [] };
    expect(buildCsp(cfg, { dev: false })).not.toContain('ws://localhost:1420');
    const dev = buildCsp(cfg, { dev: true });
    expect(dev).toContain('http://localhost:1420');
    expect(dev).toContain('ws://localhost:1420');
  });
});

describe('isValidSource', () => {
  it('accepts hosts, URLs, scheme sources and wildcards', () => {
    for (const ok of ['example.com', '*.example.com', 'https://api.example.com', 'https:', 'wss://example.com', '127.0.0.1:46123', '*']) {
      expect(isValidSource(ok), ok).toBe(true);
    }
  });

  it('rejects empty, whitespace, quotes and semicolons', () => {
    for (const bad of ['', '   ', 'bad url', 'https://a b.com', 'foo;bar', "https://x'", 'https://x"']) {
      expect(isValidSource(bad), JSON.stringify(bad)).toBe(false);
    }
  });
});

describe('applyCsp', () => {
  afterEach(() => {
    document.head.innerHTML = '';
  });

  it('replaces existing CSP meta tags instead of stacking them', () => {
    applyCsp("default-src 'self'");
    applyCsp("default-src 'self'; connect-src *");
    const metas = document.querySelectorAll('meta[http-equiv="Content-Security-Policy"]');
    expect(metas).toHaveLength(1);
    expect(metas[0].getAttribute('content')).toBe("default-src 'self'; connect-src *");
  });
});
