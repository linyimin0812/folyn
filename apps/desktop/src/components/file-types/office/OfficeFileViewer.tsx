import { useEffect, useMemo, useState } from 'react';
import { readFile } from '@tauri-apps/plugin-fs';
import { join } from '@tauri-apps/api/path';
import FileViewer from '@file-viewer/react';
import { isTauri } from '@/utils/platform';
import { resolveBasePath } from '@/utils/pathResolver';
import type { PreviewProps } from '../types';

type PresetModule = typeof import('virtual:file-viewer-renderers');
type Preset = PresetModule['default'];

// ponytail: CAD (~6.9MB WASM) and media (hls.js/tonejs) renderers are NOT
// bundled — loaded from CDN at runtime when the opened file needs them.
// ESM CDN has esm.sh fallback (jsDelivr +esm is primary). Raw WASM/asset URLs
// stay on jsDelivr only. If CDN is unreachable the viewer shows the import
// error; no retry.
const CDN_BASE = 'https://cdn.jsdelivr.net/npm';
const ESM_FALLBACK_BASE = 'https://esm.sh';
const CAD_RENDERER_VERSION = '2.1.30';
const CAD_VIEWER_VERSION = '0.6.6';
const MEDIA_RENDERER_VERSION = '2.1.30';
// cad-viewer's wasm/worker live in @flyfish-dev/cad-viewer/dist/wasm/ on npm.
// jsDelivr serves npm package files at /npm/<pkg>@<ver>/<path>.
const CAD_WASM_BASE = `${CDN_BASE}/@flyfish-dev/cad-viewer@${CAD_VIEWER_VERSION}/dist/wasm/`;

const CAD_EXTENSIONS = new Set(['dwg', 'dxf', 'dwf', 'dwfx', 'xps']);
const MEDIA_EXTENSIONS = new Set([
  'mp3', 'mpeg', 'wav', 'ogg', 'oga', 'opus', 'm4a', 'aac', 'flac', 'weba',
  'midi', 'mid', 'mp4', 'webm', 'm3u8',
]);

function getFileExtension(filePath: string): string {
  return filePath.split('.').pop()?.toLowerCase() || '';
}

// ponytail: probe jsDelivr first; fall back to esm.sh (rewrites bare imports
// server-side, same shape as +esm). Default to jsDelivr if probe fails.
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

  const ext = getFileExtension(filePath);
  const needsCad = CAD_EXTENSIONS.has(ext);
  const needsMedia = MEDIA_EXTENSIONS.has(ext);

  useEffect(() => {
    let cancelled = false;
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

    Promise.all([
      import('virtual:file-viewer-renderers').then((m) => m.default as unknown as unknown[]),
      cadImport,
      mediaImport,
    ]).then(([bundledEntries, cadMod, mediaMod]) => {
      if (cancelled) return;
      const merged: unknown[] = Array.isArray(bundledEntries) ? [...bundledEntries] : [bundledEntries];
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
    return () => {
      cancelled = true;
    };
  }, [needsCad, needsMedia]);

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
        const base = await resolveBasePath(vaultRoot);
        const abs = await join(base, filePath);
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

    return () => {
      cancelled = true;
    };
  }, [filePath, vaultRoot]);

  // ponytail: dwg-worker.js is a module worker that resolves its sibling
  // libredwg-web.js via location.origin + /wasm/libredwg-web.js — both must be
  // same-origin (bundled by vite copyCadWorkerAssets plugin). The 6MB
  // libredwg-web.wasm stays on CDN via wasmPath; jsDelivr sends CORS-* so the
  // cross-origin WASM fetch works. Only set when needsCad; FileViewer ignores
  // options.cad for non-CAD files.
  const cadOptions = useMemo(() => needsCad ? {
    workerUrl: '/wasm/dwg-worker.js',
    wasmPath: CAD_WASM_BASE,
    dwfWasmUrl: `${CAD_WASM_BASE}dwfv-render.wasm`,
  } : undefined, [needsCad]);

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
          file={file}
          options={{
            preset,
            cad: cadOptions,
            messages: {
              'spreadsheet.state.rows': '共 {rows} 行',
              'spreadsheet.state.rowsAndColumns': '共 {rows} 行，{cols} 列',
            },
          }}
          style={{ height: '100%', width: '100%' }}
        />
      )}
    </div>
  );
}
