import { useMemo } from 'react';
import FileViewer from '@file-viewer/react';
import officePreset from '@file-viewer/preset-office';
import type { PreviewProps } from '../types';
import './csv-preview.css';

export function CsvFileViewerPreview({ content, filePath }: PreviewProps) {
  const file = useMemo(() => {
    const name = filePath.split('/').pop() || 'data.csv';
    return new File([content ?? ''], name, { type: 'text/csv' });
  }, [content, filePath]);

  return (
    <div className="csv-preview-container h-full w-full overflow-hidden bg-panel">
      <FileViewer file={file} options={{ preset: officePreset }} style={{ height: '100%', width: '100%' }} />
    </div>
  );
}
