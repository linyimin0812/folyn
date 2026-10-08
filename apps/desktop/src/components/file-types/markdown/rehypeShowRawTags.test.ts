import { describe, expect, it } from 'vitest';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkRehype from 'remark-rehype';
import rehypeRaw from 'rehype-raw';
import { rehypeShowRawTags } from './rehypeShowRawTags';

// Build a hast tree the way MarkdownPreview does (raw HTML enabled).
function hastOf(md: string, extraKnownTags?: Iterable<string>) {
  return unified()
    .use(remarkParse)
    .use(remarkRehype, { allowDangerousHtml: true })
    .use(rehypeRaw)
    .use(rehypeShowRawTags, { extraKnownTags })
    .runSync(unified().use(remarkParse).parse(md)) as any;
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

  it('leaves newline-free unknown-tag content as single text nodes', () => {
    // Single-line raw HTML is inline (not an HTML block), so it lands in a <p>.
    const tree = hastOf('<workflow-state>task done</workflow-state>');
    const para = (tree.children as any[]).find((k) => k.tagName === 'p');
    expect(textOf(para.children)).toBe('<workflow-state>task done</workflow-state>');
    expect(para.children.every((n: any) => n.type === 'text')).toBe(true);
  });

  it('shows unknown inline tags, keeps inner markdown rendering', () => {
    const tree = hastOf('a <foo>**bold**</foo> b');
    const para = (tree.children as any[]).find((k) => k.tagName === 'p');
    expect(textOf(para.children)).toBe('a <foo></foo> b');
    const strong = para.children.find((c: any) => c.tagName === 'strong');
    expect(textOf(strong.children)).toBe('bold');
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

  it('keeps extraKnownTags as elements (container directives have React components)', () => {
    const tree = hastOf('<tabs><tab>x</tab></tabs>', ['tabs', 'tab']);
    const para = (tree.children as any[]).find((k) => k.tagName === 'p');
    expect(para).toBeTruthy();
    expect(para.children[0].tagName).toBe('tabs');
    expect(para.children[0].children[0].tagName).toBe('tab');
  });
});
