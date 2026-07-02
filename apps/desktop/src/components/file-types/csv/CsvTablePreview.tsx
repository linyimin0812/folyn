import { useMemo } from 'react';
import type { PreviewProps } from '../types';
import { parseCsv } from '@/utils/csvParse';

const MIN_COLS = 10;
const MIN_ROWS = 60;

const pad = (r: string[], colCount: number): string[] => {
  const out = r.slice();
  while (out.length < colCount) out.push('');
  return out;
};

/**
 * Read-only CSV table preview. Parses raw CSV content into rows via the
 * RFC-4180 `parseCsv` parser, then renders the first row as a styled header
 * (`<thead>`) and the rest as body rows (`<tbody>`). The grid always renders
 * and fills the page: columns are padded to at least `MIN_COLS`, and body
 * rows are padded with empty filler rows up to `MIN_ROWS` so an Excel-like
 * empty grid is shown even for empty or short files.
 */
export function CsvTablePreview({ content }: PreviewProps) {
  const rows = useMemo(() => parseCsv(content), [content]);

  const colCount = Math.max(MIN_COLS, ...rows.map((r) => r.length));
  const headerRow = rows.length ? pad(rows[0], colCount) : Array(colCount).fill('');
  const bodyRows = rows.length ? rows.slice(1).map((r) => pad(r, colCount)) : [];
  const fillerCount = Math.max(0, MIN_ROWS - bodyRows.length);
  const fillers = Array.from({ length: fillerCount }, () => Array(colCount).fill(''));
  const allBodyRows = [...bodyRows, ...fillers];

  return (
    <div className="csv-table-preview h-full w-full overflow-auto bg-panel">
      <table className="w-full border-collapse text-sm">
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
        <tbody>
          {allBodyRows.map((row, r) => (
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
