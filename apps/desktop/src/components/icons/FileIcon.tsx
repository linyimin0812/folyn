import React from 'react';
import { ThemeIcon, hasIcon } from './ThemeIcon';

interface FileIconProps {
  filename: string;
  isDir?: boolean;
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
  csv: 'csv',
  dbml: 'sql',
  png: 'image',
  jpg: 'image',
  jpeg: 'image',
  gif: 'image',
  webp: 'image',
  svg: 'image',
  bmp: 'image',
  ico: 'image',
  pdf: 'pdf',
  sh: 'shell',
  bash: 'shell',
  zsh: 'shell',
  fish: 'shell',
  java: 'java',
};

const HANDLER_TO_THEME_ICON: Record<string, string> = {
  markdown: 'markdown',
  html: 'xhtml',
  image: 'image',
  pdf: 'pdf',
  csv: 'csv',
  json: 'json',
  dbml: 'sql',
  code: 'javaScript',
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

function DefaultFileIcon() {
  return (
    <svg width={S} height={S} viewBox="0 0 16 16" fill="none" style={{ stroke: 'var(--ic-default)' }} strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4.5 1.5h4.5l4 4v8.5a1 1 0 01-1 1h-7.5a1 1 0 01-1-1v-11.5a1 1 0 011-1z" />
      <path d="M9 1.5v4h4" />
    </svg>
  );
}

export function FileIcon({ filename, isDir }: FileIconProps) {
  if (isDir) {
    return <ThemeIcon name="folder" />;
  }

  const ext = filename.split('.').pop()?.toLowerCase() ?? '';

  if (ext === 'excalidraw') return <ExcalidrawIcon />;

  const iconName = EXT_TO_THEME_ICON[ext];
  if (iconName && hasIcon(iconName)) return <ThemeIcon name={iconName} />;

  return <DefaultFileIcon />;
}

export function getFileTypeIcon(handlerId: string): React.ReactElement {
  if (handlerId === 'excalidraw') return <ExcalidrawIcon />;
  if (handlerId === 'web') return <WebIcon />;
  if (handlerId === 'clip') return <ClipIcon />;

  const iconName = HANDLER_TO_THEME_ICON[handlerId];
  if (iconName && hasIcon(iconName)) return <ThemeIcon name={iconName} />;

  return <DefaultFileIcon />;
}
