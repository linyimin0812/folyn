import { describe, expect, it } from 'vitest';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkBreaks from 'remark-breaks';
import remarkRehype from 'remark-rehype';
import rehypeRaw from 'rehype-raw';
import { rehypeBlankGap } from './rehypeBlankGap';
import { rehypeShowRawTags } from './rehypeShowRawTags';

// Build a hast tree the way MarkdownPreview does (remark-breaks so single
// newlines stay in one paragraph; rehypeBlankGap inserts blank-line gaps).
function hastOf(md: string, offset = 0) {
  return unified()
    .use(remarkParse)
    .use(remarkBreaks)
    .use(remarkRehype)
    .use(rehypeBlankGap, { offset })
    .runSync(unified().use(remarkParse).use(remarkBreaks).parse(md)) as any;
}

function topChildren(tree: any): any[] {
  return Array.isArray(tree.children) ? tree.children : [];
}

// Raw-HTML pipeline the way MarkdownPreview orders it (rehypeRaw →
// rehypeShowRawTags → rehypeBlankGap) — exercises the gap math against the
// spliced text nodes a raw tag block produces.
function rawHastOf(md: string, offset = 0) {
  return unified()
    .use(remarkParse)
    .use(remarkRehype, { allowDangerousHtml: true })
    .use(rehypeRaw)
    .use(rehypeShowRawTags)
    .use(rehypeBlankGap, { offset })
    .runSync(unified().use(remarkParse).parse(md)) as any;
}

describe('rehypeBlankGap', () => {
  it('inserts a single-line gap between paragraphs separated by one blank line', () => {
    // lines 1: "a", 2: blank, 3: "b"
    const tree = hastOf('a\n\nb');
    const kids = topChildren(tree);
    const gaps = kids.filter((k) => k.tagName === 'div' && k.properties?.className?.includes('md-blank-gap'));
    expect(gaps.length).toBe(1);
    expect(gaps[0].properties.style).toBe('height:calc(1 * var(--md-gap-line, 1.6em))');
  });

  it('inserts a multi-line gap for two blank lines between blocks', () => {
    // line 1: "a", 2-3: blank, 4: "b"
    const tree = hastOf('a\n\n\nb');
    const gaps = topChildren(tree).filter((k) => k.properties?.className?.includes('md-blank-gap'));
    expect(gaps.length).toBe(1);
    expect(gaps[0].properties.style).toBe('height:calc(2 * var(--md-gap-line, 1.6em))');
  });

  it('does not insert a gap between adjacent lines in the same paragraph', () => {
    // remark-breaks: "a\nb" is one paragraph (soft break), no blank line.
    const tree = hastOf('a\nb');
    const gaps = topChildren(tree).filter((k) => k.properties?.className?.includes('md-blank-gap'));
    expect(gaps.length).toBe(0);
  });

  it('inserts a gap per blank-line run, not per blank line, between multiple blocks', () => {
    // a (1), blank (2), b (3), blanks (4-5), c (6)
    const tree = hastOf('a\n\nb\n\n\nc');
    const gaps = topChildren(tree).filter((k) => k.properties?.className?.includes('md-blank-gap'));
    expect(gaps.length).toBe(2);
    expect(gaps[0].properties.style).toBe('height:calc(1 * var(--md-gap-line, 1.6em))');
    expect(gaps[1].properties.style).toBe('height:calc(2 * var(--md-gap-line, 1.6em))');
  });

  it('leaves the first block with no leading gap', () => {
    const tree = hastOf('a\n\nb');
    const kids = topChildren(tree);
    expect(kids[0].tagName).not.toBe('div');
  });

  it('renders leading blank lines as a gap before the first block', () => {
    // lines 1-2 blank, "a" at line 3: the editor descends 2 lines before the
    // first block — without a leading gap the preview lacked that height and
    // the first block sat ABOVE the cursor (desiredRaw clamped at 0).
    const tree = hastOf('\n\na\n\nb');
    const kids = topChildren(tree);
    const gaps = kids.filter((k) => k.properties?.className?.includes('md-blank-gap'));
    expect(gaps.length).toBe(2); // leading (2) + between (1)
    expect(kids[0].properties.style).toBe('height:calc(2 * var(--md-gap-line, 1.6em))');
    expect(gaps[1].properties.style).toBe('height:calc(1 * var(--md-gap-line, 1.6em))');
  });

  it('renders frontmatter lines as the leading gap (offset shifts line 1)', () => {
    // 3 frontmatter lines → the body's first block is editor line 4; the
    // leading gap covers the 3 lines above it.
    const tree = hastOf('a', /*offset*/ 3);
    const kids = topChildren(tree);
    expect(kids[0].properties?.className?.includes('md-blank-gap')).toBe(true);
    expect(kids[0].properties.style).toBe('height:calc(3 * var(--md-gap-line, 1.6em))');
  });

  it('respects frontmatter offset in the gap math', () => {
    // With offset 3 (3 frontmatter lines), the first block sits at editor
    // line 4 → a leading gap of 3 covers the frontmatter; the BETWEEN gap
    // (start − prevEnd − 1) is still offset-independent (both ends shift).
    const tree = hastOf('a\n\nb', /*offset*/ 3);
    const gaps = topChildren(tree).filter((k) => k.properties?.className?.includes('md-blank-gap'));
    expect(gaps.length).toBe(2);
    expect(gaps[0].properties.style).toBe('height:calc(3 * var(--md-gap-line, 1.6em))');
    expect(gaps[1].properties.style).toBe('height:calc(1 * var(--md-gap-line, 1.6em))');
  });

  it('sizes the gap after a spliced raw-tag block by its real end line, not by all its lines', () => {
    // Tag block occupies lines 1-3, blank line 4, h1 at line 5 → gap of 1.
    // Pre-fix: the spliced text nodes were skipped, so lines 1-3 counted as
    // blanks and the h1 got a 4-line blank band.
    const tree = rawHastOf('<workflow-state>\ntask\n</workflow-state>\n\n# Head');
    const kids = topChildren(tree);
    const gaps = kids.filter((k) => k.properties?.className?.includes('md-blank-gap'));
    expect(gaps).toHaveLength(1);
    expect(gaps[0].properties.style).toBe('height:calc(1 * var(--md-gap-line, 1.6em))');
    // No leading gap: the first root node is the spliced tag block — a
    // positioned p (BLOCK_TAGS branch, starts at line 1 → leading = 0).
    expect(kids[0].tagName).toBe('p');
    expect(kids[0].properties?.className).toContain('md-raw-tag-block');
    expect(kids[0].position?.end?.line).toBe(3);
  });

  it('advances the line cursor past a raw-tag block between paragraphs', () => {
    // p (1), tag block (3-5), h1 (7). The tag block is a positioned root p
    // (BLOCK_TAGS), so the blank line before IT also renders a gap — exactly
    // like any other block — plus the one before the h1.
    const tree = rawHastOf('para\n\n<workflow-state>\ntask\n</workflow-state>\n\n# Head');
    const gaps = topChildren(tree).filter((k) => k.properties?.className?.includes('md-blank-gap'));
    expect(gaps).toHaveLength(2);
    expect(gaps[0].properties.style).toBe('height:calc(1 * var(--md-gap-line, 1.6em))');
    expect(gaps[1].properties.style).toBe('height:calc(1 * var(--md-gap-line, 1.6em))');
  });
});
