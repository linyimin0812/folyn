/**
 * FileViewer host inside the extension's iframe (`preview.html`).
 *
 * Receives `{ name, bytes, theme }` from the host wrapper (OfficeFrame) via
 * postMessage and renders it with @file-viewer/react. All renderers are
 * bundled locally (esbuild/vite inlines every @file-viewer/renderer-* dep) and
 * run with full Worker/WASM support because this frame has a real
 * `folyn-plugin://` origin.
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
import { cadRenderer } from '@file-viewer/renderer-cad';
import { mediaRenderer } from '@file-viewer/renderer-media';

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
  cadRenderer,
  mediaRenderer,
];

interface Incoming {
  type: string;
  name?: string;
  bytes?: ArrayBuffer;
  theme?: 'light' | 'dark';
}

export function OfficeFileViewer(): React.JSX.Element {
  const [file, setFile] = useState<File | null>(null);
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Tell the host wrapper we're ready to receive the document.
    window.parent.postMessage({ type: 'folyn-file-viewer:ready' }, '*');

    const onMessage = (ev: MessageEvent) => {
      const d = ev.data as Incoming | null;
      if (!d || d.type !== 'folyn-file-viewer:open') return;
      try {
        if (d.theme) setTheme(d.theme);
        if (!d.bytes) throw new Error('no bytes received');
        setFile(new File([d.bytes], d.name || 'file'));
        setError(null);
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : String(e));
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  const options = useMemo(() => ({
    preset: PRESET,
    theme,
    messages: {
      'spreadsheet.state.rows': '共 {rows} 行',
      'spreadsheet.state.rowsAndColumns': '共 {rows} 行，{cols} 列',
    },
  }), [theme]);

  if (error) {
    return <div style={{ padding: 24, color: '#e05252', fontSize: 13 }}>无法加载文件：{error}</div>;
  }
  if (!file) {
    return <div style={{ padding: 24, color: '#888', fontSize: 13 }}>加载中…</div>;
  }
  return (
    <FileViewer
      key={theme}
      data-viewer-theme={theme}
      file={file}
      options={options}
      style={{ height: '100vh', width: '100vw' }}
    />
  );
}
