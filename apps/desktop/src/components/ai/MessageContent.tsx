import { useMemo, createElement, Fragment } from 'react';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkRehype from 'remark-rehype';
import rehypeHighlight from 'rehype-highlight';
import rehypeReact from 'rehype-react';
import { jsx, jsxs } from 'react/jsx-runtime';

const processor = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkRehype)
  .use(rehypeHighlight, { detect: true })
  .use(rehypeReact, {
    createElement,
    Fragment,
    jsx,
    jsxs,
  });

export function MessageContent({ content }: { content: string }) {
  const rendered = useMemo(() => {
    if (!content.trim()) return null;
    try {
      const result = processor.processSync(content);
      return result.result as React.ReactNode;
    } catch {
      return content;
    }
  }, [content]);

  return <div className="msg-md">{rendered}</div>;
}
