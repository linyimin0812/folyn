import React from 'react';
import { ThemeIcon, hasIcon } from './ThemeIcon';
import chromeIcon from '@/assets/chrome.svg';
import wikiGraphIcon from '@/assets/icons/wiki_graph.svg';
import { getHandlerByExtension, getHandlerById } from '@/components/file-types/registry';

interface FileIconProps {
  filename: string;
  isDir?: boolean;
  /** File-type id (e.g. 'web') to pick a type-specific icon. */
  fileType?: string;
}

const S = 16;

const EXT_TO_THEME_ICON: Record<string, string> = {
  md: 'markdown',
  markdown: 'markdown',
  mdx: 'markdown',
  html: 'xhtml',
  htm: 'xhtml',
  ts: 'typeScript',
  tsx: 'typeScript',
  mts: 'typeScript',
  js: 'javaScript',
  mjs: 'javaScript',
  jsx: 'jsx',
  json: 'json',
  css: 'cssClass',
  scss: 'cssClass',
  less: 'cssClass',
  py: 'python',
  pyw: 'python',
  yaml: 'yaml',
  yml: 'yaml',
  sql: 'sql',
  csv: 'spreadsheet',
  dbml: 'sql',
  png: 'image',
  jpg: 'image',
  jpeg: 'image',
  gif: 'image',
  webp: 'image',
  svg: 'svg',
  bmp: 'image',
  ico: 'image',
  pdf: 'pdf',
  sh: 'shell',
  bash: 'shell',
  zsh: 'shell',
  fish: 'shell',
  txt: 'text',
  text: 'text',
  doc: 'doc',
  docx: 'doc',
  ppt: 'presentation',
  pptx: 'presentation',
  xls: 'spreadsheet',
  xlsx: 'spreadsheet',
  ods: 'spreadsheet',
  mp3: 'audio',
  wav: 'audio',
  flac: 'audio',
  ogg: 'audio',
  aac: 'audio',
  m4a: 'audio',
  opus: 'audio',
  midi: 'audio',
  mid: 'audio',
  mp4: 'video',
  webm: 'video',
  avi: 'video',
  mov: 'video',
  mkv: 'video',
  m4v: 'video',
  zip: 'pack',
  rar: 'pack',
  '7z': 'pack',
  tar: 'pack',
  gz: 'pack',
  bz2: 'pack',
  xz: 'pack',
  java: 'java',
  mmap: 'mindMap',
  drawio: 'drawio',
  dio: 'drawio',
  puml: 'plantuml',
  pu: 'plantuml',
  plantuml: 'plantuml',
  gv: 'graphviz',
  dot: 'graphviz',
  graphviz: 'graphviz',
  mmd: 'mermaid',
  mermaid: 'mermaid',
  rt: 'richtext',
};

const HANDLER_TO_THEME_ICON: Record<string, string> = {
  markdown: 'markdown',
  html: 'xhtml',
  image: 'image',
  pdf: 'pdf',
  csv: 'spreadsheet',
  json: 'json',
  dbml: 'sql',
  mmap: 'mindMap',
  drawio: 'drawio',
  plantuml: 'plantuml',
  graphviz: 'graphviz',
  mermaid: 'mermaid',
  code: 'javaScript',
  'rich-text': 'richtext',
  svg: 'svg',
};

function ExcalidrawIcon() {
  return (
    <svg width={S} height={S} viewBox="0 0 16 16" fill="none" style={{ stroke: 'var(--ic-draw)' }} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M11.5 2.5l2 2-8.5 8.5-3 .5.5-3z" />
      <path d="M9.5 4.5l2 2" />
    </svg>
  );
}

function ClipIcon() {
  return (
    <svg width={S} height={S} viewBox="0 0 16 16" fill="none" style={{ stroke: 'var(--ic-web, #89b4fa)' }} strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 2v12l4-2.5L12 14V2H4z" />
    </svg>
  );
}

function WebIcon() {
  return (
    <svg width={S} height={S} viewBox="0 0 16 16" fill="none" style={{ stroke: 'var(--ic-web)' }} strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="8" cy="8" r="5.5" />
      <ellipse cx="8" cy="8" rx="2.5" ry="5.5" />
      <path d="M2.5 8h11" />
      <path d="M3.2 5.2h9.6" />
      <path d="M3.2 10.8h9.6" />
    </svg>
  );
}

export function FileIcon({ filename, isDir, fileType }: FileIconProps) {
  if (isDir) {
    return <ThemeIcon name="folder" />;
  }

  // Browser/web tabs share the Chrome icon in the open-files tab bar.
  if (fileType === 'web') {
    return <img src={chromeIcon} alt="" width={S} height={S} className="shrink-0" />;
  }
  if (fileType === 'wiki-graph') {
    return <img src={wikiGraphIcon} alt="" width={S} height={S} className="shrink-0" />;
  }

  const ext = filename.split('.').pop()?.toLowerCase() ?? '';

  if (ext === 'excalidraw') return <ExcalidrawIcon />;

  const iconName = EXT_TO_THEME_ICON[ext];
  if (iconName && hasIcon(iconName)) return <ThemeIcon name={iconName} />;

  // ponytail: no built-in ext mapping — consult the registry lazily (render
  // time, AFTER the registry's eager `import.meta.glob` has resolved, so no
  // TDZ). A plugin handler may supply its own `icon` (ReactNode), so plugin
  // file types get their icon without modifying host source.
  //
  // NOTE: only the <FileIcon> component does this. The legacy `getFileTypeIcon`
  // function below is called at module load by built-in handler index.ts
  // files (before registry is initialized), so it must NOT touch the
  // registry — that would re-introduce the cycle.
  const handler = fileType ? getHandlerById(fileType) : getHandlerByExtension(ext);
  // Skip the generic code handler's icon (javaScript) for files that are only
  // recognized as a fallback — use the neutral documentation icon instead.
  if (handler && handler.id !== 'code' && handler?.icon) return <>{handler.icon}</>;

  return <ThemeIcon name="documentation" />;
}

export function getFileTypeIcon(handlerId: string): React.ReactElement {
  if (handlerId === 'excalidraw') return <ExcalidrawIcon />;
  if (handlerId === 'web') return <WebIcon />;
  if (handlerId === 'clip') return <ClipIcon />;

  const iconName = HANDLER_TO_THEME_ICON[handlerId];
  if (iconName && hasIcon(iconName)) return <ThemeIcon name={iconName} />;

  return <ThemeIcon name="documentation" />;
}
