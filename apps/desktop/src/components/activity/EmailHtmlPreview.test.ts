// @vitest-environment jsdom
/**
 * Pure helpers of EmailHtmlPreview: html detection + DOMPurify sanitize
 * (jsdom environment — DOMPurify needs a DOM).
 */
import { describe, it, expect } from 'vitest';
import { looksLikeHtml, sanitizeBodyHtml } from './EmailHtmlPreview';

describe('looksLikeHtml', () => {
  it('detects tags and rejects plain text', () => {
    expect(looksLikeHtml('<html><body>hi</body></html>')).toBe(true);
    expect(looksLikeHtml('<!DOCTYPE html><p>x</p>')).toBe(true);
    expect(looksLikeHtml('Kilo Weekly 🏆\r\nRead more →')).toBe(false);
    expect(looksLikeHtml('a < b and c > d')).toBe(false);
    expect(looksLikeHtml('')).toBe(false);
  });
});

describe('sanitizeBodyHtml', () => {
  it('drops scripts, event handlers, forms; keeps structure and links', () => {
    const dirty =
      '<div onclick="alert(1)"><script>evil()</script><p>Kilo <a href="https://x.com">link</a></p><form><input></form></div>';
    const clean = sanitizeBodyHtml(dirty);
    expect(clean).toContain('href="https://x.com"');
    expect(clean).not.toContain('script');
    expect(clean).not.toContain('onclick');
    expect(clean).not.toContain('<form');
    expect(clean).not.toContain('<input');
  });

  it('javascript: hrefs never survive as links', () => {
    const clean = sanitizeBodyHtml('<a href="javascript:alert(1)">x</a>');
    expect(clean).not.toMatch(/<a[^>]*javascript:/i);
  });

  it('anchors are forced to target=_blank noopener (no in-webview navigation)', () => {
    const clean = sanitizeBodyHtml('<a href="https://x.com">link</a>');
    expect(clean).toContain('target="_blank"');
    expect(clean).toContain('rel="noopener noreferrer"');
  });
});
