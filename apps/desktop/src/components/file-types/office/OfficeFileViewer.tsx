import { useEffect, useMemo, useState } from 'react';
import { readFile } from '@tauri-apps/plugin-fs';
import FileViewer from '@file-viewer/react';
import { isTauri } from '@/utils/platform';
import { resolvePreviewPath } from '../previewPath';
import { useResolvedTheme } from '@/hooks/useTheme';
import type { PreviewProps } from '../types';

/**
 * On-demand renderer loading (doc §56).
 *
 * Folyn startup loads NO Office renderer; opening a file dynamic-imports only
 * the renderer line it needs (docx → renderer-word, pptx →
 * renderer-presentation, …). The heavy CAD (~6.9MB WASM) and media
 * (hls.js/tonejs) renderers are loaded from a CDN when the opened file needs
 * them (kept here, unchanged). This replaces the prior static preset import,
 * which pulled every Office engine the moment any office file opened.
 *
 * The extension → renderer mapping is derived from @file-viewer's renderer
 * descriptors (formats lists); one dynamic import per renderer package.
 */
type RendererRef = { pkg: string; exp: string };

const RENDERER_FOR_EXT: Record<string, RendererRef> = {
  // PDF / OFD
  pdf: { pkg: '@file-viewer/renderer-pdf', exp: 'pdfRenderer' },
  ofd: { pkg: '@file-viewer/renderer-ofd', exp: 'ofdRenderer' },
  // Word
  doc: { pkg: '@file-viewer/renderer-word', exp: 'wordRenderer' },
  docx: { pkg: '@file-viewer/renderer-word', exp: 'wordRenderer' },
  docm: { pkg: '@file-viewer/renderer-word', exp: 'wordRenderer' },
  dot: { pkg: '@file-viewer/renderer-word', exp: 'wordRenderer' },
  dotx: { pkg: '@file-viewer/renderer-word', exp: 'wordRenderer' },
  dotm: { pkg: '@file-viewer/renderer-word', exp: 'wordRenderer' },
  rtf: { pkg: '@file-viewer/renderer-word', exp: 'wordRenderer' },
  odt: { pkg: '@file-viewer/renderer-word', exp: 'wordRenderer' },
  odp: { pkg: '@file-viewer/renderer-word', exp: 'wordRenderer' },
  // Presentation
  pptx: { pkg: '@file-viewer/renderer-presentation', exp: 'presentationRenderer' },
  pptm: { pkg: '@file-viewer/renderer-presentation', exp: 'presentationRenderer' },
  potx: { pkg: '@file-viewer/renderer-presentation', exp: 'presentationRenderer' },
  potm: { pkg: '@file-viewer/renderer-presentation', exp: 'presentationRenderer' },
  ppsx: { pkg: '@file-viewer/renderer-presentation', exp: 'presentationRenderer' },
  ppsm: { pkg: '@file-viewer/renderer-presentation', exp: 'presentationRenderer' },
  // Spreadsheet
  xls: { pkg: '@file-viewer/renderer-spreadsheet', exp: 'spreadsheetRenderer' },
  xlsx: { pkg: '@file-viewer/renderer-spreadsheet', exp: 'spreadsheetRenderer' },
  xlsm: { pkg: '@file-viewer/renderer-spreadsheet', exp: 'spreadsheetRenderer' },
  xlsb: { pkg: '@file-viewer/renderer-spreadsheet', exp: 'spreadsheetRenderer' },
  xltx: { pkg: '@file-viewer/renderer-spreadsheet', exp: 'spreadsheetRenderer' },
  xlt: { pkg: '@file-viewer/renderer-spreadsheet', exp: 'spreadsheetRenderer' },
  xltm: { pkg: '@file-viewer/renderer-spreadsheet', exp: 'spreadsheetRenderer' },
  ods: { pkg: '@file-viewer/renderer-spreadsheet', exp: 'spreadsheetRenderer' },
  fods: { pkg: '@file-viewer/renderer-spreadsheet', exp: 'spreadsheetRenderer' },
  numbers: { pkg: '@file-viewer/renderer-spreadsheet', exp: 'spreadsheetRenderer' },
  // Archive
  zip: { pkg: '@file-viewer/renderer-archive', exp: 'archiveRenderer' },
  zipx: { pkg: '@file-viewer/renderer-archive', exp: 'archiveRenderer' },
  '7z': { pkg: '@file-viewer/renderer-archive', exp: 'archiveRenderer' },
  rar: { pkg: '@file-viewer/renderer-archive', exp: 'archiveRenderer' },
  tar: { pkg: '@file-viewer/renderer-archive', exp: 'archiveRenderer' },
  gz: { pkg: '@file-viewer/renderer-archive', exp: 'archiveRenderer' },
  gzip: { pkg: '@file-viewer/renderer-archive', exp: 'archiveRenderer' },
  tgz: { pkg: '@file-viewer/renderer-archive', exp: 'archiveRenderer' },
  bz2: { pkg: '@file-viewer/renderer-archive', exp: 'archiveRenderer' },
  bzip2: { pkg: '@file-viewer/renderer-archive', exp: 'archiveRenderer' },
  tbz: { pkg: '@file-viewer/renderer-archive', exp: 'archiveRenderer' },
  tbz2: { pkg: '@file-viewer/renderer-archive', exp: 'archiveRenderer' },
  xz: { pkg: '@file-viewer/renderer-archive', exp: 'archiveRenderer' },
  txz: { pkg: '@file-viewer/renderer-archive', exp: 'archiveRenderer' },
  lzma: { pkg: '@file-viewer/renderer-archive', exp: 'archiveRenderer' },
  zst: { pkg: '@file-viewer/renderer-archive', exp: 'archiveRenderer' },
  cab: { pkg: '@file-viewer/renderer-archive', exp: 'archiveRenderer' },
  ar: { pkg: '@file-viewer/renderer-archive', exp: 'archiveRenderer' },
  cpio: { pkg: '@file-viewer/renderer-archive', exp: 'archiveRenderer' },
  iso: { pkg: '@file-viewer/renderer-archive', exp: 'archiveRenderer' },
  xar: { pkg: '@file-viewer/renderer-archive', exp: 'archiveRenderer' },
  lha: { pkg: '@file-viewer/renderer-archive', exp: 'archiveRenderer' },
  lzh: { pkg: '@file-viewer/renderer-archive', exp: 'archiveRenderer' },
  jar: { pkg: '@file-viewer/renderer-archive', exp: 'archiveRenderer' },
  war: { pkg: '@file-viewer/renderer-archive', exp: 'archiveRenderer' },
  ear: { pkg: '@file-viewer/renderer-archive', exp: 'archiveRenderer' },
  apk: { pkg: '@file-viewer/renderer-archive', exp: 'archiveRenderer' },
  cbz: { pkg: '@file-viewer/renderer-archive', exp: 'archiveRenderer' },
  cbr: { pkg: '@file-viewer/renderer-archive', exp: 'archiveRenderer' },
  // Email
  eml: { pkg: '@file-viewer/renderer-email', exp: 'emailRenderer' },
  msg: { pkg: '@file-viewer/renderer-email', exp: 'emailRenderer' },
  mbox: { pkg: '@file-viewer/renderer-email', exp: 'emailRenderer' },
  // EDA
  olb: { pkg: '@file-viewer/renderer-eda', exp: 'edaRenderer' },
  dra: { pkg: '@file-viewer/renderer-eda', exp: 'edaRenderer' },
  gds: { pkg: '@file-viewer/renderer-eda', exp: 'edaRenderer' },
  oas: { pkg: '@file-viewer/renderer-eda', exp: 'edaRenderer' },
  oasis: { pkg: '@file-viewer/renderer-eda', exp: 'edaRenderer' },
  // Geo
  geojson: { pkg: '@file-viewer/renderer-geo', exp: 'geoRenderer' },
  kml: { pkg: '@file-viewer/renderer-geo', exp: 'geoRenderer' },
  gpx: { pkg: '@file-viewer/renderer-geo', exp: 'geoRenderer' },
  shp: { pkg: '@file-viewer/renderer-geo', exp: 'geoRenderer' },
  kmz: { pkg: '@file-viewer/renderer-geo', exp: 'geoRenderer' },
  // 3D / model
  glb: { pkg: '@file-viewer/renderer-3d', exp: 'modelRenderer' },
  gltf: { pkg: '@file-viewer/renderer-3d', exp: 'modelRenderer' },
  obj: { pkg: '@file-viewer/renderer-3d', exp: 'modelRenderer' },
  stl: { pkg: '@file-viewer/renderer-3d', exp: 'modelRenderer' },
  ply: { pkg: '@file-viewer/renderer-3d', exp: 'modelRenderer' },
  fbx: { pkg: '@file-viewer/renderer-3d', exp: 'modelRenderer' },
  dae: { pkg: '@file-viewer/renderer-3d', exp: 'modelRenderer' },
  '3ds': { pkg: '@file-viewer/renderer-3d', exp: 'modelRenderer' },
  '3mf': { pkg: '@file-viewer/renderer-3d', exp: 'modelRenderer' },
  amf: { pkg: '@file-viewer/renderer-3d', exp: 'modelRenderer' },
  usd: { pkg: '@file-viewer/renderer-3d', exp: 'modelRenderer' },
  usda: { pkg: '@file-viewer/renderer-3d', exp: 'modelRenderer' },
  usdc: { pkg: '@file-viewer/renderer-3d', exp: 'modelRenderer' },
  usdz: { pkg: '@file-viewer/renderer-3d', exp: 'modelRenderer' },
  pcd: { pkg: '@file-viewer/renderer-3d', exp: 'modelRenderer' },
  wrl: { pkg: '@file-viewer/renderer-3d', exp: 'modelRenderer' },
  vrml: { pkg: '@file-viewer/renderer-3d', exp: 'modelRenderer' },
  xyz: { pkg: '@file-viewer/renderer-3d', exp: 'modelRenderer' },
  vtk: { pkg: '@file-viewer/renderer-3d', exp: 'modelRenderer' },
  vtp: { pkg: '@file-viewer/renderer-3d', exp: 'modelRenderer' },
  step: { pkg: '@file-viewer/renderer-3d', exp: 'modelRenderer' },
  stp: { pkg: '@file-viewer/renderer-3d', exp: 'modelRenderer' },
  iges: { pkg: '@file-viewer/renderer-3d', exp: 'modelRenderer' },
  igs: { pkg: '@file-viewer/renderer-3d', exp: 'modelRenderer' },
  ifc: { pkg: '@file-viewer/renderer-3d', exp: 'modelRenderer' },
  '3dm': { pkg: '@file-viewer/renderer-3d', exp: 'modelRenderer' },
  // Mindmap (read-only)
  xmind: { pkg: '@file-viewer/renderer-mindmap', exp: 'mindmapRenderer' },
  // Ebook
  epub: { pkg: '@file-viewer/renderer-epub', exp: 'ebookRenderer' },
  umd: { pkg: '@file-viewer/renderer-epub', exp: 'ebookRenderer' },
  // Image (supplement)
  tiff: { pkg: '@file-viewer/renderer-image', exp: 'imageRenderer' },
  tif: { pkg: '@file-viewer/renderer-image', exp: 'imageRenderer' },
  avif: { pkg: '@file-viewer/renderer-image', exp: 'imageRenderer' },
  heic: { pkg: '@file-viewer/renderer-image', exp: 'imageRenderer' },
  heif: { pkg: '@file-viewer/renderer-image', exp: 'imageRenderer' },
  jxl: { pkg: '@file-viewer/renderer-image', exp: 'imageRenderer' },
  // Font / design / data
  ttf: { pkg: '@file-viewer/renderer-text', exp: 'textRenderer' },
  otf: { pkg: '@file-viewer/renderer-text', exp: 'textRenderer' },
  woff: { pkg: '@file-viewer/renderer-text', exp: 'textRenderer' },
  woff2: { pkg: '@file-viewer/renderer-text', exp: 'textRenderer' },
  psd: { pkg: '@file-viewer/renderer-image', exp: 'imageRenderer' },
  ai: { pkg: '@file-viewer/renderer-image', exp: 'imageRenderer' },
  eps: { pkg: '@file-viewer/renderer-image', exp: 'imageRenderer' },
  sqlite: { pkg: '@file-viewer/renderer-data', exp: 'dataRenderer' },
  wasm: { pkg: '@file-viewer/renderer-data', exp: 'dataRenderer' },
  parquet: { pkg: '@file-viewer/renderer-data', exp: 'dataRenderer' },
  avro: { pkg: '@file-viewer/renderer-data', exp: 'dataRenderer' },
  webarchive: { pkg: '@file-viewer/renderer-data', exp: 'dataRenderer' },
  // CAD (kept on CDN — 6.9MB WASM) via the needsCad branch below.
  // Media (hls.js/tonejs) via the needsMedia branch below.
};

