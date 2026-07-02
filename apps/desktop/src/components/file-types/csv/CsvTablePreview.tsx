import { useMemo } from 'react';
import type { PreviewProps } from '../types';
import { parseCsv } from '@/utils/csvParse';

/**
 * Read-only CSV table preview. Parses raw CSV content into rows via the
 * RFC-4180 `parseCsv` parser, then renders the first row as a styled header
 * (`<thead>`) and the rest as body rows (`<tbody>`). Jagged rows are rendered
 * as-is (whatever cells exist per row). Empty/unparseable content falls back
 * to a muted hint.
 */
export function CsvTablePreview({ content }: PreviewProps) {
  const rows = useMemo(() => parseCsv(content), [content]);

  if (rows.length === 0) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-t3 text-sm">
        CSV 为空或无法解析
      </div>
    );
  }

  const [headerRow, ...bodyRows] = rows;

  return (
    <div className="csv-table-preview h-full w-full overflow-auto bg-panel">
      <table className="w-full border-collapse text-sm">
        {headerRow && (
          <thead>
            <tr>
              {headerRow.map((cell, i) => (
                <th
                  key={i}
                  className="border border-brd2 px-3 py-1.5 text-left font-semibold text-t1 whitespace-nowrap sticky top-0 z-10 bg-hov"
                >
                  {cell}
                </th>
              ))}
            </tr>
          </thead>
        )}
        <tbody>
          {bodyRows.map((row, r) => (
            <tr key={r} className="even:bg-hov/40">
              {row.map((cell, c) => (
                <td
                  key={c}
                  className="border border-brd2 px-3 py-1.5 text-t2 whitespace-nowrap align-top"
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
