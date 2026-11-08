import { describe, it, expect } from 'vitest';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import remarkRehype from 'remark-rehype';
import rehypeReact from 'rehype-react';
import { Fragment, jsx, jsxs } from 'react/jsx-runtime';
import { renderToStaticMarkup } from 'react-dom/server';
import { remarkSourceListNumbers } from './remarkSourceListNumbers';

// Same remark → rehype-react path as MarkdownPreview, so the assertion also
// covers hProperties.value surviving as the React `value` prop on <li>.
function render(md: string): string {
  const result = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkSourceListNumbers)
    .use(remarkBreaks)
    .use(remarkRehype)
    .use(rehypeReact, { jsx, jsxs, Fragment } as any)
    .processSync(md).result as any;
  return renderToStaticMarkup(result);
}

const liValues = (html: string) =>
  [...html.matchAll(/<li([^>]*)>/g)].map((m) => /value="(\d+)"/.exec(m[1])?.[1] ?? null);

describe('remarkSourceListNumbers', () => {
  it('uses source numbers when a struck line is a lazy continuation (repro)', () => {
    const md = [
      '# Quill使用问题',
      '',
      '1. 从大文件切换到其他文件，会很卡',
      '~~2. 实现一个工作日程安排插件~~',
      '3. 实现一个知行空间的插件',
      '4. 实现一个数据库查看的插件，支持不同数据库',
    ].join('\n');
    const html = render(md);
    expect(liValues(html)).toEqual(['1', '3', '4']);
    // The struck line stays inside item 1.
    expect(html).toMatch(/<li value="1">[^]*<del>2\. 实现一个工作日程安排插件<\/del>[^]*?<\/li>/);
  });

  it('keeps a normal consecutive list as 1, 2, 3', () => {
    expect(liValues(render('1. a\n2. b\n3. c'))).toEqual(['1', '2', '3']);
  });

  it('supports the paren delimiter', () => {
    expect(liValues(render('3) a\n7) b'))).toEqual(['3', '7']);
  });

  it('leaves unordered lists untouched', () => {
    expect(liValues(render('- a\n- b'))).toEqual([null, null]);
  });
});
