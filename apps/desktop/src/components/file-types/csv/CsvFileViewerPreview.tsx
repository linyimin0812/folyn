import { useMemo } from 'react';
import FileViewer from '@file-viewer/react';
import officePreset from '@file-viewer/preset-office';
import type { PreviewProps } from '../types';

export function CsvFileViewerPreview({ content, filePath }: PreviewProps) {
  const file = useMemo(() => {
    const name = filePath.split('/').pop() || 'data.csv';
    return new File([content ?? ''], name, { type: 'text/csv' });
  }, [content, filePath]);

  return (
    <div className="h-full w-full overflow-hidden bg-panel">
      <FileViewer
        file={file}
        options={{
          preset: officePreset,
          messages: {
            'spreadsheet.state.rows': '共 {rows} 行',
            'spreadsheet.state.rowsAndColumns': '共 {rows} 行，{cols} 列',
          },
        }}
        style={{ height: '100%', width: '100%' }}
      />
    </div>
  );
}
