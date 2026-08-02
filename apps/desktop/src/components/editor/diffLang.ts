// ponytail: tiny file-extension → git-diff-view language map. Avoids loading
// @codemirror/language-data just for highlighter lookup; the lowlight
// highlighter in @git-diff-view/lowlight uses these names directly.
//
// Ceiling: only covers languages Quill edits today (md/ts/tsx/json/css/...).
// Add more when a file type surfaces; no fallback registry to keep the
// happy path linear.

export type DiffLang =
  | 'plaintext'
  | 'markdown'
  | 'typescript'
  | 'tsx'
  | 'javascript'
  | 'jsx'
  | 'json'
  | 'css'
  | 'scss'
  | 'less'
  | 'html'
  | 'xml'
  | 'yaml'
  | 'python'
  | 'rust'
  | 'go'
  | 'java'
  | 'sql'
  | 'bash'
  | 'shell';

const EXT_TO_LANG: Record<string, DiffLang> = {
  md: 'markdown',
  markdown: 'markdown',
  mdx: 'markdown',
  ts: 'typescript',
  tsx: 'tsx',
  mts: 'typescript',
  cts: 'typescript',
  js: 'javascript',
  jsx: 'jsx',
  mjs: 'javascript',
  cjs: 'javascript',
  json: 'json',
  jsonc: 'json',
  css: 'css',
  scss: 'scss',
  less: 'less',
  html: 'html',
  htm: 'html',
  svg: 'xml',
  xml: 'xml',
  yml: 'yaml',
  yaml: 'yaml',
  py: 'python',
  rs: 'rust',
  go: 'go',
  java: 'java',
  sql: 'sql',
  dbml: 'sql',
  sh: 'bash',
  zsh: 'shell',
};

export function resolveLang(filePath: string): DiffLang {
  const ext = filePath.split('.').pop()?.toLowerCase() ?? '';
  return EXT_TO_LANG[ext] ?? 'plaintext';
}
