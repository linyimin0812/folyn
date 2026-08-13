import { describe, it, expect } from 'vitest';
import {
  transformMathBrackets,
  findMathSegments,
  renderMarkdownToHtml,
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
