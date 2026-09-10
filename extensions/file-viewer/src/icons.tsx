/**
 * File-type icons owned by the file-viewer extension.
 *
 * The app's `<FileIcon>` consults a registered handler's `icon` (ReactNode)
 * at render time. To keep distinct icons per family without a per-extension
 * API, the extension registers ONE provider per family, each carrying its own
 * icon.
 *
 * The six core office families use the SVG assets moved here from the app
 * (`doc.svg` / `audio.svg` / `pack.svg` / `pdf.svg` / `presentation.svg` /
 * `spreadsheet.svg`); esbuild inlines them as `data:` URLs so the host bundle
 * is self-contained (no CDN, no app assets). `spreadsheet.svg` is a COPY —
 * the app keeps its own because the builtin `csv` handler still uses it.
 *
 * Families without a migrated asset (cad / 3d / ebook / email / font / data /
 * misc) fall back to small inline SVGs.
 */
import type { ReactElement } from 'react';

// Migrated app assets (inlined as data URLs by esbuild's `.svg: 'dataurl'`).
import docUrl from './icons/doc.svg';
import presentationUrl from './icons/presentation.svg';
import spreadsheetUrl from './icons/spreadsheet.svg';
import pdfUrl from './icons/pdf.svg';
import packUrl from './icons/pack.svg';
import audioUrl from './icons/audio.svg';

const S = 16;

/** Wrap a data-URL string in a sized <img> (matches the app's ThemeIcon). */
function svg(url: string): ReactElement {
  return (
    <img
      src={url}
      width={S}
      height={S}
      alt=""
      style={{ display: 'block', flexShrink: 0, width: S, height: S }}
    />
  );
}

export const DocIcon = () => svg(docUrl);
export const PresentationIcon = () => svg(presentationUrl);
export const SpreadsheetIcon = () => svg(spreadsheetUrl);
export const PdfIcon = () => svg(pdfUrl);
export const ArchiveIcon = () => svg(packUrl);
export const AudioIcon = () => svg(audioUrl);

// ── Inline fallbacks for families without a migrated asset ─────────────────
function File({ fill, glyph }: { fill: string; glyph?: ReactElement }) {
  return (
    <svg width={S} height={S} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M3 1.5h6.2L13 5.3v9.2a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V1.5Z" fill={fill} />
      <path d="M9.2 1.5 13 5.3H9.2V1.5Z" fill="#ffffff" fillOpacity="0.35" />
      {glyph}
    </svg>
  );
}
function W(d: string, sw = 1.3) {
  return (
    <path d={d} stroke="#fff" strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" fill="none" />
  );
}

const BLUE = '#2b6cb0';
const INDIGO = '#4c51bf';
const BROWN = '#9c4221';
const TEAL = '#0d9488';
const PINK = '#b83280';
const SLATE = '#475569';

export const EmailIcon = () => <File fill={SLATE} glyph={W('M3.5 6.5h9v4.5h-9zM3.5 6.5l4.5 3 4.5-3')} />;
export const CadIcon = () => <File fill={BLUE} glyph={<>{W('M4 11.5 11 4.5')}{W('M9 4.5h2v2')}</>} />;
export const Model3dIcon = () => <File fill={INDIGO} glyph={<>{W('M8 4.5l3 1.75v3.5L8 11.5 5 9.75v-3.5L8 4.5Z')}{W('M8 4.5v7M5 6.25l3 1.75 3-1.75')}</>} />;
export const EbookIcon = () => <File fill={BROWN} glyph={W('M4 5.5c0-.5.4-1 1-1h6c.6 0 1 .5 1 1v6c0 .5-.4 1-1 1H5c-.6 0-1-.5-1-1v-6Z')} />;
export const ImageIcon = () => <File fill={TEAL} glyph={<>{W('M4 11l2.5-3 2 2 1.5-2L12 11')}{W('M4 11h8')}</>} />;
export const VideoIcon = () => <File fill={PINK} glyph={W('M5 6.5h4.5l2-1.8v6.6l-2-1.8H5Z')} />;
export const FontIcon = () => <File fill={SLATE} glyph={<>{W('M6 11l2-5 2 5')}{W('M6.4 9.5h3.2')}</>} />;
export const DataIcon = () => <File fill={SLATE} glyph={<>{W('M5 5.5c0 .8 1.3 1.5 3 1.5s3-.7 3-1.5S9.7 4 8 4 5 4.7 5 5.5Z')}{W('M5 5.5v5c0 .8 1.3 1.5 3 1.5s3-.7 3-1.5v-5')}</>} />;
export const GenericFileIcon = () => <File fill={SLATE} />;
