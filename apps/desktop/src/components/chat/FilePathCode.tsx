/**
 * Clickable file-path inline-code renderer + context.
 *
 * Used by MessageContent's rehype-react `code` override. When an inline-code
 * token matches `matchFilePath`, the override renders `<FilePathCode>`; the
 * component async-checks existence via the consumer-supplied `resolvePath`
 * (cached per `raw` for the session), and on click calls `onPathClick`.
 *
 * Consumers wire the context value from outside the markdown pipeline — the
 * module-level `processor` can't close over per-render props, so we hand the
 * callbacks in via React context.
 */

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ComponentProps,
  type ReactNode,
} from 'react';
import { checkPathExists, matchFilePath } from './filePath';

export interface FilePathContextValue {
  /** Resolve whether a raw path string exists in the active vault / external
   *  fs / wiki provider. Called once per unique `raw` (memoized in
   *  `checkPathExists`). */
  resolvePath?: (raw: string) => Promise<boolean>;
  /** Open `path` (optionally at `line`/`col`) in the editor. */
  onPathClick?: (path: string, line?: number, col?: number) => void;
}

export const FilePathContext = createContext<FilePathContextValue>({});

/** Flatten a rehype-react `children` prop to a plain string. Inline-code
 *  tokens are normally a single string, but be defensive. */
function childrenToText(children: ReactNode): string {
  if (typeof children === 'string') return children;
  if (typeof children === 'number') return String(children);
  if (Array.isArray(children)) return children.map(childrenToText).join('');
  return '';
}

/** Rehype-react `code` override. Decides whether an inline-code token is a
 *  file path; if so (and the context has the callbacks), renders
 *  `<FilePathCode>`; otherwise renders plain `<code>` (block code or
 *  non-path inline code). */
export function CodeOverride({
  children,
  className,
  ...rest
}: ComponentProps<'code'> & { node?: unknown }) {
  const ctx = useContext(FilePathContext);
  // Block code (fenced) carries hljs / language- classes from rehype-highlight.
  if (className && /\b(?:hljs|language-)/.test(className)) {
    return <code className={className} {...rest}>{children}</code>;
  }
  const text = childrenToText(children);
  const m = matchFilePath(text);
  if (!m || !ctx.onPathClick || !ctx.resolvePath) {
    return <code className={className} {...rest}>{children}</code>;
  }
  return (
    <FilePathCode
      raw={text}
      match={m}
      onPathClick={ctx.onPathClick}
      resolvePath={ctx.resolvePath}
      className={className}
    />
  );
}

interface FilePathCodeProps {
  raw: string;
  match: { path: string; line?: number; col?: number };
  onPathClick: (path: string, line?: number, col?: number) => void;
  resolvePath: (raw: string) => Promise<boolean>;
  className?: string;
}

function FilePathCode({
  raw,
  match,
  onPathClick,
  resolvePath,
  className,
}: FilePathCodeProps) {
  const [clickable, setClickable] = useState(false);

  useEffect(() => {
    let cancelled = false;
    // ponytail: existence cached per `raw` in filePath.ts; the resolver is
    // only called once per unique path per session.
    void checkPathExists(raw, resolvePath).then((ok) => {
      if (!cancelled) setClickable(ok);
    });
    return () => {
      cancelled = true;
    };
  }, [raw, resolvePath]);

  if (!clickable) {
    return <code className={className}>{raw}</code>;
  }

  return (
    <code
      className={className}
      title={`${match.path}${match.line ? `:${match.line}${match.col ? `:${match.col}` : ''}` : ''}`}
      style={{ cursor: 'pointer', textDecoration: 'underline', textDecorationStyle: 'dotted', textUnderlineOffset: '2px' }}
      onClick={(e) => {
        e.stopPropagation();
        onPathClick(match.path, match.line, match.col);
      }}
    >
      {raw}
    </code>
  );
}
