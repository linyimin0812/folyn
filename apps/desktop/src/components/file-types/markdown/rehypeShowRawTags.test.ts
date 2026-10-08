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

function textOf(nodes: any[]): string {
  return nodes
    .filter((n) => n.type === 'text')
    .map((n) => n.value)
    .join('');
}

describe('rehypeShowRawTags', () => {
  it('renders newlines inside unknown-tag content as <br> (remark-breaks parity)', () => {
    // Raw HTML content never passes through remark-breaks (mdast-level, before
    // rehypeRaw) — the plugin must splice the <br> itself.
    const tree = hastOf('<workflow-state>\ntask done\n</workflow-state>');
    const kids = tree.children as any[];
    expect(kids).toHaveLength(5);
    expect(kids[0]).toMatchObject({ type: 'text', value: '<workflow-state>' });
    expect(kids[1]).toMatchObject({ type: 'element', tagName: 'br' });
    expect(kids[2]).toMatchObject({ type: 'text', value: 'task done' });
    expect(kids[3]).toMatchObject({ type: 'element', tagName: 'br' });
    expect(kids[4]).toMatchObject({ type: 'text', value: '</workflow-state>' });
  });

  it('renders a <br> between sibling unknown tags separated by a newline', () => {
    // The \n between the two tags is a root-level text node (from raw HTML);
    // HTML whitespace collapsing would turn it into a space without this.
    const tree = hastOf('<workflow-state>\na\n</workflow-state>\n<workflow-state>\nb\n</workflow-state>');
    const kids = tree.children as any[];
    const closeIdx = kids.findIndex((n) => n.type === 'text' && n.value === '</workflow-state>');
    const openIdx = kids.findIndex((n) => n.type === 'text' && n.value === '<workflow-state>');
    expect(closeIdx).toBeGreaterThanOrEqual(0);
    expect(openIdx).toBeGreaterThanOrEqual(0);
    expect(openIdx).toBeLessThan(closeIdx);
    // The SECOND opening tag (the one after the close) must be separated by a br.
    const nextOpenIdx = kids.findIndex(
      (n, i) => i > closeIdx && n.type === 'text' && n.value === '<workflow-state>',
    );
    expect(nextOpenIdx).toBe(closeIdx + 2);
    expect(kids[closeIdx + 1]).toMatchObject({ type: 'element', tagName: 'br' });
    expect(kids[nextOpenIdx + 1]).toMatchObject({ type: 'element', tagName: 'br' });
  });

  it('leaves newline-free unknown-tag content as single text nodes', () => {
    // Single-line raw HTML is inline (not an HTML block), so it lands in a <p>.
    const tree = hastOf('<workflow-state>task done</workflow-state>');
    const para = (tree.children as any[]).find((k) => k.tagName === 'p');
    expect(textOf(para.children)).toBe('<workflow-state>task done</workflow-state>');
    expect(para.children.every((n: any) => n.type === 'text')).toBe(true);
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

  it('stamps the element position on the spliced open/close text nodes', () => {
    // rehypeBlankGap reads position.end.line to advance its line cursor past
    // raw-HTML blocks — unpositioned, the tag block's lines count as blanks
    // for the next block's gap.
    const tree = hastOf('<workflow-state>\ntask\n</workflow-state>\n\n# Head');
    const kids = tree.children as any[];
    const open = kids.find((n) => n.type === 'text' && n.value === '<workflow-state>');
    const close = kids.find((n) => n.type === 'text' && n.value === '</workflow-state>');
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
    // (single-line only) does not match; stage 2 splices it at hast level.
    const tree = hastOf('<workflow-state>\ntask\n</workflow-state>');
    const kids = tree.children as any[];
    expect(kids.find((n) => n.tagName === 'p')).toBeUndefined();
    expect(kids[0]).toMatchObject({ type: 'text', value: '<workflow-state>' });
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
