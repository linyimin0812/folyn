import { describe, expect, it } from 'vitest';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkRehype from 'remark-rehype';
import rehypeRaw from 'rehype-raw';
import { rehypeShowRawTags, remarkCollapseUnknownTagRuns } from './rehypeShowRawTags';

// Build a hast tree the way MarkdownPreview does (raw HTML enabled). The
// source string is passed as the vfile (mirrors processSync(md)) so the
// plugins' transformers receive file.value and can slice raw inner content
// by position — without it the fallback path silently masks the feature.
function hastOf(md: string, extraKnownTags?: Iterable<string>) {
  const proc = unified()
    .use(remarkParse)
    .use(remarkCollapseUnknownTagRuns, { extraKnownTags })
    .use(remarkRehype, { allowDangerousHtml: true })
    .use(rehypeRaw)
    .use(rehypeShowRawTags, { extraKnownTags });
  return proc.runSync(proc.parse(md), md) as any;
}

// Recursive text collector: spliced unknown-tag runs live INSIDE a
// span.md-raw-tag wrapper, so flat text-node filtering would miss them.
function textOf(nodes: any[]): string {
  return nodes
    .map((n) => {
      if (n.type === 'text') return n.value;
      if (Array.isArray(n?.children)) return textOf(n.children);
      return '';
    })
    .join('');
}

// The wrapper around a spliced unknown-tag run: span.md-raw-tag (inline
// context) or p.md-raw-tag-block (root level — same class as stage 1's
// collapsed paragraph, so the look is uniform regardless of blank lines).
function rawTagSpans(nodes: any[]): any[] {
  return nodes.filter(
    (n) =>
      (n.tagName === 'span' && n.properties?.className?.includes('md-raw-tag')) ||
      (n.tagName === 'p' && n.properties?.className?.includes('md-raw-tag-block')),
  );
}

