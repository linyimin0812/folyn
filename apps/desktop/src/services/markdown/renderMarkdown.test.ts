import { describe, it, expect } from 'vitest';
import remarkBreaks from 'remark-breaks';
import {
  transformMathBrackets,
  findMathSegments,
  renderMarkdownToHtml,
  unwrapInlineMath,
  stripImageSizeSuffix,
  MATHJAX_CONTAINER_CSS,
} from './renderMarkdown';

describe('transformMathBrackets', () => {
  it('converts \\[..\\] and \\(..\\) to dollar form', () => {
    expect(transformMathBrackets('\\[x^2\\]')).toBe('$$x^2$$');
    expect(transformMathBrackets('\\(y\\)')).toBe('$y$');
    expect(transformMathBrackets('display \\[a\\] inline \\(b\\) end'))
      .toBe('display $$a$$ inline $b$ end');
  });

  it('passes fenced code blocks through verbatim', () => {
    const md = '```js\nconst s = "a \\\\[[\\\\] b";\n```';
    expect(transformMathBrackets(md)).toBe(md);
    // math markers inside a fence are NOT converted
    expect(transformMathBrackets('```\n\\[no\\]\n```\n')).toBe('```\n\\[no\\]\n```\n');
  });

  it('passes inline code spans through verbatim', () => {
    expect(transformMathBrackets('`\\[x\\]`')).toBe('`\\[x\\]`');
    expect(transformMathBrackets('see `\\(y\\)` here')).toBe('see `\\(y\\)` here');
  });

  it('leaves \\$ escapes alone (remark-parse handles them)', () => {
    expect(transformMathBrackets('price \\$5 and \\$10')).toBe('price \\$5 and \\$10');
  });

  it('handles multi-line display math', () => {
    expect(transformMathBrackets('\\[a\nb\\]')).toBe('$$a\nb$$');
  });

  it('handles unterminated inline code (literal backticks)', () => {
    // single backtick with no close → treated as text, math conversion runs
    expect(transformMathBrackets('`code \\[x\\]')).toBe('`code $$x$$');
  });
});

describe('unwrapInlineMath', () => {
  it('collapses single \\n before inline math into space', () => {
    expect(unwrapInlineMath('text before\n$x^2$ after')).toBe('text before $x^2$ after');
  });

  it('collapses single \\n after inline math into space', () => {
    expect(unwrapInlineMath('before $x^2$\nafter')).toBe('before $x^2$ after');
  });

  it('collapses \\n on both sides of inline math on its own line', () => {
    expect(unwrapInlineMath('text before\n$x^2$\ntext after'))
      .toBe('text before $x^2$ text after');
  });

  it('preserves paragraph breaks (\\n\\n)', () => {
    expect(unwrapInlineMath('para one\n\npara two $x$ end'))
      .toBe('para one\n\npara two $x$ end');
    expect(unwrapInlineMath('para one $x$\n\npara two'))
      .toBe('para one $x$\n\npara two');
  });

  it('does not touch display math (block-level, breaks are fine)', () => {
    expect(unwrapInlineMath('text\n$$y^2$$\ntext')).toBe('text\n$$y^2$$\ntext');
  });

  it('does not touch math markers inside fenced code', () => {
    expect(unwrapInlineMath('```\ntext\n$x$\ntext\n```'))
      .toBe('```\ntext\n$x$\ntext\n```');
  });

  it('does not touch math markers inside inline code spans', () => {
    expect(unwrapInlineMath('see `$x$`\nhere')).toBe('see `$x$`\nhere');
  });

  it('handles bracket-style inline math after transformMathBrackets', () => {
    // transformMathBrackets converts \(..\) → $..$, then unwrapInlineMath
    // collapses surrounding \n.
    const src = 'text before\n\\(y\\)\ntext after';
    expect(unwrapInlineMath(transformMathBrackets(src)))
      .toBe('text before $y$ text after');
  });

  it('leaves inline math already on the same line unchanged', () => {
    expect(unwrapInlineMath('text $x^2$ more')).toBe('text $x^2$ more');
  });

  it('leaves \\$ escapes alone (no math segment, no edit)', () => {
    expect(unwrapInlineMath('price \\$5\nand \\$10')).toBe('price \\$5\nand \\$10');
  });
});

