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
});