describe('rehypeShowRawTags', () => {
  it('renders newlines inside unknown-tag content as <br> (remark-breaks parity)', () => {
    // Raw HTML content never passes through remark-breaks (mdast-level, before
    // rehypeRaw) — the plugin must splice the <br> itself.
    const tree = hastOf('<workflow-state>\ntask done\n</workflow-state>');
    const kids = tree.children as any[];
    // The spliced run is wrapped in one p.md-raw-tag-block (root level — the
    // same wrapper as stage 1's collapsed region, block styling).
    expect(kids).toHaveLength(1);
    expect(kids[0].tagName).toBe('p');
    expect(kids[0].properties?.className).toContain('md-raw-tag-block');
    const inner = kids[0].children as any[];
    expect(inner).toHaveLength(5);
    expect(inner[0]).toMatchObject({ type: 'text', value: '<workflow-state>' });
    expect(inner[1]).toMatchObject({ type: 'element', tagName: 'br' });
    expect(inner[2]).toMatchObject({ type: 'text', value: 'task done' });
    expect(inner[3]).toMatchObject({ type: 'element', tagName: 'br' });
    expect(inner[4]).toMatchObject({ type: 'text', value: '</workflow-state>' });
  });

  it('renders a <br> between sibling unknown tags separated by a newline', () => {
    // The \n between the two tags is a root-level text node (from raw HTML);
    // HTML whitespace collapsing would turn it into a space without this.
    const tree = hastOf('<workflow-state>\na\n</workflow-state>\n<workflow-state>\nb\n</workflow-state>');
    const kids = tree.children as any[];
    const spans = rawTagSpans(kids);
    expect(spans).toHaveLength(2);
    // Each root-level block holds its own tag's full spliced run.
    expect(textOf(spans[0].children)).toBe('<workflow-state>a</workflow-state>');
    expect(textOf(spans[1].children)).toBe('<workflow-state>b</workflow-state>');
    // The two blocks are separated by a <br>, not a collapsed space.
    const brs = kids.filter((n) => n.tagName === 'br');
    expect(brs).toHaveLength(1);
    expect(kids.indexOf(brs[0])).toBe(kids.indexOf(spans[0]) + 1);
    expect(kids.indexOf(spans[1])).toBe(kids.indexOf(brs[0]) + 1);
  });

  it('leaves newline-free unknown-tag content as single text nodes', () => {
    // Single-line raw HTML is inline (not an HTML block), so it lands in a <p>.
    const tree = hastOf('<workflow-state>task done</workflow-state>');
    const para = (tree.children as any[]).find((k) => k.tagName === 'p');
    expect(textOf(para.children)).toBe('<workflow-state>task done</workflow-state>');
    const spans = rawTagSpans(para.children);
    expect(spans).toHaveLength(1);
    // Inside the chip it is all plain text — no nested element structure.
    expect(spans[0].children.every((n: any) => n.type === 'text')).toBe(true);
  });

  it('shows unknown inline tags with inner markdown as raw source', () => {
    const tree = hastOf('a <foo>**bold**</foo> b');
    const para = (tree.children as any[]).find((k) => k.tagName === 'p');
    expect(textOf(para.children)).toBe('a <foo>**bold**</foo> b');
    expect(para.children.some((n: any) => n.tagName === 'strong')).toBe(false);
  });

  it('renders inner content with markdown and a nested tag as one raw slice', () => {
    const tree = hastOf('<foo>**b** <bar>x</bar></foo>');
    const para = (tree.children as any[]).find((k) => k.tagName === 'p');
    expect(textOf(para.children)).toBe('<foo>**b** <bar>x</bar></foo>');
  });

  it('serializes attributes of unknown tags', () => {
    const tree = hastOf('<status level="high" flag paused>x</status>');
    const para = (tree.children as any[]).find((k) => k.tagName === 'p');
    expect(textOf(para.children).startsWith('<status level="high" flag paused>')).toBe(true);
  });

  it('renders a self-closing unknown tag as an open tag (parser drops the slash)', () => {
    // parse5 ignores the self-closing slash on non-void tags: <xyz/> arrives
    // as an OPEN tag whose children absorbed the trailing text.
    const tree = hastOf('a <xyz/> b');
    const para = (tree.children as any[]).find((k) => k.tagName === 'p');
    expect(textOf(para.children)).toBe('a <xyz> b</xyz>');
  });

  it('leaves known HTML tags as elements', () => {
    const tree = hastOf('<div><b>bold</b></div>');
    const div = (tree.children as any[]).find((k) => k.tagName === 'div');
    expect(div).toBeTruthy();
    expect(div.children[0].tagName).toBe('b');
  });

  it('unwraps unknown tags nested inside known ones', () => {
    const tree = hastOf('<div><workflow-state>on</workflow-state></div>');
    const div = (tree.children as any[]).find((k) => k.tagName === 'div');
    expect(textOf(div.children)).toBe('<workflow-state>on</workflow-state>');
  });

  it('does not touch code block content', () => {
    const tree = hastOf('```\n<workflow-state>x</workflow-state>\n```');
    const pre = (tree.children as any[]).find((k) => k.tagName === 'pre');
    const code = pre.children.find((c: any) => c.tagName === 'code');
    expect(textOf([code]) + textOf(code.children)).toContain('<workflow-state>');
  });

  it('stamps the element position on the wrapper and the spliced open/close text nodes', () => {
    // rehypeBlankGap reads position.end.line to advance its line cursor past
    // raw-HTML blocks — unpositioned, the tag block's lines count as blanks
    // for the next block's gap. The root-level p.md-raw-tag-block is the
    // root entry, so it must carry the position (its inner text nodes keep
    // it too); as a positioned BLOCK_TAGS element the gap math uses the
    // block branch.
    const tree = hastOf('<workflow-state>\ntask\n</workflow-state>\n\n# Head');
    const kids = tree.children as any[];
    const spans = rawTagSpans(kids);
    expect(spans).toHaveLength(1);
    expect(spans[0].tagName).toBe('p');
    expect(spans[0].position).toMatchObject({ start: { line: 1 }, end: { line: 3 } });
    const open = spans[0].children.find((n: any) => n.type === 'text' && n.value === '<workflow-state>');
    const close = spans[0].children.find((n: any) => n.type === 'text' && n.value === '</workflow-state>');
    expect(open.position).toMatchObject({ start: { line: 1 }, end: { line: 3 } });
    expect(close.position).toMatchObject({ start: { line: 1 }, end: { line: 3 } });
  });

  it('keeps extraKnownTags as elements (container directives have React components)', () => {
    const tree = hastOf('<tabs><tab>x</tab></tabs>', ['tabs', 'tab']);
    const para = (tree.children as any[]).find((k) => k.tagName === 'p');
    expect(para).toBeTruthy();
    expect(para.children[0].tagName).toBe('tabs');
    expect(para.children[0].children[0].tagName).toBe('tab');
  });
});

