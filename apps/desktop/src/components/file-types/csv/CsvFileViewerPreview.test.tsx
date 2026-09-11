import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import * as clipboardManager from '@tauri-apps/plugin-clipboard-manager';
import {
  CsvFileViewerPreview,
  computeIndexColumnWidth,
  serializeRangeAsTSV,
  writeClipboardTauriFirst,
  type Selection,
} from './CsvFileViewerPreview';

const tauriInternalsKey = '__TAURI_INTERNALS__' as const;

// ponytail: @tanstack/react-virtual in jsdom doesn't measure the scroll
// element (no ResizeObserver, clientHeight=0 by default) so virtualized rows
// never appear. Stub the hook to return ALL rows as visible — the rendering
// tests below assert on parsed output, not on virtualization math. The real
// virtualizer is exercised at runtime in the browser.
vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: ({ count, estimateSize }: { count: number; estimateSize: () => number }) => ({
    getVirtualItems: () =>
      Array.from({ length: count }, (_, i) => ({
        index: i,
        key: String(i),
        start: i * estimateSize(),
        size: estimateSize(),
        lane: 0,
      })),
    getTotalSize: () => count * estimateSize(),
    measure: () => {},
    scrollToIndex: () => {},
  }),
}));

beforeEach(() => {
  (clipboardManager.writeText as ReturnType<typeof vi.fn>).mockClear();
  (clipboardManager.writeText as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
});

afterEach(() => {
  delete (globalThis as { [k in typeof tauriInternalsKey]?: unknown })[tauriInternalsKey];
});

describe('computeIndexColumnWidth', () => {
  it('clamps to the 28px minimum for tiny files', () => {
    expect(computeIndexColumnWidth(0)).toBe(28);
    expect(computeIndexColumnWidth(5)).toBe(28);
  });
  it('scales by digit count up to the 80px cap', () => {
    expect(computeIndexColumnWidth(99)).toBe(34);
    expect(computeIndexColumnWidth(9999)).toBe(52);
    expect(computeIndexColumnWidth(1_000_000)).toBe(79);
    expect(computeIndexColumnWidth(1_000_000_000_000)).toBe(80);
  });
});

describe('serializeRangeAsTSV', () => {
  const rows = [
    ['a', 'b', 'c'],
    ['d', 'e', 'f'],
  ];
  it('returns empty string for no selection', () => {
    expect(serializeRangeAsTSV(rows, { kind: 'none' })).toBe('');
  });
  it('serializes a single cell', () => {
    expect(serializeRangeAsTSV(rows, { kind: 'cell', row: 0, col: 1 } as Selection)).toBe('b');
  });
  it('serializes a whole row', () => {
    expect(serializeRangeAsTSV(rows, { kind: 'row', row: 1 } as Selection)).toBe('d\te\tf');
  });
  it('serializes the whole table for kind=all', () => {
    expect(serializeRangeAsTSV(rows, { kind: 'all' })).toBe('a\tb\tc\nd\te\tf');
  });
  it('pads ragged rows with empty strings', () => {
    const ragged = [['a'], ['b', 'c']];
    expect(serializeRangeAsTSV(ragged, { kind: 'all' })).toBe('a\t\nb\tc');
  });
  it('serializes a rectangular range (2x2 sub-rectangle of a 3x3 grid)', () => {
    const grid = [
      ['a', 'b', 'c'],
      ['d', 'e', 'f'],
      ['g', 'h', 'i'],
    ];
    expect(
      serializeRangeAsTSV(grid, {
        kind: 'range',
        startRow: 0,
        startCol: 1,
        endRow: 1,
        endCol: 2,
      } as Selection),
    ).toBe('b\tc\ne\tf');
  });
  it('normalizes a reversed range (endRow < startRow) to the same TSV', () => {
    const grid = [
      ['a', 'b', 'c'],
      ['d', 'e', 'f'],
      ['g', 'h', 'i'],
    ];
    expect(
      serializeRangeAsTSV(grid, {
        kind: 'range',
        startRow: 1,
        startCol: 2,
        endRow: 0,
        endCol: 1,
      } as Selection),
    ).toBe('b\tc\ne\tf');
  });
});

describe('writeClipboardTauriFirst', () => {
  beforeEach(() => {
    (globalThis as { [k in typeof tauriInternalsKey]?: unknown })[tauriInternalsKey] = {};
  });
  it('routes through @tauri-apps/plugin-clipboard-manager when __TAURI_INTERNALS__ is set', async () => {
    const ok = await writeClipboardTauriFirst('hello');
    expect(ok).toBe(true);
    expect(clipboardManager.writeText).toHaveBeenCalledWith('hello');
  });
  it('falls back to navigator.clipboard when Tauri writeText rejects', async () => {
    (clipboardManager.writeText as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('tauri fail'));
    // ponytail: jsdom doesn't ship navigator.clipboard; install a stub for
    // this test, then restore via afterEach. The stub itself is asserted
    // against rather than relying on the real API.
    const fakeClipboard = { writeText: vi.fn().mockResolvedValue(undefined) };
    Object.defineProperty(navigator, 'clipboard', {
      value: fakeClipboard,
      configurable: true,
      writable: true,
    });
    const ok = await writeClipboardTauriFirst('hello');
    expect(ok).toBe(true);
    expect(fakeClipboard.writeText).toHaveBeenCalledWith('hello');
  });
});

describe('CsvFileViewerPreview', () => {
  it('parses content and renders the status line', () => {
    const { container } = render(
      <CsvFileViewerPreview content={`a,b,c\n1,2,3`} filePath="/v/data.csv" vaultRoot="/v" />,
    );
    expect(container.textContent).toContain('共 2 行，3 列');
    expect(container.textContent).toContain('a');
  });
  it('sets the table min-width so horizontal scroll exposes full-width rows', () => {
    // 10 cols × 80px + indexWidth(28 for ≤99 rows) = 828px. The wrapper div
    // (the second child of the scroll container) must carry this minWidth so
    // absolute rows inherit the natural table width instead of the viewport.
    const { container } = render(
      <CsvFileViewerPreview content={`h1,h2,h3,h4,h5,h6,h7,h8,h9,h10\n1,2,3,4,5,6,7,8,9,10`} filePath="/v/wide.csv" vaultRoot="/v" />,
    );
    const scrollRoot = container.querySelector('.csv-scroll') as HTMLElement;
    expect(scrollRoot).toBeTruthy();
    const wrapper = scrollRoot.firstElementChild as HTMLElement;
    expect(wrapper.style.minWidth).toBe('828px');
  });
  it('disables rubber-band overscroll on the scroll container', () => {
    // Regression: flinging past the top/bottom on macOS WKWebView showed a
    // blank overscroll gap above the sticky header. overscroll-behavior:none
    // on the scroll container kills the rubber-band.
    const { container } = render(
      <CsvFileViewerPreview content={`a,b\n1,2`} filePath="/v/o.csv" vaultRoot="/v" />,
    );
    const scrollRoot = container.querySelector('.csv-scroll') as HTMLElement;
    expect(scrollRoot.style.overscrollBehavior).toBe('none');
  });
  it('pins the index column with position:sticky left:0 (header + body)', () => {
    const { container } = render(
      <CsvFileViewerPreview content={`a,b\n1,2`} filePath="/v/s.csv" vaultRoot="/v" />,
    );
    const stickyIdx = container.querySelectorAll('[data-sticky-idx]');
    // header `#` cell + at least one body index cell
    expect(stickyIdx.length).toBeGreaterThanOrEqual(2);
    for (const cell of Array.from(stickyIdx)) {
      const style = (cell as HTMLElement).style;
      expect(style.position).toBe('sticky');
      expect(style.left).toBe('0px');
      expect(style.zIndex).toBe('2');
    }
  });
  it('handles empty content (0 rows, 0 cols)', () => {
    const { container } = render(
      <CsvFileViewerPreview content="" filePath="/v/empty.csv" vaultRoot="/v" />,
    );
    expect(container.textContent).toContain('共 0 行，0 列');
  });
  it('handles a single row with quoted fields and embedded newlines', () => {
    const csv = '"a,b","c\nd"';
    const { container } = render(
      <CsvFileViewerPreview content={csv} filePath="/v/q.csv" vaultRoot="/v" />,
    );
    expect(container.textContent).toContain('共 1 行，2 列');
    expect(container.textContent).toContain('a,b');
  });
  it('selects a whole row when the index column is mousedown-ed', () => {
    const { container } = render(
      <CsvFileViewerPreview content={`x,y\n1,2`} filePath="/v/r.csv" vaultRoot="/v" />,
    );
    const idxCells = container.querySelectorAll('[data-idx-cell]');
    expect(idxCells.length).toBeGreaterThan(0);
    fireEvent.mouseDown(idxCells[0]);
    expect(container.textContent).toContain('已选中');
  });
  it('selects the whole table on Cmd+A when focus is inside the pane', () => {
    const { container } = render(
      <CsvFileViewerPreview content={`x,y\n1,2`} filePath="/v/a.csv" vaultRoot="/v" />,
    );
    const root = container.firstChild as HTMLElement;
    root.focus();
    fireEvent.keyDown(root, { key: 'a', metaKey: true });
    expect(container.textContent).toContain('已全选');
  });
  it('serializes selection to TSV on copy event and routes through Tauri clipboard', async () => {
    (globalThis as { [k in typeof tauriInternalsKey]?: unknown })[tauriInternalsKey] = {};
    const { container } = render(
      <CsvFileViewerPreview content={`a,b\nc,d`} filePath="/v/c.csv" vaultRoot="/v" />,
    );
    const root = container.firstChild as HTMLElement;
    root.focus();
    fireEvent.keyDown(root, { key: 'a', metaKey: true });
    const setData = vi.fn();
    const event = new Event('copy', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'clipboardData', { value: { setData } });
    Object.defineProperty(event, 'target', { value: root });
    document.dispatchEvent(event);
    await new Promise((r) => setTimeout(r, 0));
    expect(setData).toHaveBeenCalledWith('text/plain', 'a\tb\nc\td');
    expect(clipboardManager.writeText).toHaveBeenCalledWith('a\tb\nc\td');
  });
  it('extends selection as a rectangular range on shift+click', () => {
    const { container } = render(
      <CsvFileViewerPreview content={`a,b,c\nd,e,f\ng,h,i`} filePath="/v/r.csv" vaultRoot="/v" />,
    );
    const rows = container.querySelectorAll('.grid.border-b.border-brd\\/50');
    expect(rows.length).toBe(3);
    // Data cells in each row: skip the index cell (first child), take the rest.
    const cell = (rowIdx: number, colIdx: number): HTMLElement =>
      rows[rowIdx].querySelectorAll('[class*="cursor-cell"]')[colIdx] as HTMLElement;
    // Plain mousedown on cell (0,0) — sets anchor.
    fireEvent.mouseDown(cell(0, 0));
    // Shift+mousedown on cell (1,1) — extends to 2x2 range.
    fireEvent.mouseDown(cell(1, 1), { shiftKey: true });
    expect(container.textContent).toContain('已选中 2×2');
    // The 4 cells in the rectangle (0,0)..(1,1) carry the selected class.
    const selected = container.querySelectorAll('.bg-accdim\\/60.text-acc');
    expect(selected.length).toBe(4);
  });
});
