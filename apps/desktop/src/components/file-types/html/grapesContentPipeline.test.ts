// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import {
  parseHtmlForGrapes,
  reconstructHtml,
  type ParsedHtml,
} from './grapesContentPipeline';

/**
 * Tests for the GrapesJS HTML parsing / reconstruction pipeline.
 *
 * These tests target the pure functions in `grapesContentPipeline.ts` only.
 * React/GrapesJS integration (GrapesEditor, useGrapesEditor, grapesConfig,
 * grapesBlocks) is intentionally out of scope — those modules require
 * jsdom + GrapesJS mocking and are deferred to a later task.
 */

const FULL_DOC = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Test</title>
  <link rel="stylesheet" href="a.css">
  <style>body { color: red; }</style>
  <script>console.log('head')</script>
</head>
<body class="page" data-theme="dark">
  <h1>Hello</h1>
  <p>World &amp; &lt;esc&gt;</p>
  <script>console.log('body')</script>
</body>
</html>`;

describe('parseHtmlForGrapes', () => {
  it('#1 parses a full HTML5 document into structural fragments', () => {
    const p = parseHtmlForGrapes(FULL_DOC);

    expect(p.doctype).toBe('<!DOCTYPE html>');
    expect(p.htmlAttrs).toContain('lang="en"');

    // headContent has meta/title/link, but NOT style or script
    expect(p.headContent).toContain('<meta');
    expect(p.headContent).toContain('<title>');
    expect(p.headContent).toContain('<link');
    expect(p.headContent).not.toContain('<style');
    expect(p.headContent.toLowerCase()).not.toContain('<script');

    // styleBlocks: exactly one entry matching the CSS
    expect(p.styleBlocks).toHaveLength(1);
    expect(p.styleBlocks[0]).toContain('color: red');

    // scriptBlocks: head + body, both non-empty
    expect(p.scriptBlocks).toHaveLength(2);
    expect(p.scriptBlocks[0]).toContain("console.log('head')");
    expect(p.scriptBlocks[1]).toContain("console.log('body')");

    // bodyContent: H1 + P, no script tag
    expect(p.bodyContent).toContain('<h1>Hello</h1>');
    expect(p.bodyContent).toContain('<p>');
    expect(p.bodyContent.toLowerCase()).not.toContain('<script');

    // bodyAttrs reflect body attributes
    expect(p.bodyAttrs).toContain('class="page"');
    expect(p.bodyAttrs).toContain('data-theme="dark"');
  });

  it('#2 missing doctype yields empty doctype string', () => {
    const p = parseHtmlForGrapes('<html><body><p>x</p></body></html>');
    expect(p.doctype).toBe('');
  });

  it('#3 HTML with no <head> still produces an empty headContent and no styleBlocks', () => {
    // DOMParser auto-creates head when missing
    const p = parseHtmlForGrapes('<html><body><p>x</p></body></html>');
    expect(p.headContent).toBe('');
    expect(p.styleBlocks).toEqual([]);
  });

  it('#4 HTML with no <body> yields empty bodyContent', () => {
    const p = parseHtmlForGrapes('<html><head><title>t</title></head></html>');
    expect(p.bodyContent).toBe('');
    expect(p.bodyAttrs).toBe('');
  });

  it('#5 collects multiple <style> blocks in document order', () => {
    const html = `<!DOCTYPE html>
<html><head>
<style>a { color: red; }</style>
<style>b { color: blue; }</style>
</head><body><p>x</p></body></html>`;
    const p = parseHtmlForGrapes(html);
    expect(p.styleBlocks).toHaveLength(2);
    expect(p.styleBlocks[0]).toContain('red');
    expect(p.styleBlocks[1]).toContain('blue');
  });

  it('#6 extracts every <script> scattered across head and body', () => {
    const html = `<!DOCTYPE html>
<html><head>
<script>var a = 1;</script>
</head><body>
<script>var b = 2;</script>
<script>var c = 3;</script>
</body></html>`;
    const p = parseHtmlForGrapes(html);
    expect(p.scriptBlocks).toHaveLength(3);
    expect(p.scriptBlocks[0]).toContain('a = 1');
    expect(p.scriptBlocks[1]).toContain('b = 2');
    expect(p.scriptBlocks[2]).toContain('c = 3');
    // Body innerHTML no longer contains script tags
    expect(p.bodyContent.toLowerCase()).not.toContain('<script');
  });

  it('#7 external <script src="..."> is extracted to scriptBlocks (as empty innerHTML)', () => {
    // Per implementation, scriptBlocks stores innerHTML only; external scripts
    // have empty innerHTML. The script tag IS still removed from bodyContent.
    const html = `<html><body>