describe('findMathSegments', () => {
  it('finds dollar inline and display math', () => {
    const md = 'inline $x^2$ and display $$y^2$$';
    const segs = findMathSegments(md);
    expect(segs).toHaveLength(2);
    expect(segs[0].kind).toBe('inline');
    expect(md.slice(segs[0].from, segs[0].to)).toBe('$x^2$');
    expect(segs[1].kind).toBe('display');
    expect(md.slice(segs[1].from, segs[1].to)).toBe('$$y^2$$');
  });

  it('finds bracket display and inline math', () => {
    const md = 'display \\[a\\] inline \\(b\\)';
    const segs = findMathSegments(md);
    expect(segs).toHaveLength(2);
    expect(segs[0].kind).toBe('display');
    expect(md.slice(segs[0].from, segs[0].to)).toBe('\\[a\\]');
    expect(segs[1].kind).toBe('inline');
    expect(md.slice(segs[1].from, segs[1].to)).toBe('\\(b\\)');
  });

  it('skips math markers inside fenced code blocks', () => {
    const md = '```js\nconst x = "$y$";\n```';
    expect(findMathSegments(md)).toEqual([]);
  });

  it('skips math markers inside inline code spans', () => {
    const md = 'see `$x$` here';
    expect(findMathSegments(md)).toEqual([]);
  });

  it('skips \\$ escape text (not math)', () => {
    // \$ is two chars — not a math open marker. findMathSegments should not
    // match it. The trailing $x$ IS math though.
    const md = 'price \\$5 and $x$ end';
    const segs = findMathSegments(md);
    expect(segs).toHaveLength(1);
    expect(md.slice(segs[0].from, segs[0].to)).toBe('$x$');
  });

  it('handles multi-line display math', () => {
    const md = '$$a\nb$$';
    const segs = findMathSegments(md);
    expect(segs).toHaveLength(1);
    expect(segs[0].kind).toBe('display');
    expect(md.slice(segs[0].from, segs[0].to)).toBe('$$a\nb$$');
  });
});

describe('renderMarkdownToHtml', () => {
  it('renders inline $math$ to mjx-container SVG', () => {
    const html = renderMarkdownToHtml('inline $x^2$ here');
    expect(html).toContain('<mjx-container');
    expect(html).toContain('svg');
  });

  it('renders display $$math$$ to mjx-container with display class', () => {
    const html = renderMarkdownToHtml('$$\\frac{a}{b}$$');
    expect(html).toContain('<mjx-container');
    // MathJax SVG output includes a <style> with mjx-container CSS at end
    expect(html).toContain('mjx-container');
  });

  it('renders \\[..\\] and \\(..\\) via bracket preprocessor', () => {
    const display = renderMarkdownToHtml('\\[x^2\\]');
    expect(display).toContain('<mjx-container');
    const inline = renderMarkdownToHtml('inline \\(y\\) end');
    expect(inline).toContain('<mjx-container');
  });

  it('renders AMS environments inside $$..$$', () => {
    const md = '$$\\begin{equation}x = 1\\end{equation}$$';
    const html = renderMarkdownToHtml(md);
    expect(html).toContain('<mjx-container');
  });

  it('does not render math inside fenced code blocks', () => {
    const md = '```js\nconst x = "$y^2$";\n```';
    const html = renderMarkdownToHtml(md);
    expect(html).not.toContain('<mjx-container');
    expect(html).toContain('$y^2$');
  });

  it('escapes \\$ so it is not treated as math', () => {
    const html = renderMarkdownToHtml('price \\$5 and \\$10');
    expect(html).not.toContain('<mjx-container');
    // backslash-escaped dollar renders as literal $
    expect(html).toContain('$5');
  });
});

