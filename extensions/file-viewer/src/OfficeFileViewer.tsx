/**
 * OfficeFileViewer — renders office / archive / dataset / media files via
 * @file-viewer/react. Renderers are bundled locally (esbuild inlines every
 * @file-viewer/renderer-* dep) — no CDN fetch at runtime.
 *
 * File bytes come from the host capability `api.vault.readBinary(filePath)`
 * (vault-scoped); the viewer never touches Tauri directly.
 */
import { useEffect, useMemo, useState } from 'react';
import FileViewer from '@file-viewer/react';
import { officeRenderers } from '@file-viewer/preset-office';
import { archiveRenderer } from '@file-viewer/renderer-archive';
import { dataRenderer } from '@file-viewer/renderer-data';
import { drawingRenderer } from '@file-viewer/renderer-drawing';
import { edaRenderer } from '@file-viewer/renderer-eda';
import { emailRenderer } from '@file-viewer/renderer-email';
import { ebookRenderer } from '@file-viewer/renderer-epub';
import { geoRenderer } from '@file-viewer/renderer-geo';
import { imageRenderer } from '@file-viewer/renderer-image';
import { mindmapRenderer } from '@file-viewer/renderer-mindmap';
import { modelRenderer } from '@file-viewer/renderer-3d';
import type { PreviewProps } from 'folyn-plugin-sdk';
import { getApi } from './api';

/** All renderer lines bundled into the extension (local, no CDN). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const PRESET: any[] = [
  ...(officeRenderers.renderers as unknown[]),
  archiveRenderer,
  dataRenderer,
  drawingRenderer,
  edaRenderer,
  emailRenderer,
  ebookRenderer,
  geoRenderer,
  imageRenderer,
  mindmapRenderer,
  modelRenderer,
];

/** Read the host theme (`<html data-theme>`), reacting to changes. */
function useHostTheme(): 'light' | 'dark' {
  const [theme, setTheme] = useState<'light' | 'dark'>(
    () => (document.documentElement.dataset.theme as 'light' | 'dark') ?? 'light',
  );
  useEffect(() => {
    const el = document.documentElement;
    const apply = () => {
      const t = el.dataset.theme;
      if (t === 'light' || t === 'dark') setTheme(t);
    };
    apply();
    const obs = new MutationObserver(apply);
    obs.observe(el, { attributes: true, attributeFilter: ['data-theme'] });
    return () => obs.disconnect();
  }, []);
  return theme;
}

export function OfficeFileViewer({ filePath }: PreviewProps): React.JSX.Element {
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const theme = useHostTheme();

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const bytes = await getApi().vault.readBinary(filePath);
        if (cancelled) return;
        const name = filePath.split('/').pop() || 'file';
        setFile(new File([bytes as BlobPart], name));
      } catch (e: unknown) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [filePath]);

  const options = useMemo(() => ({
    preset: PRESET,
    theme,
    messages: {
      'spreadsheet.state.rows': '共 {rows} 行',
      'spreadsheet.state.rowsAndColumns': '共 {rows} 行，{cols} 列',
    },
  }), [theme]);

  return (
    <div className="h-full w-full overflow-y-auto overflow-x-hidden bg-panel">
      {loading && <div className="flex h-full items-center justify-center text-t3 text-[13px]">加载中…</div>}
      {error && (
        <div className="flex h-full items-center justify-center text-t3 text-[13px] text-red-500">
          无法加载文件：{error}
        </div>
      )}
      {!loading && !error && file && (
        <FileViewer
          key={theme}
          data-viewer-theme={theme}
          file={file}
          options={options}
          style={{ height: '100%', width: '100%' }}
        />
      )}
    </div>
  );
}