describe('remarkCollapseUnknownTagRuns', () => {
  it('collapses a blank-line-separated unknown-tag region into one literal paragraph', () => {
    // CommonMark ends the type-7 HTML block at the first blank line, so
    // without stage 1 the `# 标题` heading and the fenced code render for
    // real and the tags become separate root html nodes.
    const md = '<workflow-state>\n\n# 标题\n\n```\ncode\n```\n\n</workflow-state>';
    const tree = hastOf(md);
    const kids = tree.children as any[];
    expect(kids.some((n) => n.tagName === 'h1')).toBe(false);
    expect(kids.some((n) => n.tagName === 'pre')).toBe(false);
    expect(kids).toHaveLength(1);
    const p = kids[0];
    expect(p.tagName).toBe('p');
    // The collapsed region renders as a raw source block (md-raw-tag-block
    // via mdast data.hProperties → remark-rehype).
    expect(p.properties?.className).toContain('md-raw-tag-block');
    // remark-rehype renders each mdast `break` as [br, text('\n')], so the
    // paragraph's text content is the raw source verbatim.
    expect(textOf(p.children)).toBe(md);
    // 9 source lines → 8 breaks; the two blank lines keep DOUBLE breaks.
    expect(p.children.filter((n: any) => n.tagName === 'br')).toHaveLength(8);
    // rehypeBlankGap contract: the collapsed paragraph spans the region.
    expect(p.position).toMatchObject({ start: { line: 1 }, end: { line: 9 } });
  });

  it('leaves a no-blank-line unknown-tag block to the hast-level plugin', () => {
    // No blank line inside → one multi-line html node → the mdast regex
    // (single-line only) does not match; stage 2 splices it at hast level
    // into ONE p.md-raw-tag-block — the SAME wrapper class as stage 1's
    // collapsed region, so the look is uniform with/without blank lines.
    const tree = hastOf('<workflow-state>\ntask\n</workflow-state>');
    const kids = tree.children as any[];
    expect(kids).toHaveLength(1);
    expect(kids[0].tagName).toBe('p');
    expect(kids[0].properties?.className).toContain('md-raw-tag-block');
    expect(textOf(kids)).toBe('<workflow-state>task</workflow-state>');
  });

  it('keeps surrounding paragraphs rendered and inner markdown literal in a collapsed region', () => {
    const md = 'before\n\n<foo>\n\ninner **md**\n\n</foo>\n\nafter';
    const tree = hastOf(md);
    const ps = (tree.children as any[]).filter((n) => n.tagName === 'p');
    expect(ps).toHaveLength(3);
    expect(textOf(ps[0].children)).toBe('before');
    expect(textOf(ps[2].children)).toBe('after');
    expect(textOf(ps[1].children)).toBe('<foo>\n\ninner **md**\n\n</foo>');
    expect(ps[1].children.some((n: any) => n.tagName === 'strong')).toBe(false);
  });

  it('does not collapse runs of extraKnownTags (container directives)', () => {
    const md = '<tabs>\n\n# 标题\n\n</tabs>';
    const tree = hastOf(md, ['tabs']);
    // The region still parses into a real <tabs> element (heading nests
    // inside it after rehypeRaw) — no literal-source paragraph is produced.
    const allTags: string[] = [];
    const walk = (n: any) => {
      if (n.tagName) allTags.push(n.tagName);
      (n.children ?? []).forEach(walk);
    };
    (tree.children as any[]).forEach(walk);
    expect(allTags).toContain('tabs');
    expect(allTags).toContain('h1');
    expect(allTags).not.toContain('p');
  });

  it('a different tag\'s close does not end the run', () => {
    // `</baz>` inside the region is NOT the run terminator — only a lone
    // close of the SAME name ends it.
    const md = '<foo>\n\na\n\n</baz>\n\nb\n\n</foo>';
    const tree = hastOf(md);
    const ps = (tree.children as any[]).filter((n) => n.tagName === 'p');
    expect(ps).toHaveLength(1);
    expect(textOf(ps[0].children)).toBe(md);
  });
});
