/**
 * File-type icons owned by the file-viewer extension.
 *
 * The app's `<FileIcon>` consults a registered handler's `icon` (ReactNode)
 * at render time. To keep distinct icons per family without a per-extension
 * API, the extension registers ONE provider per family, each carrying its own
 * icon. These are inline SVGs (no app assets, no CDN) so the extension is
 * self-contained.
 *
 * 16×16, viewBox 0 0 16 16. A shared `<File>` silhouette (rounded page with a
 * folded corner) is tinted per family; a small glyph distinguishes the kind.
 */
import type { ReactElement } from 'react';

const S = 16;

/** Shared page silhouette. Fill = family accent; the fold stays the page
 * shade so the corner reads. */
function File({ fill, glyph }: { fill: string; glyph?: ReactElement }) {
  return (
    <svg width={S} height={S} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M3 1.5h6.2L13 5.3v9.2a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V1.5Z" fill={fill} />
      <path d="M9.2 1.5 13 5.3H9.2V1.5Z" fill="#ffffff" fillOpacity="0.35" />
      {glyph}
    </svg>
  );
}

/** White glyph drawn inside the colored page. */
function W(d: string, opts: { stroke?: string; sw?: number } = {}) {
  const stroke = opts.stroke ?? '#fff';
  const sw = opts.sw ?? 1.3;
  return (
    <path d={d} stroke={stroke} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" fill="none" />
  );
}

const BLUE = '#2b6cb0';
const ORANGE = '#c05621';
const GREEN = '#2f855a';
const RED = '#c53030';
const YELLOW = '#b7791f';
const PURPLE = '#6b46c1';
const PINK = '#b83280';
const TEAL = '#0d9488';
const INDIGO = '#4c51bf';
const BROWN = '#9c4221';
const GRAY = '#4a5568';
const SLATE = '#475569';

export const DocIcon = () => <File fill={BLUE} glyph={<>{W('M5 6h6')}{W('M5 8.5h6')}{W('M5 11h4')}</>} />;
export const PresentationIcon = () => <File fill={ORANGE} glyph={<>{W('M4.5 6h7')}{W('M8 6v4.5')}{W('M5.5 10.5h5')}</>} />;
export const SpreadsheetIcon = () => <File fill={GREEN} glyph={<>{W('M4.5 6h7M4.5 8.5h7M4.5 11h7M7.5 5.5v6M10 5.5v6')}</>} />;
export const PdfIcon = () => <File fill={RED} glyph={<>{W('M5 6h3.5a1.5 1.5 0 0 1 0 3H6.2', { sw: 1.1 })}{W('M6.2 9v2.2', { sw: 1.1 })}</>} />;
export const ArchiveIcon = () => <File fill={YELLOW} glyph={<>{W('M6 4.5h4')}{W('M8 4.5v1.5')}{W('M6 6.5h4')}{W('M8 6.5v1.5')}{W('M6 8.5h4')}{W('M8 8.5v1.5')}</>} />;
export const EmailIcon = () => <File fill={GRAY} glyph={W('M3.5 6.5h9v4.5h-9zM3.5 6.5l4.5 3 4.5-3')} />;
export const CadIcon = () => <File fill={BLUE} glyph={<>{W('M4 11.5 11 4.5')}{W('M9 4.5h2v2')}</>} />;
export const Model3dIcon = () => <File fill={INDIGO} glyph={<>{W('M8 4.5l3 1.75v3.5L8 11.5 5 9.75v-3.5L8 4.5Z')}{W('M8 4.5v7M5 6.25l3 1.75 3-1.75')}</>} />;
export const EbookIcon = () => <File fill={BROWN} glyph={W('M4 5.5c0-.5.4-1 1-1h6c.6 0 1 .5 1 1v6c0 .5-.4 1-1 1H5c-.6 0-1-.5-1-1v-6Z')} />;
export const ImageIcon = () => <File fill={TEAL} glyph={<>{W('M4 11l2.5-3 2 2 1.5-2L12 11')}{W('M4 11h8')}</>} />;
export const AudioIcon = () => <File fill={PURPLE} glyph={<>{W('M7 4.5v6')}{W('M7 4.5l3.5 1v6')}{W('M7 10.5a1 1 0 1 0-2 0 1 1 0 0 0 2 0Z')}{W('M10.5 5.5a1 1 0 1 0-2 0 1 1 0 0 0 2 0Z')}</>} />;
export const VideoIcon = () => <File fill={PINK} glyph={W('M5 6.5h4.5l2-1.8v6.6l-2-1.8H5Z')} />;
export const FontIcon = () => <File fill={SLATE} glyph={<>{W('M6 11l2-5 2 5')}{W('M6.4 9.5h3.2')}</>} />;
export const DataIcon = () => <File fill={SLATE} glyph={<>{W('M5 5.5c0 .8 1.3 1.5 3 1.5s3-.7 3-1.5S9.7 4 8 4 5 4.7 5 5.5Z')}{W('M5 5.5v5c0 .8 1.3 1.5 3 1.5s3-.7 3-1.5v-5')}</>} />;

/** Fallback for families without a dedicated glyph (geo / eda / mindmap / misc). */
export const GenericFileIcon = () => <File fill={SLATE} />;
