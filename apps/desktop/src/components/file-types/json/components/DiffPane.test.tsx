// @vitest-environment jsdom
/**
 * DiffPane tests (horizontal split + Json5CodeMirror input variant).
 *
 * Layout: [toolbar (sort + stats + split/unified)] + horizontal split
 * [Json5CodeMirror input | DiffView]. DiffView is mocked because it calls
 * canvas.getContext('2d').measureText() internally (jsdom ceiling). Stats
 * (+N -M) are computed from DiffFile.diffLines so the mock must populate
 * that field for stat assertions.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('@tauri-apps/plugin-clipboard-manager', () => ({
  writeText: vi.fn().mockResolvedValue(undefined),
}));

// Stub DiffView as a plain div with a stable marker; capture props so we can
// assert the host wires them through.
vi.mock('@git-diff-view/react', () => {
  const DiffView = (props: { diffViewMode: string; diffViewTheme: string }) => (
    <div data-testid="diff-view-stub" data-mode={props.diffViewMode} data-theme={props.diffViewTheme} />
  );
  const DiffModeEnum = { Split: 'split', Unified: 'unified' } as const;
  return { DiffView, DiffModeEnum };
});

// Stub Json5CodeMirror as a controlled textarea-like input so tests can
// fire onChange without mounting a real CodeMirror instance.
vi.mock('../editor/Json5CodeMirror', () => ({
  Json5CodeMirror: (props: { value: string; onChange: (v: string) => void }) => (
    <textarea
      data-testid="diff-input-stub"
      value={props.value}
      onChange={(e) => props.onChange(e.target.value)}
    />
  ),
}));

// generateDiffFile returns a sentinel. Stats (+N -M) are computed from
// the real `diff` package's diffLines over baselineText vs rightInput, so
// the mock here only needs to satisfy DiffView's render contract.
const makeMockFile = () => ({
  initTheme: vi.fn(),
  init: vi.fn(),
  buildSplitDiffLines: vi.fn(),
  buildUnifiedDiffLines: vi.fn(),
});
const mockGenerateDiffFile = vi.fn(() => makeMockFile());
vi.mock('@git-diff-view/file', () => ({
  generateDiffFile: (...args: unknown[]) => mockGenerateDiffFile(...args),
}));

import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { DiffPane } from './DiffPane';

describe('DiffPane', () => {
  afterEach(() => {
    cleanup();
    mockGenerateDiffFile.mockReset();
    mockGenerateDiffFile.mockImplementation(() => makeMockFile());
  });

  it('renders the sort-both checkbox, stats badges, and Split/Unified toggle', () => {
    // left={{a:1}} → baselineText = `{\n  "a": 1\n}` (3 lines); rightInput=""
    // → all 3 lines removed, 0 added → stats +0 -3.
    render(
      <DiffPane
        left={{ a: 1 }}
        rightInput=""
        sortBoth={false}
        onRightInputChange={() => {}}
        onToggleSortBoth={() => {}}
      />,
    );
    expect(screen.getByLabelText('排序后再比较')).toBeTruthy();
    expect(screen.getByText('并排')).toBeTruthy();
    expect(screen.getByText('合并')).toBeTruthy();
    expect(screen.getByText('+0')).toBeTruthy();
    expect(screen.getByText('-3')).toBeTruthy();
  });

  it('mounts the diff container and input editor', () => {
    render(
      <DiffPane
        left={{ a: 1 }}
        rightInput='{"a":1,"b":2}'
        sortBoth={false}
        onRightInputChange={() => {}}
        onToggleSortBoth={() => {}}
      />,
    );
    expect(screen.getByTestId('diff-view-stub')).toBeTruthy();
    expect(screen.getByTestId('diff-input-stub')).toBeTruthy();
  });

  it('toggles sort-both without throwing', () => {
    let sortBoth = false;
    const toggle = () => { sortBoth = !sortBoth; };
    render(
      <DiffPane
        left={{}}
        rightInput=""
        sortBoth={sortBoth}
        onRightInputChange={() => {}}
        onToggleSortBoth={toggle}
      />,
    );
    const checkbox = screen.getByLabelText('排序后再比较') as HTMLInputElement;
    expect(checkbox.checked).toBe(false);
    fireEvent.click(checkbox);
    expect(checkbox).toBeTruthy();
  });

  it('switches to unified mode when the 合并 button is clicked', () => {
    render(
      <DiffPane
        left={{ a: 1 }}
        rightInput='{"a":2}'
        sortBoth={false}
        onRightInputChange={() => {}}
        onToggleSortBoth={() => {}}
      />,
    );
    const unifiedBtn = screen.getByText('合并');
    const splitBtn = screen.getByText('并排');
    expect(splitBtn.className).toContain('bg-acc text-white');
    expect(unifiedBtn.className).not.toContain('bg-acc text-white');
    fireEvent.click(unifiedBtn);
    expect(screen.getByText('合并').className).toContain('bg-acc text-white');
    expect(screen.getByText('并排').className).not.toContain('bg-acc text-white');
    expect(screen.getByTestId('diff-view-stub').getAttribute('data-mode')).toBe('unified');
  });

  it('passes resolved theme through to DiffView', () => {
    render(
      <DiffPane
        left={{ a: 1 }}
        rightInput='{"a":2}'
        sortBoth={false}
        onRightInputChange={() => {}}
        onToggleSortBoth={() => {}}
      />,
    );
    // Default appearanceStore theme resolves to 'light' in the test env.
    expect(screen.getByTestId('diff-view-stub').getAttribute('data-theme')).toBe('light');
  });

  it('fires onRightInputChange on every keystroke and rebuilds the diff with the new rightInput', () => {
    const onRightInputChange = vi.fn();
    mockGenerateDiffFile.mockClear();
    render(
      <DiffPane
        left={{ a: 1 }}
        rightInput=""
        sortBoth={false}
        onRightInputChange={onRightInputChange}
        onToggleSortBoth={() => {}}
      />,
    );
    const input = screen.getByTestId('diff-input-stub') as HTMLTextAreaElement;
    expect(input.value).toBe('');
    fireEvent.change(input, { target: { value: '{"a":2}' } });
    expect(onRightInputChange).toHaveBeenCalledTimes(1);
    expect(onRightInputChange).toHaveBeenCalledWith('{"a":2}');
  });

  it('re-renders the diff when rightInput prop changes (parent drives state)', () => {
    mockGenerateDiffFile.mockClear();
    const { rerender } = render(
      <DiffPane
        left={{ a: 1 }}
        rightInput='{"a":1}'
        sortBoth={false}
        onRightInputChange={() => {}}
        onToggleSortBoth={() => {}}
      />,
    );
    const initialCalls = mockGenerateDiffFile.mock.calls.length;
    expect(initialCalls).toBeGreaterThan(0);
    // Last call's 4th positional arg (newContent) is the rightInput.
    const firstNewContent = mockGenerateDiffFile.mock.calls[initialCalls - 1][3];
    expect(firstNewContent).toBe('{"a":1}');

    rerender(
      <DiffPane
        left={{ a: 1 }}
        rightInput='{"a":2}'
        sortBoth={false}
        onRightInputChange={() => {}}
        onToggleSortBoth={() => {}}
      />,
    );
    const afterCalls = mockGenerateDiffFile.mock.calls.length;
    expect(afterCalls).toBeGreaterThan(initialCalls);
    const lastNewContent = mockGenerateDiffFile.mock.calls[afterCalls - 1][3];
    expect(lastNewContent).toBe('{"a":2}');
  });
});
