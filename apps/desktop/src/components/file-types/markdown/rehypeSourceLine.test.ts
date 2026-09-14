import { describe, expect, it } from 'vitest';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkRehype from 'remark-rehype';
import { rehypeSourceLine } from './rehypeSourceLine';

// Tight list items must each get their own data-source-line so cursor-sync
// targets the individual <li>, not the whole <ul> (the reported
// "treats the list as one whole" bug).
function hastOf(md: string) {
  return unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkRehype)
    .use(rehypeSourceLine)
    .runSync(unified().use(remarkParse).use(remarkGfm).parse(md)) as any;
}
function findAll(n: any, tag: string, out: any[] = []): any[] {
  if (n.type === 'element' && n.tagName === tag) out.push(n);
  if (n.children) for (const c of n.children) findAll(c, tag, out);
  return out;
}

describe('rehypeSourceLine on list items', () => {
  it('stamps each tight-list <li> with its own source line', () => {
    const t = hastOf('- a\n- b\n- c');
    const lis = findAll(t, 'li');
    expect(lis.length).toBe(3);
    expect(lis[0].properties['data-source-line']).toBe(1);
    expect(lis[1].properties['data-source-line']).toBe(2);
    expect(lis[2].properties['data-source-line']).toBe(3);
  });

  it('offsets list-item lines by the frontmatter offset', () => {
    const t = hastOf('# T\n\n- a\n- b');
    const lis = findAll(t, 'li');
    // offset 2 → lines shift by 2
    const t2 = unified()
      .use(remarkParse).use(remarkGfm).use(remarkRehype)
      .use(rehypeSourceLine, { offset: 2 })
      .runSync(unified().use(remarkParse).use(remarkGfm).parse('# T\n\n- a\n- b')) as any;
    const lis2 = findAll(t2, 'li');
    expect(lis2[0].properties['data-source-line']).toBe(lis[0].properties['data-source-line'] + 2);
  });
});
