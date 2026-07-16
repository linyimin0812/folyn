import { useEffect, useMemo, useState } from 'react';
import FileViewer from '@file-viewer/react';
import type { PreviewProps } from '../types';

type PresetModule = typeof import('virtual:file-viewer-renderers');

export function CsvFileViewerPreview({ content, filePath }: PreviewProps) {
  const file = useMemo(() => {
    const name = filePath.split('/').pop() || 'data.csv';
    const body = content ?? '';
    // SheetJS decodes BOM-less UTF-8 CSV as latin-1 by default → mojibake.
    // Prepend a UTF-8 BOM so it takes the UTF-8 path; don't double-prefix.
    const prefixed = body.startsWith('\uFEFF') ? body : `\uFEFF${body}`;
    return new File([prefixed], name, { type: 'text/csv' });
  }, [content, filePath]);

  // ponytail: the vite-plugin emits a virtual module aggregating the selected
  // renderer lines. Dynamic-import it so the renderers split into an on-demand
  // chunk instead of the entry bundle.
  const [preset, setPreset] = useState<PresetModule['default'] | null>(null);
  useEffect(() => {
    let cancelled = false;
    import('virtual:file-viewer-renderers')
      .then((m) => {
        if (!cancelled) setPreset(() => m.default);
      })
      .catch(() => {
        // preset load failure leaves the viewer unrendered; nothing to surface here.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="h-full w-full overflow-hidden bg-panel">
      {preset && (
        <FileViewer
          file={file}
          options={{
            preset,
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
