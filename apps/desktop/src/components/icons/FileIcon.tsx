import React from 'react';

interface FileIconProps {
  filename: string;
  isDir?: boolean;
  isOpen?: boolean;
}

const S = 16;

function MarkdownIcon() {
  return (
    <svg width={S} height={S} viewBox="0 0 640 640" style={{ fill: 'var(--ic-md)' }}>
      <path d="M593.8 123.1L46.2 123.1C20.7 123.1 0 143.8 0 169.2L0 470.7C0 496.2 20.7 516.9 46.2 516.9L593.9 516.9C619.4 516.9 640.1 496.2 640 470.8L640 169.2C640 143.8 619.3 123.1 593.8 123.1zM338.5 424.6L277 424.6L277 304.6L215.5 381.5L154 304.6L154 424.6L92.3 424.6L92.3 215.4L153.8 215.4L215.3 292.3L276.8 215.4L338.3 215.4L338.3 424.6L338.5 424.6zM473.8 427.7L381.5 320L443 320L443 215.4L504.5 215.4L504.5 320L566 320L473.8 427.7z" />
    </svg>
  );
}

function HtmlIcon() {
  return (
    <svg width={S} height={S} viewBox="0 0 16 16" style={{ fill: 'var(--ic-html)' }}>
      <path d="M2 1h12l-1.1 12.5L8 15l-4.9-1.5L2 1zm2.2 2.4l.7 8.3L8 12.8l3.1-1.1.8-9.3H4.2zm1.3 1.8h5l-.15 1.8H7.5l.1 1.5h3.3l-.25 3-2.65.9-2.65-.9-.15-1.8h1.5l.08.9 1.22.4 1.22-.4.13-1.5H6l-.3-3.2h5.3l.15-1.4H5.5z" />
    </svg>
  );
}

function CodeIcon() {
  return (
    <svg width={S} height={S} viewBox="0 0 16 16" fill="none" style={{ stroke: 'var(--ic-code)' }} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 3.5C4 3.5 3.5 4 3.5 5v1.5c0 .8-.7 1.5-1.5 1.5.8 0 1.5.7 1.5 1.5V11c0 1 .5 1.5 1.5 1.5" />
      <path d="M11 3.5c1 0 1.5.5 1.5 1.5v1.5c0 .8.7 1.5 1.5 1.5-.8 0-1.5.7-1.5 1.5V11c0 1-.5 1.5-1.5 1.5" />
    </svg>
  );
}

function ImageIcon() {
  return (
    <svg width={S} height={S} viewBox="0 0 16 16" fill="none" style={{ stroke: 'var(--ic-img)' }} strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="2.5" width="12" height="11" rx="2" />
      <circle cx="5.5" cy="5.5" r="1.2" style={{ fill: 'var(--ic-img)' }} stroke="none" />
      <path d="M2.5 11.5l3-3.5 2.5 2.5 2-1.5 3.5 3" />
    </svg>
  );
}