// The renderer preset type comes from @file-viewer/core
// (FileViewerRendererPresetInput[]); kept loose here since the renderer
// lines are dynamic-imported (unknown) and the host narrows at the
// options site.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Preset = any[];

// ponytail: CAD (~6.9MB WASM) and media (hls.js/tonejs) renderers are NOT
// bundled — loaded from CDN at runtime when the opened file needs them.
const CDN_BASE = 'https://cdn.jsdelivr.net/npm';
const ESM_FALLBACK_BASE = 'https://esm.sh';
const CAD_RENDERER_VERSION = '2.1.30';
const CAD_VIEWER_VERSION = '0.6.6';
const MEDIA_RENDERER_VERSION = '2.1.30';
// Base renderer packages (word/presentation/spreadsheet/pdf/…) ship on the
// same @file-viewer cadence as cad/media; loaded from CDN on demand (doc §56)
// rather than bundled, so startup pulls none.
const BASE_RENDERER_VERSION = '2.1.30';
const CAD_WASM_BASE = `${CDN_BASE}/@flyfish-dev/cad-viewer@${CAD_VIEWER_VERSION}/dist/wasm/`;

const CAD_EXTENSIONS = new Set(['dwg', 'dxf', 'dwf', 'dwfx', 'xps']);
const MEDIA_EXTENSIONS = new Set([
  'mp3', 'mpeg', 'wav', 'ogg', 'oga', 'opus', 'm4a', 'aac', 'flac', 'weba',
  'midi', 'mid', 'mp4', 'webm', 'm3u8',
]);

