import { useEffect, useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import Papa from 'papaparse';
import type { PreviewProps } from '../types';

const ROW_HEIGHT = 22;
const HEADER_HEIGHT = 22;
const FONT_SIZE = 12;
const MIN_INDEX_WIDTH = 28;
const MAX_INDEX_WIDTH = 80;
const OVERSCAN = 10;

export type Selection =
  | { kind: 'none' }
  | { kind: 'cell'; row: number; col: number }
  | { kind: 'row'; row: number }
  | { kind: 'all' };

export function computeIndexColumnWidth(totalRows: number): number {
  const digits = Math.max(1, String(totalRows || 1).length);
  return Math.min(MAX_INDEX_WIDTH, Math.max(MIN_INDEX_WIDTH, 16 + digits * 9));
}

export function serializeRangeAsTSV(rows: string[][], selection: Selection): string {
  if (selection.kind === 'none') return '';
  let minRow = 0;
  let maxRow = Math.max(rows.length - 1, 0);
  let minCol = 0;
  let maxCol = rows.reduce((m, r) => Math.max(m, r.length - 1), 0);
  if (selection.kind === 'cell') {
    minRow = maxRow = selection.row;
    minCol = maxCol = selection.col;
  } else if (selection.kind === 'row') {
    minRow = maxRow = selection.row;
  }
  const out: string[] = [];
  for (let r = minRow; r <= maxRow; r++) {
    const row = rows[r] ?? [];
    const cells: string[] = [];
    for (let c = minCol; c <= maxCol; c++) {
      cells.push(row[c] ?? '');
    }
    out.push(cells.join('\t'));
  }
  return out.join('\n');
}

export async function writeClipboardTauriFirst(text: string): Promise<boolean> {
  if (typeof globalThis !== 'undefined' && (globalThis as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__) {
    try {
      const mod = await import('@tauri-apps/plugin-clipboard-manager');
      await mod.writeText(text);
      return true;
    } catch (e) {
      console.error('[CsvFileViewerPreview] Tauri clipboard writeText failed:', e);
    }
  }
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (e) {
      console.error('[CsvFileViewerPreview] navigator.clipboard.writeText failed:', e);
    }
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch (e) {
    console.error('[CsvFileViewerPreview] textarea execCommand fallback failed:', e);
    return false;
  }
}

export function CsvFileViewerPreview({ content }: PreviewProps) {
  const parsed = useMemo(() => {
    if (!content) return { rows: [] as string[][], cols: 0 };
    const result = Papa.parse<string[]>(content, {
      skipEmptyLines: false,
      dynamicTyping: false,
      // ponytail: papaparse strips UTF-8 BOM natively (header: false → first row is data).
    });
    const rows = (result.data as unknown as string[][]).filter((r) => Array.isArray(r));
    const cols = rows.reduce((m, r) => Math.max(m, r.length), 0);
    return { rows, cols };
  }, [content]);

  const { rows, cols } = parsed;
  const rowCount = rows.length;
  const colCount = cols;
  const indexWidth = computeIndexColumnWidth(rowCount);

  const [selection, setSelection] = useState<Selection>({ kind: 'none' });
  const scrollRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  const rowVirtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: OVERSCAN,
  });

  // macOS Edit menu's Cmd+C accelerator preempts the webview keydown, so any
  // keydown-based copy path never fires. The menu dispatches a native `copy`
  // event instead — intercept it here and route through the Tauri clipboard
  // pipeline. Only intercept when focus is inside the pane and there's a
  // programmatic selection (DOM text selection falls through to native copy).
  useEffect(() => {
    const onCopy = (event: ClipboardEvent) => {
      const root = rootRef.current;
      if (!root) return;
      const target = event.target as Node | null;
      const active = document.activeElement;
      const inside = (target && root.contains(target)) || (active && root.contains(active));
      if (!inside) return;
      // If the browser has a native text selection, let native copy handle it.
      const native = window.getSelection?.();
      if (native && native.toString()) return;
      if (selection.kind === 'none') return;
      const text = serializeRangeAsTSV(rows, selection);
      if (!text) return;
      event.preventDefault();
      if (event.clipboardData) {
        try { event.clipboardData.setData('text/plain', text); } catch { /* ignore */ }
      }
      void writeClipboardTauriFirst(text);
    };
    document.addEventListener('copy', onCopy);
    return () => document.removeEventListener('copy', onCopy);
  }, [rows, selection]);

  // Cmd/Ctrl+A selects the whole table when focus is inside the pane. Don't
  // intercept Cmd/Ctrl+C here — the `copy` event above fires on both macOS
  // (menu-dispatched) and other systems (keydown-dispatched), so handling it
  // once in the copy handler avoids double-writes.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const root = rootRef.current;
      if (!root) return;
      const target = e.target as Node | null;
      const active = document.activeElement;
      const inside = (target && root.contains(target)) || (active && root.contains(active));
      if (!inside) return;
      if ((e.metaKey || e.ctrlKey) && (e.key === 'a' || e.key === 'A')) {
        e.preventDefault();
        setSelection({ kind: 'all' });
      }
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, []);

  const colTemplate = `var(--idx) repeat(${colCount}, minmax(80px, 1fr))`;
  const totalHeight = rowVirtualizer.getTotalSize();
  const virtualRows = rowVirtualizer.getVirtualItems();
  // ponytail: minWidth forces the wrapper to its natural table width so
  // horizontal scroll exposes full-width rows (absolute rows inherit this
  // width via width:100%). Without it the wrapper defaults to viewport
  // width and the scrolled-in area has no grid cells rendered.
  const tableMinWidth = indexWidth + colCount * 80;
  const cellsForHeader = useMemo(() => {
    // Header shows column index 1..N (matches index column showing row numbers).
    const out: number[] = [];
    for (let i = 0; i < colCount; i++) out.push(i + 1);
    return out;
  }, [colCount]);

  return (
    <div
      ref={rootRef}
      className="csv-preview-root h-full w-full overflow-hidden bg-panel text-t1 flex flex-col"
      style={{ '--idx': `${indexWidth}px`, fontSize: FONT_SIZE } as React.CSSProperties}
      tabIndex={0}
    >
      <div
        ref={scrollRef}
        className="flex-1 overflow-auto csv-scroll"
        // ponytail: overscroll-behavior:none kills the macOS WKWebView
        // rubber-band gap that flings past the top/bottom boundary (the blank
        // strip appears above the sticky header while the content is pulled).
        style={{ scrollbarWidth: 'none', overscrollBehavior: 'none' }}
      >
        <div style={{ height: HEADER_HEIGHT + totalHeight, position: 'relative', minWidth: tableMinWidth }}>
          <div
            className="grid border-b border-brd bg-hov text-t2 font-medium"
            style={{ display: 'grid', gridTemplateColumns: colTemplate, height: HEADER_HEIGHT, position: 'sticky', top: 0, zIndex: 1 }}
          >
            <div
              className="flex items-center justify-center border-r border-brd bg-hov"
              style={{ height: HEADER_HEIGHT, position: 'sticky', left: 0, zIndex: 2 }}
              data-sticky-idx
            >
              #
            </div>
            {cellsForHeader.map((n) => (
              <div
                key={n}
                className="flex items-center justify-center border-r border-brd last:border-r-0 px-1 overflow-hidden text-ellipsis whitespace-nowrap"
                style={{ height: HEADER_HEIGHT }}
              >
                {n}
              </div>
            ))}
          </div>
          <div style={{ height: totalHeight, position: 'relative' }}>
            {virtualRows.map((vRow) => {
              const r = vRow.index;
              const row = rows[r] ?? [];
              const isRowSelected = selection.kind === 'all' || (selection.kind === 'row' && selection.row === r);
              return (
                <div
                  key={r}
                  className="grid border-b border-brd/50"
                  style={{
                    display: 'grid',
                    gridTemplateColumns: colTemplate,
                    position: 'absolute',
                    top: vRow.start,
                    height: ROW_HEIGHT,
                    width: '100%',
                  }}
                >
                  <div
                    data-idx-cell
                    data-sticky-idx
                    className={`flex items-center justify-center border-r border-brd cursor-pointer select-none ${isRowSelected ? 'bg-accdim text-acc' : 'bg-hov text-t2'}`}
                    style={{ height: ROW_HEIGHT, position: 'sticky', left: 0, zIndex: 2 }}
                    onMouseDown={(e) => { e.preventDefault(); setSelection({ kind: 'row', row: r }); }}
                  >
                    {r + 1}
                  </div>
                  {Array.from({ length: colCount }, (_, c) => {
                    const v = row[c] ?? '';
                    const isCellSelected =
                      isRowSelected ||
                      (selection.kind === 'cell' && selection.row === r && selection.col === c);
                    return (
                      <div
                        key={c}
                        className={`flex items-center px-1 border-r border-brd/50 last:border-r-0 overflow-hidden text-ellipsis whitespace-nowrap cursor-cell ${isCellSelected ? 'bg-accdim/60 text-acc' : ''}`}
                        style={{ height: ROW_HEIGHT }}
                        onMouseDown={(e) => { e.preventDefault(); setSelection({ kind: 'cell', row: r, col: c }); }}
                        title={v}
                      >
                        {v}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      </div>
      <div className="flex items-center justify-between px-2 py-[3px] border-t border-brd text-[11px] text-t2 shrink-0">
        <span>共 {rowCount} 行，{colCount} 列</span>
        <span className="text-t3">{selection.kind === 'none' ? '' : selection.kind === 'all' ? '已全选' : '已选中'}</span>
      </div>
      <style>{`.csv-scroll::-webkit-scrollbar { width: 0; height: 0; }`}</style>
    </div>
  );
}