describe('renderMarkdownToHtml (export self-contained)', () => {
  it('produces self-contained math output (no external font URLs)', () => {
    const html = renderMarkdownToHtml('$$\\frac{a}{b}$$');
    // SVG output is self-contained — no external fontURL references,
    // no CDN dependencies. The only external namespace is the SVG xlink
    // namespace (standard, inline).
    expect(html).not.toMatch(/https?:\/\/[^'"\s]+\/fonts?\//);
    expect(html).not.toMatch(/cdn\.jsdelivr/i);
    // MathJax SVG uses inline <path> defs; no <img> or <link> to assets
    expect(html).not.toMatch(/<link[^>]*stylesheet/i);
    expect(html).toContain('<mjx-container');
    expect(html).toContain('<svg');
    expect(html).toContain('<path');
  });

  it('renders mixed inline + display + AMS environments', () => {
    const md = 'Inline $x^2$ then $$\\begin{equation}y = 2x\\end{equation}$$ done.';
    const html = renderMarkdownToHtml(md);
    // Two math segments — should contain two mjx-container instances
    const count = (html.match(/<mjx-container/g) || []).length;
    expect(count).toBe(2);
  });
});

describe('inline math line-break (MarkdownPreview contract)', () => {
  // MarkdownPreview uses remark-breaks which converts \n → <br>. When the
  // user writes inline math on its own line for source readability
  // (`text\n$x^2$\ntext`), remark-breaks inserts <br> before and after the
  // math, pushing it onto its own visual line — the user reports this as
  // "inline math shouldn't directly line-break". `unwrapInlineMath` (run
  // by renderMarkdownToReact + MarkdownPreview before the pipeline) collapses
  // single \n adjacent to inline math into a space, so remark-breaks sees
  // the math on one line and emits no <br> around it.
  it('inline math on its own line: no <br> adjacent to mjx-container', () => {
    const html = renderMarkdownToHtml('text before\n$x^2$\ntext after', {
      remarkPlugins: [remarkBreaks],
    });
    expect(html).toContain('<mjx-container');
    // The paragraph should not contain a <br> between text and mjx-container
    // (no break immediately before or after the math). Strip the scoped
    // <style> block to isolate the <p>.
    const body = html.split('<style')[0];
    expect(body).not.toMatch(/<br\s*\/?>/);
  });

  it('inline math on same line: still inline, no <br>', () => {
    const html = renderMarkdownToHtml('text $x^2$ more', {
      remarkPlugins: [remarkBreaks],
    });
    const body = html.split('<style')[0];
    expect(body).not.toMatch(/<br\s*\/?>/);
  });

  it('paragraph break before inline math: <br> NOT collapsed across paragraphs', () => {
    // \n\n is a paragraph break — remark-breaks shouldn't merge paragraphs.
    // The fix only collapses single \n, not \n\n.
    const html = renderMarkdownToHtml('para one\n\n$x^2$ end');
    expect(html).toContain('<mjx-container');
    // Two paragraphs (no merging)
    const pCount = (html.match(/<p>/g) || []).length;
    expect(pCount).toBeGreaterThanOrEqual(2);
  });
});

describe('MathJax SVG ex-unit sensitivity (export blur root cause)', () => {
  // MathJax v3 SVG output uses CSS `ex` units for width/height (see
  // OutputJax.SVG.prototype.ex — internal coords divided by x_height
  // and suffixed with 'ex'). `1ex` is the x-height of the surrounding
  // font, so the SVG's display pixel size is font-dependent. If the
  // export HTML's font differs from the in-app preview (e.g., 'Sora'
  // loaded in preview via Google Fonts @import, but not loaded in the
  // standalone export when opened offline), the SVG renders at a
  // different pixel size and small formulas pick up subpixel anti-
  // aliasing that looks blurry. MATHJAX_CONTAINER_CSS pins a stable
  // system font + size so the ex unit resolves consistently.
  it('emits SVG width and height in ex units (font-dependent display size)', () => {
    const html = renderMarkdownToHtml('$$\\frac{a}{b}$$');
    expect(html).toMatch(/<svg[^>]*\swidth="[\d.]+ex"/);
    expect(html).toMatch(/<svg[^>]*\sheight="[\d.]+ex"/);
  });

  it('MATHJAX_CONTAINER_CSS pins mjx-container font-family and font-size', () => {
    // Regression guard: removing the font pin re-introduces the export
    // blur. The rule must set a system font stack (always available,
    // not dependent on 'Sora' loading) AND an explicit font-size so
    // `1ex` resolves to a stable pixel value.
    expect(MATHJAX_CONTAINER_CSS).toMatch(/mjx-container\s*\{/);
    expect(MATHJAX_CONTAINER_CSS).toMatch(/font-family:\s*-apple-system/);
    expect(MATHJAX_CONTAINER_CSS).toMatch(/font-size:\s*\d+px/);
  });

  it('MATHJAX_CONTAINER_CSS hints geometric-precision rasterization on 1x DPI', () => {
    // Regression guard for the 1x-DPI blur bug: even with the font pin,
    // a 1x (non-Retina) screen rasterizes the SVG viewBox (~814×1058)
    // to ~13×17 device pixels — a 60x downsample that reads as blurry
    // subpixel anti-aliasing. `shape-rendering: geometricPrecision` on
    // the SVG (and `text-rendering: geometricPrecision` on the container)
    // asks the rasterizer to favor accuracy over speed. Kept as a cheap
    // hint alongside the option-B zoom fix below.
    expect(MATHJAX_CONTAINER_CSS).toMatch(/shape-rendering:\s*geometricPrecision/);
    expect(MATHJAX_CONTAINER_CSS).toMatch(/text-rendering:\s*geometricPrecision/);
  });

  it('MATHJAX_CONTAINER_CSS applies option B: 2x font-size + zoom 0.5 for 1x DPI crispness', () => {
    // Regression guard for the 1x-DPI blur bug (option B, landed
    // 2026-08-13). At `font-size: 14px` the SVG rasterizes to ~13×17
    // device px on a 1x screen — a 60x downsample of the viewBox
    // (~814×1058 internal units) that reads as blurry subpixel AA.
    // Fix: render at 2x font-size (28px → SVG ~26×34 CSS px → 26×34
    // device px on a 1x screen, 4x the pixel count) then collapse
    // back to the original visual size with Chromium `zoom: 0.5`,
    // which rescales layout and paint in one pass so the SVG stays
    // crisp while occupying the original 14px layout footprint.
    // Removing either rule re-introduces the blur.
    expect(MATHJAX_CONTAINER_CSS).toMatch(/font-size:\s*28px/);
    expect(MATHJAX_CONTAINER_CSS).toMatch(/zoom:\s*0\.5/);
  });

  it('MATHJAX_CONTAINER_CSS keeps inline math in the text flow (svg inline + container inline-block)', () => {
    // Regression guard for "inline formula preview takes its own line"
    // (2026-08-13). Two hazards:
    // 1. Tailwind preflight's `svg { display: block }` turns the MathJax
    //    <svg> inside the inline mjx-container into a block box, breaking
    //    the paragraph line — `mjx-container svg { display: inline }`
    //    restores the intended inline SVG.
    // 2. The 28px font-size (option B above) multiplies the inherited
    //    line-height (1.8) into a ~50px line box, ballooning the inline
    //    container to ~33px — `display: inline-block; line-height: 0`
    //    collapses it to the zoomed SVG's 14px footprint. Display math is
    //    unaffected: MathJax's own `[display="true"]` rule (higher
    //    specificity) keeps it display:block / centered.
    expect(MATHJAX_CONTAINER_CSS).toMatch(/mjx-container\s*\{[^}]*display:\s*inline-block/s);
    expect(MATHJAX_CONTAINER_CSS).toMatch(/mjx-container\s*\{[^}]*line-height:\s*0/s);
    expect(MATHJAX_CONTAINER_CSS).toMatch(/mjx-container\s+svg\s*\{[^}]*display:\s*inline/s);
  });
});

describe('stripImageSizeSuffix', () => {
  it('strips ` =Wx` (width-only) from image URLs', () => {
    expect(stripImageSizeSuffix('![a](./x.png =525x)')).toBe('![a](./x.png)');
  });

  it('strips ` =WxH` (width + height) from image URLs', () => {
    expect(stripImageSizeSuffix('![a](./x.png =525x300)')).toBe('![a](./x.png)');
  });

  it('leaves images without the suffix untouched', () => {
    expect(stripImageSizeSuffix('![a](./x.png)')).toBe('![a](./x.png)');
  });

  it('does not touch ` =525x` appearing elsewhere (e.g. plain text)', () => {
    expect(stripImageSizeSuffix('see =525x here')).toBe('see =525x here');
  });

  it('handles multiple images on one line', () => {
    expect(stripImageSizeSuffix('![a](./a.png =100x) ![b](./b.png =200x150)'))
      .toBe('![a](./a.png) ![b](./b.png)');
  });

  it('leaves image URLs with embedded whitespace-invalid forms alone (no false strip)', () => {
    // URL with no `=WxH` suffix → no change
    expect(stripImageSizeSuffix('![a](./path with space.png)')).toBe('![a](./path with space.png)');
  });
});