<script src="external.js"></script>
<p>after</p>
</body></html>`;
    const p = parseHtmlForGrapes(html);
    // External script was processed (one entry pushed)
    expect(p.scriptBlocks).toHaveLength(1);
    // innerHTML of an external script is empty
    expect(p.scriptBlocks[0]).toBe('');
    // script tag was stripped from body
    expect(p.bodyContent.toLowerCase()).not.toContain('<script');
    expect(p.bodyContent).toContain('<p>after</p>');
  });

  it('#8 inline script body content is captured as a string (never executed)', () => {
    const html = `<html><body><script>console.log('x')</script></body></html>`;
    const p = parseHtmlForGrapes(html);
    expect(p.scriptBlocks).toHaveLength(1);
    expect(p.scriptBlocks[0]).toBe("console.log('x')");
    // The dangerous content lives only in scriptBlocks, not in bodyContent.
    expect(p.bodyContent.toLowerCase()).not.toContain('<script');
    expect(p.bodyContent).not.toContain("console.log");
  });

  it('#9 body attributes are serialized into bodyAttrs', () => {
    const html = `<html><body class="page" data-theme="dark"><p>x</p></body></html>`;
    const p = parseHtmlForGrapes(html);
    expect(p.bodyAttrs).toContain('class="page"');
    expect(p.bodyAttrs).toContain('data-theme="dark"');
  });

  it('#10 HTML entities are preserved in bodyContent', () => {
    const html = `<html><body><p>&amp; &lt;esc&gt;</p></body></html>`;
    const p = parseHtmlForGrapes(html);
    expect(p.bodyContent).toContain('&amp;');
    expect(p.bodyContent).toContain('&lt;esc&gt;');
  });

  it('#11 extracts <style> inside SVG <defs> into styleBlocks (GrapesJS strips them otherwise)', () => {
    const html = `<html><body>
