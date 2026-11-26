import { useRef, useState } from 'react';
import { createElement } from 'react';
import type { ReactNode } from 'react';
import { Copy, Check, Maximize2 } from 'lucide-react';
import { FocusViewShell } from './FocusViewShell';

interface TableFocusWrapProps {
  sourceLine: number | undefined;
  /** Props for the <table> element (data-source-line, className, …). */
  tableProps: Record<string, unknown>;
  // ponytail: createElement(TableFocusWrap, {...}, children) injects children
  // at runtime; making it required trips TS2769 (same as ResizableMedia).
  children?: ReactNode;
}

/** Extract the table as TSV: cell textContent joined with tabs, rows with
 *  newlines — paste straight into a spreadsheet. */
function tableToTsv(table: HTMLTableElement): string {
  const rows = Array.from(table.rows);
  return rows.map((row) =>
    Array.from(row.cells).map((c) => (c.textContent ?? '').trim().replace(/\s+/g, ' ')).join('\t'),
  ).join('\n');
}

/**
 * Focusable table wrapper (5.4 专注查看): same DOM contract as the plain
 * div wrapper it replaces — a root-level block carrying data-source-line,
 * .md-table-wrap inside handling the horizontal scroll frame, the <table>
 * last-in-DOM so it keeps winning cursor-sync line ties. The root adds only
 * a hover-revealed 专注查看 entry; the focus view re-renders the same table
 * element inside a FocusViewShell (full-card width, copy as TSV).
 */
export function TableFocusWrap({ sourceLine, tableProps, children }: TableFocusWrapProps) {
  const [focused, setFocused] = useState(false);
  const [copied, setCopied] = useState(false);
  const hostRef = useRef<HTMLDivElement>(null);

  const handleCopy = async () => {
    const table = hostRef.current?.querySelector('table');
    if (!table) return;
    const tsv = tableToTsv(table);
    try {
      await navigator.clipboard.writeText(tsv);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch { /* clipboard unavailable (permissions, tests) — no-op */ }
  };

  const title = sourceLine != null ? `表格 · 第 ${sourceLine} 行` : '表格';

  return (
    <div className="md-table-outer" ref={hostRef} data-source-line={sourceLine}>
      <div className="md-table-wrap">
        {createElement('table', tableProps, children)}
      </div>
      <div className="md-focus-entry">
        <button
          className="code-act-btn"
          type="button"
          title="专注查看"
          aria-label="focus table view"
          onClick={() => setFocused(true)}
        >
          <Maximize2 size={13} />
        </button>
      </div>
      {focused && (
        <FocusViewShell
          title={title}
          onClose={() => setFocused(false)}
          ariaLabel="专注查看表格"
          bodyClassName="md-focus-table-body"
          actions={(
            <button
              className={`code-act-btn${copied ? ' copied' : ''}`}
              type="button"
              title="复制为 TSV"
              aria-label="copy table as tsv"
              onClick={handleCopy}
            >
              {copied ? <Check size={13} /> : <Copy size={13} />}
            </button>
          )}
        >
          <div className="md-table-wrap">
            {createElement('table', tableProps, children)}
          </div>
        </FocusViewShell>
      )}
    </div>
  );
}
