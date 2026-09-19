// extensionAssetUrl — the one place that knows the WebView2 vs WKWebView
// URL forms for the folyn-extension scheme. The Windows branch is the exact
// path that produced the "Navigation to external protocol blocked by
// sandbox" blank-tool error, so both branches get asserted.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { extensionAssetUrl } from './extensionUrl';

const setUa = (ua: string) => {
  vi.stubGlobal('navigator', { userAgent: ua });
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('extensionAssetUrl', () => {
  it('macOS/Linux: native custom-scheme form (jsdom default UA)', () => {
    setUa(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15',
    );
    expect(extensionAssetUrl('diff-viewer', 'index.html')).toBe(
      'folyn-extension://localhost/diff-viewer/index.html',
    );
  });

  it('Windows: WebView2 virtual-host http form (the fix)', () => {
    setUa(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36 Edg/126',
    );
    expect(extensionAssetUrl('paste-history', 'index.html')).toBe(
      'http://folyn-extension.localhost/paste-history/index.html',
    );
  });
});