function ExcalidrawIcon() {
  return (
    <svg width={S} height={S} viewBox="0 0 16 16" fill="none" style={{ stroke: 'var(--ic-draw)' }} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M11.5 2.5l2 2-8.5 8.5-3 .5.5-3z" />
      <path d="M9.5 4.5l2 2" />
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

function FolderIcon({ isOpen }: { isOpen?: boolean }) {
  if (isOpen) {
    return (
      <svg width={S} height={S} viewBox="0 0 16 16" style={{ fill: 'var(--ic-folder)' }}>
        <path d="M1.5 3.5A1 1 0 012.5 2.5h3.2l1.5 1.5h5.3a1 1 0 011 1V5H3.8a1.5 1.5 0 00-1.4 1L1 10.5V3.5z" opacity=".4" />
        <path d="M2.4 6h11.2a1 1 0 01.97 1.24l-1.2 5A1 1 0 0112.4 13H3.6a1 1 0 01-.97-.76l-1.2-5A1 1 0 012.4 6z" />
      </svg>
    );
  }
  return (
    <svg width={S} height={S} viewBox="0 0 16 16" style={{ fill: 'var(--ic-folder)' }}>
      <path d="M2 3a1 1 0 011-1h3.5l1.5 1.5h5a1 1 0 011 1v7.5a1 1 0 01-1 1H3a1 1 0 01-1-1V3z" />
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

function TypeScriptIcon() {
  return (
    <svg width={S} height={S} viewBox="0 0 16 16" style={{ fill: 'var(--ic-ts)' }}>
      <rect x="1" y="1" width="14" height="14" rx="2" />
      <text x="8" y="12" textAnchor="middle" fontSize="9" fontWeight="700" fontFamily="system-ui" fill="#fff">TS</text>
    </svg>
  );
}

function JavaScriptIcon() {
  return (
    <svg width={S} height={S} viewBox="0 0 16 16" style={{ fill: 'var(--ic-js)' }}>
      <rect x="1" y="1" width="14" height="14" rx="2" />
      <text x="8" y="12" textAnchor="middle" fontSize="9" fontWeight="700" fontFamily="system-ui" fill="var(--ic-js-fg)">JS</text>
    </svg>
  );
}

function JsonIcon() {
  return (
    <svg width={S} height={S} viewBox="0 0 16 16" fill="none" style={{ stroke: 'var(--ic-json)' }} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 3C3.8 3 3.2 3.6 3.2 4.8v2c0 .7-.5 1.2-1.2 1.2.7 0 1.2.5 1.2 1.2v2c0 1.2.6 1.8 1.8 1.8" />
      <path d="M11 3c1.2 0 1.8.6 1.8 1.8v2c0 .7.5 1.2 1.2 1.2-.7 0-1.2.5-1.2 1.2v2c0 1.2-.6 1.8-1.8 1.8" />
      <circle cx="6.5" cy="8" r=".7" style={{ fill: 'var(--ic-json)' }} stroke="none" />
      <circle cx="9.5" cy="8" r=".7" style={{ fill: 'var(--ic-json)' }} stroke="none" />
    </svg>
  );
}

function CssIcon() {
  return (
    <svg width={S} height={S} viewBox="0 0 16 16" style={{ fill: 'var(--ic-css)' }}>
      <path d="M2.5 1.5h11l-1 12-4.5 2-4.5-2-1-12zm2.2 2.5l.6 7 2.7 1.2 2.7-1.2.3-3.5H6l-.1-1.5h5.3l.2-1.5H5.5L5.4 4h6.2" />
    </svg>
  );
}

function YamlIcon() {
  return (
    <svg width={S} height={S} viewBox="0 0 16 16" fill="none" style={{ stroke: 'var(--ic-yaml)' }} strokeWidth="1.4" strokeLinecap="round">
      <path d="M3 4l2.5 4v4.5" />
      <path d="M8 4v8.5" />
      <circle cx="8" cy="4" r=".5" style={{ fill: 'var(--ic-yaml)' }} stroke="none" />
      <path d="M11 4v4l2 4.5" />
      <path d="M13 4v4l-2 4.5" />
    </svg>
  );
}

function PythonIcon() {
  return (
    <svg width={S} height={S} viewBox="0 0 16 16" fill="none" style={{ stroke: 'var(--ic-py)' }} strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 1.5c-3 0-3 1.5-3 2.5v2h3v.5H3.5S1.5 6 1.5 8.5 3 12 3 12h1.5V9.5A1.5 1.5 0 016 8h3.5A1.5 1.5 0 0011 6.5v-3C11 2 9.5 1.5 8 1.5z" />
      <path d="M8 14.5c3 0 3-1.5 3-2.5v-2h-3v-.5h4.5s2 .5 2-2S13 4 13 4h-1.5v2.5A1.5 1.5 0 0110 8H6.5A1.5 1.5 0 005 9.5v3C5 14 6.5 14.5 8 14.5z" />
      <circle cx="6" cy="3.8" r=".6" style={{ fill: 'var(--ic-py)' }} stroke="none" />
      <circle cx="10" cy="12.2" r=".6" style={{ fill: 'var(--ic-py)' }} stroke="none" />
    </svg>
  );
}

function SqlIcon() {
  return (
    <svg width={S} height={S} viewBox="0 0 16 16" fill="none" style={{ stroke: 'var(--ic-sql)' }} strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
      <ellipse cx="8" cy="4" rx="5" ry="2" />
      <path d="M3 4v8c0 1.1 2.2 2 5 2s5-.9 5-2V4" />
      <path d="M3 8c0 1.1 2.2 2 5 2s5-.9 5-2" />
    </svg>
  );
}

function PdfIcon() {
  return (
    <svg width={S} height={S} viewBox="0 0 16 16" style={{ fill: 'var(--ic-pdf)' }}>
      <path d="M4 1a1 1 0 00-1 1v12a1 1 0 001 1h8a1 1 0 001-1V5l-4-4H4z" opacity=".15" />
      <path d="M4 1a1 1 0 00-1 1v12a1 1 0 001 1h8a1 1 0 001-1V5l-4-4H4z" fill="none" style={{ stroke: 'var(--ic-pdf)' }} strokeWidth="1.1" />
      <path d="M9 1v4h4" fill="none" style={{ stroke: 'var(--ic-pdf)' }} strokeWidth="1.1" strokeLinejoin="round" />
      <text x="8" y="12" textAnchor="middle" fontSize="5.5" fontWeight="700" fontFamily="system-ui" stroke="none">PDF</text>
    </svg>
  );
}

const EXT_TO_ICON: Record<string, () => React.ReactElement> = {
  md: MarkdownIcon,
  markdown: MarkdownIcon,
  mdx: MarkdownIcon,
  html: HtmlIcon,
  htm: HtmlIcon,
  ts: TypeScriptIcon,
  tsx: TypeScriptIcon,
  mts: TypeScriptIcon,
  js: JavaScriptIcon,
  jsx: JavaScriptIcon,
  mjs: JavaScriptIcon,
  json: JsonIcon,
  css: CssIcon,
  scss: CssIcon,
  less: CssIcon,
  py: PythonIcon,
  pyw: PythonIcon,
  yaml: YamlIcon,
  yml: YamlIcon,
  sql: SqlIcon,
  png: ImageIcon,
  jpg: ImageIcon,
  jpeg: ImageIcon,
  gif: ImageIcon,
  webp: ImageIcon,
  svg: ImageIcon,
  bmp: ImageIcon,
  ico: ImageIcon,
  excalidraw: ExcalidrawIcon,
  pdf: PdfIcon,
};

const HANDLER_TO_ICON: Record<string, () => React.ReactElement> = {
  markdown: MarkdownIcon,
  html: HtmlIcon,
  code: CodeIcon,
  image: ImageIcon,
  excalidraw: ExcalidrawIcon,
  web: WebIcon,
};

export function FileIcon({ filename, isDir, isOpen }: FileIconProps) {
  if (isDir) {
    return <FolderIcon isOpen={isOpen} />;
  }
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  const IconFn = EXT_TO_ICON[ext];
  if (IconFn) return <IconFn />;
  return <DefaultFileIcon />;
}

export function getFileTypeIcon(handlerId: string): React.ReactElement {
  const IconFn = HANDLER_TO_ICON[handlerId];
  if (IconFn) return <IconFn />;
  return <DefaultFileIcon />;
}
