// @vitest-environment jsdom
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

  it('#7 <pre><code> round-trips without duplicating content', () => {
    editor = bootEditor();
    const parsed = parseHtmlForGrapes(`<!DOCTYPE html>
<html><body>
<pre><code>line1
line2
line3</code></pre>
</body></html>`);
    editor.setComponents(parsed.bodyContent);
    editor.setStyle(parsed.styleBlocks.join('\n'));
    const html = editor.getHtml() ?? '';
    // <pre> tag appears exactly once (open + close = 2 occurrences of the substring)
    const preOpenCount = (html.match(/<pre\b/gi) || []).length;
    const preCloseCount = (html.match(/<\/pre>/gi) || []).length;
    expect(preOpenCount).toBe(1);
    expect(preCloseCount).toBe(1);
    // Content lines appear exactly once each
    expect(html.match(/line1/g)?.length).toBe(1);
    expect(html.match(/line2/g)?.length).toBe(1);
    expect(html.match(/line3/g)?.length).toBe(1);
  });

  it('#8 <pre> with nested <span> round-trips without duplication', () => {
    editor = bootEditor();
    const parsed = parseHtmlForGrapes(`<!DOCTYPE html>
<html><body>
<pre><code>before <span class="hl">middle</span> after</code></pre>
</body></html>`);
    editor.setComponents(parsed.bodyContent);
    editor.setStyle(parsed.styleBlocks.join('\n'));
    const html = editor.getHtml() ?? '';
    expect((html.match(/<pre\b/gi) || []).length).toBe(1);
    expect((html.match(/<\/pre>/gi) || []).length).toBe(1);
    expect(html.match(/before/g)?.length).toBe(1);
    expect(html.match(/middle/g)?.length).toBe(1);
    expect(html.match(/after/g)?.length).toBe(1);
  });

  it('#9 empty <pre></pre> survives round-trip', () => {
    editor = bootEditor();
    const parsed = parseHtmlForGrapes(`<!DOCTYPE html>
<html><body><pre></pre></body></html>`);
    editor.setComponents(parsed.bodyContent);
    editor.setStyle(parsed.styleBlocks.join('\n'));
    const html = editor.getHtml() ?? '';
    expect((html.match(/<pre\b/gi) || []).length).toBe(1);
    expect((html.match(/<\/pre>/gi) || []).length).toBe(1);
  });

  it('#10 SVG <defs><style> classes survive round-trip via styleBlocks', () => {
    editor = bootEditor();
    const parsed = parseHtmlForGrapes(`<!DOCTYPE html>
<html><body>
<svg viewBox="0 0 10 10"><defs><style>.hook{fill:#eff6ff;stroke:#2563eb}</style></defs>
<rect class="hook" x="0" y="0" width="10" height="10"/></svg>
</body></html>`);
    editor.setComponents(parsed.bodyContent);
    editor.setStyle(parsed.styleBlocks.join('\n'));
    const html = editor.getHtml() ?? '';
    const css = editor.getCss() ?? '';
    // The <rect class="hook"> survives in body
    expect(html).toContain('<rect');
    expect(html).toContain('class="hook"');
    // The .hook rule survived in CSS (via editor.setStyle → CssComposer)
    expect(css).toContain('.hook');
    expect(css).toContain('#eff6ff');
  });

  it('#11 <div class="card grid"> wrapping <pre><code> + sibling <div> round-trips without duplication', () => {
    editor = bootEditor();
    const parsed = parseHtmlForGrapes(`<!DOCTYPE html>
<html><head><style>.card{border:1px solid #ddd}.grid{display:grid;grid-template-columns:1fr 1fr}</style></head>
<body>
<div class="card grid">
<div><pre><code>line1
line2</code></pre></div>
<div><p>after</p></div>
</div>
</body></html>`);
    editor.setComponents(parsed.bodyContent);
    editor.setStyle(parsed.styleBlocks.join('\n'));
    const html = editor.getHtml() ?? '';
    // <pre> appears exactly once
    expect((html.match(/<pre\b/gi) || []).length).toBe(1);
    expect((html.match(/<\/pre>/gi) || []).length).toBe(1);
    // Content lines not duplicated
    expect(html.match(/line1/g)?.length).toBe(1);
    expect(html.match(/line2/g)?.length).toBe(1);
    expect(html.match(/after/g)?.length).toBe(1);
  });

  it('#12 <pre><code> with curly-brace multi-line content round-trips without duplication', () => {
    editor = bootEditor();
    const parsed = parseHtmlForGrapes(`<!DOCTYPE html>
<html><head><style>.card{padding:10px}.grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}</style></head>
<body>
<h2>4. state.json schema</h2>
<div class="card grid">
<div>
<pre><code>{
  session_id, start_time, stop_time,
  prompt, model,
  metrics: { input_tokens, output_tokens,
             tools_used, turns },
  tools_used: [string],
  events:    [ { type, timestamp, ... } ],
  _claude_pid,
  session_trace_id,
  bash_span_ids: { toolUseId: spanId }
}</code></pre>
</div>
<div>
<p><strong>event.type</strong> 取值：</p>
<ul>
<li><code>user_prompt</code>（UserPromptSubmit 隐式产生首条）</li>
<li><code>tool_use</code> / <code>tool_result</code>（Pre/PostToolUse）</li>
</ul>
</div>
</div>
</body></html>`);
    editor.setComponents(parsed.bodyContent);
    editor.setStyle(parsed.styleBlocks.join('\n'));
    const html = editor.getHtml() ?? '';
    expect((html.match(/<pre\b/gi) || []).length).toBe(1);
    expect((html.match(/<\/pre>/gi) || []).length).toBe(1);
    expect(html.match(/session_id/g)?.length).toBe(1);
    expect(html.match(/bash_span_ids/g)?.length).toBe(1);
    expect(html.match(/user_prompt/g)?.length).toBe(1);
  });

  it('#12b reconstructHtml does NOT double-wrap <body> when grapesHtml already has one', () => {
    // GrapesJS's editor.getHtml() returns "<body>…</body>". reconstructHtml
    // wraps the body content in another <body>…</body>. Without stripping the
    // grapesJS wrapper, the output becomes <body><body>…</body></body>. On
    // re-parse, the inner <body> is hoisted out (bodies can't nest), and its
    // contents get spliced into the outer body — duplicating every element
    // on every round-trip. This is the root cause of the <pre> duplication
    // cascade observed in state-dataflow.html.
    editor = bootEditor();
    const parsed = parseHtmlForGrapes(`<!DOCTYPE html>
<html><head><style>body { color: red; }</style></head>
<body><h1>x</h1></body></html>`);
    editor.setComponents(parsed.bodyContent);
    editor.setStyle(parsed.styleBlocks.join('\n'));
    const rebuilt = reconstructHtml(parsed, editor.getHtml() ?? '', editor.getCss() ?? '');
    expect((rebuilt.match(/<body\b/gi) || []).length).toBe(1);
    expect((rebuilt.match(/<\/body>/gi) || []).length).toBe(1);
  });

  it('#12c two consecutive round-trips are idempotent (no body content growth)', () => {
    // The body-double-wrap bug caused exponential content growth across
    // repeated round-trips. After the fix, body content should be stable.
    // (CSS may still grow slightly — GrapesJS prepends reset rules on each
    // setStyle, which is benign CSS redundancy, not content duplication.)
    editor = bootEditor();
    const source = `<!DOCTYPE html>
<html><head><style>body { color: red; } .card { padding: 10px; }</style></head>
<body class="page">
<h1>Hello</h1>
<div class="card">card</div>
<pre><code>line1
line2</code></pre>
</body></html>`;
    const p1 = parseHtmlForGrapes(source);
    editor.setComponents(p1.bodyContent);
    editor.setStyle(p1.styleBlocks.join('\n'));
    const rebuilt1 = reconstructHtml(p1, editor.getHtml() ?? '', editor.getCss() ?? '');
    const p2 = parseHtmlForGrapes(rebuilt1);
    // Re-run round-trip on the rebuilt output
    editor.setComponents(p2.bodyContent);
    editor.setStyle(p2.styleBlocks.join('\n'));
    const rebuilt2 = reconstructHtml(p2, editor.getHtml() ?? '', editor.getCss() ?? '');
    const p3 = parseHtmlForGrapes(rebuilt2);
    // Body content should be roughly stable across round-trips (allow some
    // whitespace/attribute-order drift). The bug caused 2x+ growth per trip.
    const ratio = p3.bodyContent.length / p2.bodyContent.length;
    expect(ratio).toBeGreaterThan(0.8);
    expect(ratio).toBeLessThan(1.2);
  });
});
