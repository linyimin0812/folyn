import { describe, it, expect, afterEach } from 'vitest';
import grapesjs, { type Editor, type Component } from 'grapesjs';
import blocksBasic from 'grapesjs-blocks-basic';
import {
  parseHtmlForGrapes,
  reconstructHtml,
} from './grapesContentPipeline';

/**
 * End-to-end pipeline test: parse HTML → load into a REAL GrapesJS editor →
 * extract → reconstruct → re-parse → assert structural integrity. No mocks.
 *
 * GrapesJS boots cleanly in jsdom (canvas iframe is only partially functional
 * but the model API — setComponents / setStyle / getHtml / getCss / Components
 * / Blocks — is fully usable, which is all these tests exercise).
 *
 * GrapesJS behavior notes baked into assertions below:
 *  - `editor.getHtml()` wraps body content in `<body>…</body>`.
 *  - `editor.getCss()` prepends its own reset rules (`* { box-sizing }`,
 *    `body { margin: 0 }`) and PRUNES selectors that no component references.
 *    So the fixture body must include an element carrying `.card` for that
 *    CSS rule to survive in `getCss()`.
 */

const FIXTURE = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Fixture</title>
  <style>body { color: red; } .card { padding: 10px; }</style>
</head>
<body class="page">
  <h1>Hello</h1>
  <p>World</p>
  <div class="card">card</div>
  <script>console.log('hidden');</script>
</body>
</html>`;

/** Normalize HTML for structural comparison: collapse whitespace, sort attrs not needed. */
function normalize(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

describe('grapesJS integration round-trip', () => {
  let editor: Editor | null = null;

  afterEach(() => {
    if (editor) {
      try {
        editor.destroy();
      } catch {
        /* jsdom destroy may warn — non-fatal */
      }
    }
    editor = null;
  });

  function bootEditor(): Editor {
    const container = document.createElement('div');
    document.body.appendChild(container);
    return grapesjs.init({
      container,
      storageManager: false,
      panels: { defaults: [] },
      plugins: [blocksBasic],
      // Cast: plugin-opts key types only accept string keys; same workaround
      // as grapesConfig.ts.
      pluginsOpts: { [blocksBasic as unknown as string]: { flexGrid: true } },
    });
  }

  it('#1 parse → setComponents/setStyle → getHtml contains the body markup', () => {
    editor = bootEditor();
    const parsed = parseHtmlForGrapes(FIXTURE);

    editor.setComponents(parsed.bodyContent);
    editor.setStyle(parsed.styleBlocks.join('\n'));

    const html = editor.getHtml();
    expect(html).toContain('<h1>Hello</h1>');
    expect(html).toContain('<p>World</p>');
  });

  it('#2 editor.getCss() contains color:red and .card { padding: 10px; }', () => {
    editor = bootEditor();
    const parsed = parseHtmlForGrapes(FIXTURE);

    editor.setComponents(parsed.bodyContent);
    editor.setStyle(parsed.styleBlocks.join('\n'));

    // GrapesJS types declare getCss() as `string | undefined`; coerce to string.
    const css = editor.getCss() ?? '';
    // body { color: red } survives (the body element is present)
    expect(normalize(css)).toContain('color:red');
    // .card { padding: 10px } survives because the fixture body has a .card div
    expect(normalize(css)).toContain('.card');
    expect(normalize(css)).toContain('padding:10px');
  });

  it('#3 editor.getHtml() does NOT contain <script (script safety — GrapesJS never sees scripts)', () => {
    editor = bootEditor();
    const parsed = parseHtmlForGrapes(FIXTURE);

    editor.setComponents(parsed.bodyContent);
    editor.setStyle(parsed.styleBlocks.join('\n'));

    const html = editor.getHtml() ?? '';
    expect(html.toLowerCase()).not.toContain('<script');
  });

  it('#4 full round-trip: reconstruct → re-parse yields same bodyContent structure', () => {
    editor = bootEditor();
    const p1 = parseHtmlForGrapes(FIXTURE);

    editor.setComponents(p1.bodyContent);
    editor.setStyle(p1.styleBlocks.join('\n'));

    const html = editor.getHtml() ?? '';
    const css = editor.getCss() ?? '';
    const rebuilt = reconstructHtml(p1, html, css);
    const p2 = parseHtmlForGrapes(rebuilt);

    // Body still contains the same structural tags (normalized compare)
    expect(normalize(p2.bodyContent)).toContain(normalize('<h1>Hello</h1>'));
    expect(normalize(p2.bodyContent)).toContain(normalize('<p>World</p>'));
    expect(normalize(p2.bodyContent)).toContain('class="card"');
  });

  it('#5 after round-trip, scriptBlocks still contains the console.log("hidden") script', () => {
    editor = bootEditor();
    const p1 = parseHtmlForGrapes(FIXTURE);

    editor.setComponents(p1.bodyContent);
    editor.setStyle(p1.styleBlocks.join('\n'));

    const rebuilt = reconstructHtml(p1, editor.getHtml() ?? '', editor.getCss() ?? '');
    const p2 = parseHtmlForGrapes(rebuilt);

    // The original script must have been preserved through reconstruct
    const hiddenScript = p2.scriptBlocks.find((s) =>
      s.includes("console.log('hidden')"),
    );
    expect(hiddenScript).toBeDefined();
  });

  it('#6 modifying a component reflects in subsequent editor.getHtml()', () => {
    editor = bootEditor();
    const parsed = parseHtmlForGrapes(FIXTURE);

    editor.setComponents(parsed.bodyContent);
    editor.setStyle(parsed.styleBlocks.join('\n'));

    // Find the h1 component (GrapesJS stores "Hello" as a textnode child of
    // the <h1>, so `h1.set('content', ...)` is a no-op — the proper mutation
    // is `h1.components('Modified')` which replaces its children).
    const components = editor.Components.getComponents();
    expect(components.length).toBeGreaterThan(0);

    let h1: Component | undefined;
    components.forEach((c: Component) => {
      if (c.get('tagName') === 'h1') h1 = c;
    });
    expect(h1).toBeDefined();

    // Replace h1's children with a new text node carrying "Modified".
    h1!.components('Modified');

    const html = editor.getHtml();
    expect(html).toContain('<h1>Modified</h1>');
    // Original text no longer present in the h1
    expect(html).not.toContain('<h1>Hello</h1>');
  });
});
