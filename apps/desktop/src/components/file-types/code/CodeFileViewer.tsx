import { useMemo } from 'react';
import hljs from 'highlight.js';
import type { PreviewProps } from '../types';

const EXT_TO_LANG: Record<string, string> = {
  ts: 'typescript', tsx: 'typescript', mts: 'typescript',
  js: 'javascript', mjs: 'javascript', jsx: 'javascript',
  json: 'json', yaml: 'yaml', yml: 'yaml',
  md: 'markdown', markdown: 'markdown', mdx: 'markdown',
  html: 'xml', htm: 'xml', svg: 'xml',
  css: 'css', scss: 'scss', less: 'less',
  py: 'python', sh: 'bash', bash: 'bash', zsh: 'bash',
  sql: 'sql', java: 'java', go: 'go', rust: 'rust', rs: 'rust',
  c: 'c', cpp: 'cpp', h: 'c',
  // ponytail: not exhaustive — highlight.js will fall back to highlightAuto for anything missing.
};

export function CodeFileViewer({ content, filePath }: PreviewProps) {
  const ext = filePath.toLowerCase().match(/\.([^.]+)$/)?.[1] || '';
  // ponytail: prefer the file extension itself if hljs knows it — lets plugin-contributed
  // grammars (e.g. plantuml registering 'plantuml' + aliases 'puml'/'pu') drive
  // .puml/.plantuml/.pu highlighting without a per-extension core mapping. Fall back
  // to the EXT_TO_LANG alias table, then highlightAuto.
  const lang = hljs.getLanguage(ext) ? ext : EXT_TO_LANG[ext];

  const html = useMemo(() => {
    try {
      if (lang && hljs.getLanguage(lang)) {
        return hljs.highlight(content, { language: lang }).value;
      }
      return hljs.highlightAuto(content).value;
    } catch {
      // ponytail: highlight.js shouldn't throw on any string, but if it does,
      // fall through to plain text — no data loss, just no colors.
      return null;
    }
  }, [content, lang]);

  return (
    <pre
      className="hljs"
      style={{
        margin: 0, padding: '12px', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
        fontSize: '12px', fontFamily: 'var(--mono, monospace)',
      }}
    >
      {html ? <code dangerouslySetInnerHTML={{ __html: html }} /> : <code>{content}</code>}
    </pre>
  );
}
