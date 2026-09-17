import { describe, expect, it } from 'vitest';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkBreaks from 'remark-breaks';
import remarkRehype from 'remark-rehype';
import { rehypeBlankGap } from './rehypeBlankGap';

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

describe('rehypeBlankGap', () => {
  it('inserts a single-line gap between paragraphs separated by one blank line', () => {
    // lines 1: "a", 2: blank, 3: "b"
    const tree = hastOf('a\n\nb');
    const kids = topChildren(tree);
    const gaps = kids.filter((k) => k.tagName === 'div' && k.properties?.className?.includes('md-blank-gap'));
    expect(gaps.length).toBe(1);
    expect(gaps[0].properties.style).toBe('height:calc(1 * 1.8em)');
  });

  it('inserts a multi-line gap for two blank lines between blocks', () => {
    // line 1: "a", 2-3: blank, 4: "b"
    const tree = hastOf('a\n\n\nb');
    const gaps = topChildren(tree).filter((k) => k.properties?.className?.includes('md-blank-gap'));
    expect(gaps.length).toBe(1);
    expect(gaps[0].properties.style).toBe('height:calc(2 * 1.8em)');
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
    expect(gaps[0].properties.style).toBe('height:calc(1 * 1.8em)');
    expect(gaps[1].properties.style).toBe('height:calc(2 * 1.8em)');
  });

  it('leaves the first block with no leading gap', () => {
    const tree = hastOf('a\n\nb');
    const kids = topChildren(tree);
    expect(kids[0].tagName).not.toBe('div');
  });

  it('respects frontmatter offset in the gap math', () => {
    // With offset, both start/end lines shift by the same amount → gap
    // (start - prevEnd - 1) is unchanged. Sanity check it still works.
    const tree = hastOf('a\n\nb', /*offset*/ 3);
    const gaps = topChildren(tree).filter((k) => k.properties?.className?.includes('md-blank-gap'));
    expect(gaps.length).toBe(1);
    expect(gaps[0].properties.style).toBe('height:calc(1 * 1.8em)');
  });
});
