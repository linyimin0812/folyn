// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import {
  LARGE_HTML_THRESHOLD,
  defaultModeForHtmlContent,
  isLargeHtmlContent,
  formatHtmlSizeKb,
} from './HtmlVisualEditor';

describe('HtmlVisualEditor size guard', () => {
  describe('LARGE_HTML_THRESHOLD', () => {
    it('is 512 KB expressed in characters', () => {
      expect(LARGE_HTML_THRESHOLD).toBe(512 * 1024);
    });
  });

  describe('defaultModeForHtmlContent', () => {
    it('returns "visual" for empty content', () => {
      expect(defaultModeForHtmlContent('')).toBe('visual');
    });

    it('returns "visual" for content just under the threshold', () => {
      const content = 'a'.repeat(LARGE_HTML_THRESHOLD);
      expect(defaultModeForHtmlContent(content)).toBe('visual');
    });

    it('returns "visual" for typical small HTML pages', () => {
      const content = '<!DOCTYPE html><html><body><p>hi</p></body></html>';
      expect(defaultModeForHtmlContent(content)).toBe('visual');
    });

    it('returns "source" for content one char over the threshold', () => {
      const content = 'a'.repeat(LARGE_HTML_THRESHOLD + 1);
      expect(defaultModeForHtmlContent(content)).toBe('source');
    });

    it('returns "source" for a 26 MB report-sized payload', () => {
      // The known-bad report on disk is ~26 MB. Simulate with a 26 MB string.
      const content = 'x'.repeat(26 * 1024 * 1024);
      expect(defaultModeForHtmlContent(content)).toBe('source');
    });
  });

  describe('isLargeHtmlContent', () => {
    it('returns false for small content', () => {
      expect(isLargeHtmlContent('<html></html>')).toBe(false);
    });

    it('returns false at exactly the threshold (strict greater-than)', () => {
      expect(isLargeHtmlContent('a'.repeat(LARGE_HTML_THRESHOLD))).toBe(false);
    });

    it('returns true above the threshold', () => {
      expect(isLargeHtmlContent('a'.repeat(LARGE_HTML_THRESHOLD + 1))).toBe(true);
    });
  });

  describe('formatHtmlSizeKb', () => {
    it('returns 1 for empty content (never shows 0 KB)', () => {
      expect(formatHtmlSizeKb('')).toBe(1);
    });

    it('rounds to the nearest KB', () => {
      // 2048 chars → 2 KB
      expect(formatHtmlSizeKb('a'.repeat(2048))).toBe(2);
      // 2049 chars → rounds to 2 KB
      expect(formatHtmlSizeKb('a'.repeat(2049))).toBe(2);
      // 3072 chars → 3 KB
      expect(formatHtmlSizeKb('a'.repeat(3072))).toBe(3);
    });

    it('reports ~26 MB for the known-bad report size', () => {
      const content = 'x'.repeat(26 * 1024 * 1024);
      expect(formatHtmlSizeKb(content)).toBe(26 * 1024);
    });
  });
});
