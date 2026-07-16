// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { injectPreviewBootstrap } from './injectPreviewBootstrap';

/**
 * Tests for the sandbox bootstrap injector — a pure string→string function.
 *
 * What we verify:
 *   - light-theme `<style>` and anchor-nav `<script>` are present in output.
 *   - full-doc input keeps its head/body structure and doctype.
 *   - fragment input (no head/body) is normalized to a valid document.
 *   - existing user `<style>`/`<script>` is preserved (we only ADD, never strip).
 *   - the bootstrap script text matches the in-document anchor behavior spec.
 *
 * We do NOT verify cross-origin parent access here — jsdom does not enforce
 * iframe `sandbox` origin isolation. That ceiling is covered by a string-level
 * assertion on the `sandbox` attribute in `HtmlPreview.test.tsx`.
 */

function parse(html: string): Document {
  return new DOMParser().parseFromString(html, 'text/html');
}

describe('injectPreviewBootstrap', () => {
  it('#1 injects light-theme style and anchor script into a full document', () => {
    const src = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>T</title></head><body><p>hi</p></body></html>`;
    const out = injectPreviewBootstrap(src);

    const doc = parse(out);
    const style = doc.querySelector('style[data-quill-preview="light"]');
    expect(style).not.toBeNull();
    expect(style?.textContent).toContain('color-scheme:light');
    expect(style?.textContent).toContain('background:#fff');

    const script = doc.querySelector('script[data-quill-preview="anchors"]');
    expect(script).not.toBeNull();
    expect(script?.textContent).toContain("ev.preventDefault()");
    expect(script?.textContent).toContain("scrollIntoView");
  });

  it('#2 preserves doctype and original content', () => {
    const src = `<!DOCTYPE html><html lang="en"><head><title>My Doc</title></head><body><h1 id="top">Top</h1><a href="#top">go</a></body></html>`;
    const out = injectPreviewBootstrap(src);

    expect(out.startsWith('<!DOCTYPE html>')).toBe(true);
    const doc = parse(out);
    expect(doc.querySelector('h1#top')?.textContent).toBe('Top');
    expect(doc.querySelector('a[href="#top"]')).not.toBeNull();
    expect(doc.querySelector('title')?.textContent).toBe('My Doc');
    expect(doc.documentElement.getAttribute('lang')).toBe('en');
  });

  it('#3 normalizes a fragment (no head/body) into a valid document with bootstrap', () => {
    const src = `<p>just a fragment</p><a href="#x">x</a>`;
    const out = injectPreviewBootstrap(src);

    expect(out.startsWith('<!DOCTYPE html>')).toBe(true);
    const doc = parse(out);
    expect(doc.querySelector('p')?.textContent).toContain('just a fragment');
    expect(doc.querySelector('style[data-quill-preview="light"]')).not.toBeNull();
    expect(doc.querySelector('script[data-quill-preview="anchors"]')).not.toBeNull();
    // DOMParser guarantees head/body exist for text/html.
    expect(doc.head).not.toBeNull();
    expect(doc.body).not.toBeNull();
  });

  it('#4 does not strip existing user <style> or <script> blocks', () => {
    const src = `<!DOCTYPE html><html><head><style>body{color:red}</style></head><body><script>console.log(1)</script></body></html>`;
    const out = injectPreviewBootstrap(src);

    const doc = parse(out);
    const userStyle = Array.from(doc.querySelectorAll('style')).find((s) => !s.hasAttribute('data-quill-preview'));
    expect(userStyle?.textContent).toContain('color:red');
    const userScript = Array.from(doc.querySelectorAll('script')).find((s) => !s.hasAttribute('data-quill-preview'));
    expect(userScript?.textContent).toContain('console.log(1)');
  });

  it('#5 anchor script implements #hash in-document scroll and non-# dead-link (string contract)', () => {
    const out = injectPreviewBootstrap('<!DOCTYPE html><html><head></head><body></body></html>');
    const script = parse(out).querySelector('script[data-quill-preview="anchors"]')?.textContent ?? '';
    // #hash path: querySelector(href) || [name=...] → scrollIntoView
    expect(script).toContain("href.charAt(0) === '#'");
    expect(script).toContain("document.querySelector(href)");
    expect(script).toContain("scrollIntoView");
    // non-# href: preventDefault with no navigation action (dead link).
    expect(script).toContain("ev.preventDefault()");
    expect(script).not.toMatch(/window\.open/);
    expect(script).not.toMatch(/location\.href/);
  });

  it('#6 handles empty/whitespace input by emitting a valid sandboxed document', () => {
    const out = injectPreviewBootstrap('   ');
    expect(out.startsWith('<!DOCTYPE html>')).toBe(true);
    const doc = parse(out);
    expect(doc.querySelector('style[data-quill-preview="light"]')).not.toBeNull();
    expect(doc.querySelector('script[data-quill-preview="anchors"]')).not.toBeNull();
  });

  it('#7 output is a single valid HTML document (no duplicate <html>)', () => {
    const out = injectPreviewBootstrap('<!DOCTYPE html><html><body><p>x</p></body></html>');
    expect((out.match(/<html/gi) || []).length).toBe(1);
    expect((out.match(/<\/body>/gi) || []).length).toBe(1);
  });
});
