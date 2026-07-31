import { useMemo, createElement, Fragment } from 'react';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkRehype from 'remark-rehype';
import rehypeHighlight from 'rehype-highlight';
import rehypeReact from 'rehype-react';
import { jsx, jsxs } from 'react/jsx-runtime';

// ponytail: image models (e.g. rig-backed image gen) return the generated
// image inline as a `data:image/...;base64,...` text delta. The markdown
// pipeline renders that as a giant opaque text blob; detect a content blob
// that is *entirely* a data URL and short-circuit to an <img>. Mid-stream
// partials (incomplete base64) won't match and fall through to markdown —
// final state is correct. One-line regex, no new module.
const DATA_URL_IMAGE_RE = /^data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=]+$/;

// TODO(PRx): lazy-load markdown pipeline via dynamic import to keep the
// pet-panel bundle lean. The top-level import is acceptable for PR1
// (correctness first); PR2/PR3 will split the heavy markdown deps out of
// the secondary-window bundle.

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

export interface MessageContentProps {
  content: string;
  /** Skip the unified markdown pipeline and render the raw content inside a
   *  plain div. The caller is responsible for whitespace handling (e.g.
   *  passing a `whitespace-pre-wrap` Tailwind class). Used by the pet chat,
   *  which is vault-free and renders assistant text as-is. */
  plaintext?: boolean;
  /** Extra class for the outer div. In markdown mode the outer always
   *  carries `msg-md`; in plaintext mode only `className` is applied. */
  className?: string;
}

export function MessageContent({ content, plaintext, className }: MessageContentProps) {
  const rendered = useMemo(() => {
    if (plaintext) {
      // Plaintext path: no markdown processing. Empty content still renders
      // the wrapper div (the caller decides whether to render the bubble at
      // all); the markdown path returns null for empty content.
      return content;
    }
    if (!content.trim()) return null;
    if (DATA_URL_IMAGE_RE.test(content.trim())) {
      return <img src={content.trim()} alt="" className="max-w-full h-auto rounded" />;
    }
    try {
      const result = processor.processSync(content);
      return result.result as React.ReactNode;
    } catch {
      return content;
    }
  }, [content, plaintext]);

  if (plaintext) {
    return <div className={className}>{rendered}</div>;
  }
  return <div className={`msg-md${className ? ` ${className}` : ''}`}>{rendered}</div>;
}