<svg viewBox="0 0 100 100"><defs><style>.hook{fill:#eff6ff;stroke:#2563eb}</style><marker id="m"></marker></defs>
<rect class="hook" x="0" y="0" width="10" height="10"/></svg>
</body></html>`;
    const p = parseHtmlForGrapes(html);
    expect(p.styleBlocks).toHaveLength(1);
    expect(p.styleBlocks[0]).toContain('.hook');
    expect(p.styleBlocks[0]).toContain('#eff6ff');
    // bodyContent no longer contains the SVG <style> — GrapesJS can't drop what it never sees
    expect(p.bodyContent.toLowerCase()).not.toContain('<style');
    // But the <rect class="hook"> survives for GrapesJS to render
    expect(p.bodyContent).toContain('<rect class="hook"');
    // And the <marker> in defs survives
    expect(p.bodyContent).toContain('<marker id="m"');
  });

  it('#12 extracts <style> from multiple SVGs in document order', () => {
    const html = `<html><body>
<svg><defs><style>.a{fill:red}</style></defs><rect class="a"/></svg>
<svg><defs><style>.b{fill:blue}</style></defs><rect class="b"/></svg>
</body></html>`;
    const p = parseHtmlForGrapes(html);
    expect(p.styleBlocks).toHaveLength(2);
    expect(p.styleBlocks[0]).toContain('.a{fill:red}');
    expect(p.styleBlocks[1]).toContain('.b{fill:blue}');
  });

  it('#13 extracts multiple <style> blocks from one SVG <defs>', () => {
    const html = `<html><body>
<svg><defs><style>.a{fill:red}</style><style>.b{fill:blue}</style></defs></svg>
</body></html>`;
    const p = parseHtmlForGrapes(html);
    expect(p.styleBlocks).toHaveLength(2);
    expect(p.styleBlocks[0]).toContain('.a{fill:red}');
    expect(p.styleBlocks[1]).toContain('.b{fill:blue}');
  });

  it('#14 extracts <style> directly inside <svg> (not nested in <defs>)', () => {
    const html = `<html><body>
<svg><style>.x{fill:green}</style><rect class="x"/></svg>
</body></html>`;
    const p = parseHtmlForGrapes(html);
    expect(p.styleBlocks).toHaveLength(1);
    expect(p.styleBlocks[0]).toContain('.x{fill:green}');
    expect(p.bodyContent.toLowerCase()).not.toContain('<style');
  });

  it('#15 leaves SVG without <style> untouched in bodyContent', () => {
    const html = `<html><body>
<svg viewBox="0 0 10 10"><rect fill="#fff" x="0" y="0" width="10" height="10"/></svg>
</body></html>`;
    const p = parseHtmlForGrapes(html);
    expect(p.styleBlocks).toEqual([]);
    expect(p.bodyContent).toContain('<rect fill="#fff"');
  });
});

describe('reconstructHtml', () => {
  it('#11 round-trips a full document (parse -> reconstruct -> parse) structurally', () => {
    const p1 = parseHtmlForGrapes(FULL_DOC);
    const rebuilt = reconstructHtml(p1, p1.bodyContent, p1.styleBlocks.join('\n'));
    const p2 = parseHtmlForGrapes(rebuilt);

    // Doctype, html/body attrs, head content categories, styles, scripts all survive
    expect(p2.doctype).toBe('<!DOCTYPE html>');
    expect(p2.htmlAttrs).toContain('lang="en"');
    expect(p2.bodyAttrs).toContain('class="page"');
    expect(p2.bodyAttrs).toContain('data-theme="dark"');

    // Both style blocks merged into one <style> on reconstruct; re-parsing
    // yields a single style block containing both original CSS rules.
    expect(p2.styleBlocks).toHaveLength(1);
    expect(p2.styleBlocks[0]).toContain('color: red');

    // Both scripts re-attached at end of body, then re-extracted on re-parse
    expect(p2.scriptBlocks).toHaveLength(2);
    expect(p2.scriptBlocks[0]).toContain("console.log('head')");
    expect(p2.scriptBlocks[1]).toContain("console.log('body')");

    // Body content round-trips
    expect(p2.bodyContent).toContain('<h1>Hello</h1>');
    expect(p2.bodyContent).toContain('<p>');
  });

  it('#12 empty grapesHtml and grapesCss produce a doc with empty body and empty style', () => {
    const p = parseHtmlForGrapes('<!DOCTYPE html><html><body><p>x</p></body></html>');
    const out = reconstructHtml(p, '', '');
    expect(out).toContain('<!DOCTYPE html>');
    // Empty CSS: the <style> tag exists but is empty
    expect(out).toContain('<style>');
    expect(out).toContain('</style>');
    // No body content
    expect(out).not.toContain('<p>x</p>');
  });

  it('#13 preserves doctype (defaults to <!DOCTYPE html> when missing)', () => {
    const withDoc = parseHtmlForGrapes('<!DOCTYPE html><html><body></body></html>');
    expect(reconstructHtml(withDoc, '', '')).toContain('<!DOCTYPE html>');

    const noDoc = parseHtmlForGrapes('<html><body></body></html>');
    // Implementation falls back to '<!DOCTYPE html>' when doctype is empty
    expect(reconstructHtml(noDoc, '', '')).toContain('<!DOCTYPE html>');
  });

  it('#14 preserves htmlAttrs and bodyAttrs in the output tags', () => {
    const p = parseHtmlForGrapes(
      '<html lang="en"><body class="page" data-theme="dark"><p>x</p></body></html>',
    );
    const out = reconstructHtml(p, '<p>x</p>', '');
    expect(out).toContain('<html lang="en">');
    expect(out).toContain('<body class="page" data-theme="dark">');
  });

  it('#15 re-appends all scriptBlocks at the end of body', () => {
    const p: ParsedHtml = {
      doctype: '<!DOCTYPE html>',
      htmlAttrs: '',
      headContent: '',
      styleBlocks: [],
      bodyContent: '',
      bodyAttrs: '',
      scriptBlocks: ["console.log('a')", "console.log('b')"],
    };
    const out = reconstructHtml(p, '<div>main</div>', '');
    // Both scripts appear AFTER the body content
    const bodyOpenIdx = out.indexOf('<body');
    const divIdx = out.indexOf('<div>main</div>');
    const scriptAIdx = out.indexOf("<script>console.log('a')</script>");
    const scriptBIdx = out.indexOf("<script>console.log('b')</script>");
    expect(scriptAIdx).toBeGreaterThan(divIdx);
    expect(scriptBIdx).toBeGreaterThan(divIdx);
    expect(scriptAIdx).toBeGreaterThan(bodyOpenIdx);
    expect(scriptBIdx).toBeGreaterThan(scriptAIdx);
  });

  it('#16 combines grapesCss AND @-rule styleBlocks in the output <style> block', () => {
    // Only @-rules (keyframes / font-face / import) are re-appended
    // verbatim — regular rule duplication would compound across saves.
    const atRule = '@keyframes spin { from { transform: rotate(0); } to { transform: rotate(360deg); } }';
    const p: ParsedHtml = {
      doctype: '<!DOCTYPE html>',
      htmlAttrs: '',
      headContent: '',
      styleBlocks: ['.orig { color: blue; }', atRule],
      bodyContent: '',
      bodyAttrs: '',
      scriptBlocks: [],
    };
    const out = reconstructHtml(p, '<div></div>', '.gjs { color: red; }');
    const styleOpen = out.indexOf('<style>');
    const styleClose = out.indexOf('</style>');
    expect(styleOpen).toBeGreaterThan(-1);
    expect(styleClose).toBeGreaterThan(styleOpen);
    const cssBlock = out.slice(styleOpen, styleClose);
    expect(cssBlock).toContain('.gjs { color: red; }');
    expect(cssBlock).toContain('@keyframes spin');
    // Regular rules from styleBlocks are dropped (GrapesJS owns them)
    expect(cssBlock).not.toContain('.orig { color: blue; }');
    // GrapesJS CSS comes first, preserved @-rules appended after
    expect(cssBlock.indexOf('.gjs')).toBeLessThan(cssBlock.indexOf('@keyframes'));
  });
});

describe('edge cases', () => {
  it('#17 empty string input yields all-empty parsed fields and a minimal valid HTML doc', () => {
    const p = parseHtmlForGrapes('');
    expect(p.doctype).toBe('');
    expect(p.htmlAttrs).toBe('');
    expect(p.headContent).toBe('');
    expect(p.styleBlocks).toEqual([]);
    expect(p.bodyContent).toBe('');
    expect(p.bodyAttrs).toBe('');
    expect(p.scriptBlocks).toEqual([]);

    const out = reconstructHtml(p, '', '');
    expect(out).toContain('<!DOCTYPE html>');
    expect(out).toContain('<html>');
    expect(out).toContain('<head>');
    expect(out).toContain('<style>');
    expect(out).toContain('<body>');
    expect(out).toContain('</html>');
  });

  it('#18 plain text (no HTML tags) is wrapped into body by DOMParser', () => {
    const p = parseHtmlForGrapes('hello world');
    // DOMParser produces an html/body wrapper; bodyContent contains the text
    expect(p.bodyContent).toContain('hello world');
  });

  it('#19 malformed HTML (unclosed tags) does not throw and yields a string', () => {
    const malformed = '<html><body><p>unclosed <span> also unclosed';
    let parsed: ParsedHtml;
    let out: string;
    expect(() => {
      parsed = parseHtmlForGrapes(malformed);
      out = reconstructHtml(parsed, parsed.bodyContent, '');
    }).not.toThrow();
    expect(parsed!).toBeDefined();
    expect(typeof out!).toBe('string');
  });
});

describe('script safety invariant (critical, prd §6.1)', () => {
  it('#20 after parse, bodyContent MUST NOT contain the substring "<script" (case-insensitive)', () => {
    const cases = [
      FULL_DOC,
      '<html><body><script>alert(1)</script><p>x</p></body></html>',
      '<html><head><script>alert(1)</script></head><body><p>x</p><script>alert(2)</script></body></html>',
      '<html><body><div><script>alert(1)</script></div><script>alert(2)</script></body></html>',
      '<html><body><SCRIPT>alert(1)</SCRIPT></body></html>',
    ];
    for (const html of cases) {
      const p = parseHtmlForGrapes(html);
      expect(p.bodyContent.toLowerCase()).not.toContain('<script');
    }
  });

  it('#21 after reconstruct, scripts are re-attached and present in the final output', () => {
    const p = parseHtmlForGrapes(
      '<html><body><p>x</p><script>console.log("kept")</script></body></html>',
    );
    const out = reconstructHtml(p, p.bodyContent, '');
    // The script content round-trips into the saved document
    expect(out).toContain('<script>');
    expect(out).toContain('console.log("kept")');
  });
});