function getFileExtension(filePath: string): string {
  return filePath.split('.').pop()?.toLowerCase() || '';
}

async function probe(url: string): Promise<boolean> {
  try { return (await fetch(url, { method: 'HEAD' })).ok; } catch { return false; }
}

async function pickEsmUrl(pkg: string, ver: string): Promise<string> {
  const primary = `${CDN_BASE}/${pkg}@${ver}/+esm`;
  if (await probe(primary)) return primary;
  return `${ESM_FALLBACK_BASE}/${pkg}@${ver}`;
}

export function OfficeFileViewer({ filePath, vaultRoot }: PreviewProps) {
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [preset, setPreset] = useState<Preset | null>(null);
  const theme = useResolvedTheme();

  const ext = getFileExtension(filePath);
  const needsCad = CAD_EXTENSIONS.has(ext);
  const needsMedia = MEDIA_EXTENSIONS.has(ext);
  const rendererRef = !needsCad && !needsMedia ? RENDERER_FOR_EXT[ext] : undefined;

  useEffect(() => {
    let cancelled = false;
    // ── On-demand renderer loading (doc §56) ──
    // Dynamic-import ONLY the renderer line the opened file needs (word /
    // presentation / spreadsheet / pdf / archive / …). CAD + media stay on
    // CDN (heavy WASM / streaming). An unknown extension → no renderer line;
    // FileViewer falls back to its built-ins or shows the import error.
    const rendererImport: Promise<Record<string, unknown> | null> = rendererRef
      ? pickEsmUrl(rendererRef.pkg, BASE_RENDERER_VERSION)
          .then((url) => import(/* @vite-ignore */ url))
          .then((m) => {
            const fn = (m as Record<string, unknown>)[rendererRef.exp];
            return fn ? { renderer: fn } : null;
          })
          .catch((e: unknown) => {
            throw new Error(`渲染器加载失败：${e instanceof Error ? e.message : String(e)}`);
          })
      : Promise.resolve(null);
    const cadImport: Promise<Record<string, unknown> | null> = needsCad
      ? pickEsmUrl('@file-viewer/renderer-cad', CAD_RENDERER_VERSION)
          .then((url) => import(/* @vite-ignore */ url))
          .then((m) => m as Record<string, unknown>)
          .catch((e: unknown) => {
            throw new Error(`CAD 渲染器加载失败：${e instanceof Error ? e.message : String(e)}`);
          })
      : Promise.resolve(null);
    const mediaImport: Promise<Record<string, unknown> | null> = needsMedia
      ? pickEsmUrl('@file-viewer/renderer-media', MEDIA_RENDERER_VERSION)
          .then((url) => import(/* @vite-ignore */ url))
          .then((m) => m as Record<string, unknown>)
          .catch((e: unknown) => {
            throw new Error(`媒体渲染器加载失败：${e instanceof Error ? e.message : String(e)}`);
          })
      : Promise.resolve(null);

    Promise.all([rendererImport, cadImport, mediaImport]).then(([rMod, cadMod, mediaMod]) => {
      if (cancelled) return;
      const merged: unknown[] = [];
      if (rMod?.renderer) merged.push(rMod.renderer);
      if (cadMod) {
        const cad = cadMod.cadRenderer ?? cadMod.default;
        if (cad) merged.push(cad);
      }
      if (mediaMod) {
        const media = mediaMod.mediaRenderer ?? mediaMod.default;
        if (media) merged.push(media);
      }
      setPreset(merged as unknown as Preset);
    }).catch((e: unknown) => {
      if (!cancelled) setError(e instanceof Error ? e.message : String(e));
    });
    return () => { cancelled = true; };
  }, [ext, needsCad, needsMedia, rendererRef]);

  useEffect(() => {
    if (!filePath || !vaultRoot) {
      setError('文件路径或 vault 根目录为空');
      setLoading(false);
      return;
    }

    if (!isTauri()) {
      setError('Office 预览仅在桌面端可用');
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    (async () => {
      try {
        const abs = await resolvePreviewPath(filePath, vaultRoot);
        const bytes = await readFile(abs);
        if (cancelled) return;
        const name = filePath.split('/').pop() || 'file';
        setFile(new File([bytes], name));
      } catch (e: unknown) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [filePath, vaultRoot]);

  const cadOptions = useMemo(() => needsCad ? {
    workerUrl: '/wasm/dwg-worker.js',
    wasmPath: CAD_WASM_BASE,
    dwfWasmUrl: `${CAD_WASM_BASE}dwfv-render.wasm`,
  } : undefined, [needsCad]);

  const viewerOptions = useMemo(() => ({
    preset: preset ?? undefined,
    cad: cadOptions,
    theme,
    messages: {
      'spreadsheet.state.rows': '共 {rows} 行',
      'spreadsheet.state.rowsAndColumns': '共 {rows} 行，{cols} 列',
    },
  }), [preset, cadOptions, theme]);

  return (
    <div className="h-full w-full overflow-y-auto overflow-x-hidden bg-panel">
      {loading && <div className="flex h-full items-center justify-center text-t3 text-[13px]">加载中…</div>}
      {error && (
        <div className="flex h-full items-center justify-center text-t3 text-[13px] text-red-500">
          无法加载文件：{error}
        </div>
      )}
      {!loading && !error && file && preset && (
        <FileViewer
          key={theme}
          data-viewer-theme={theme}
          file={file}
          options={viewerOptions}
          style={{ height: '100%', width: '100%' }}
        />
      )}
    </div>
  );
}
