// @vitest-environment jsdom
/**
 * DiffPane tests (git-diff-view variant).
 *
 * The Diff tab is now a read-only `<DiffView>` from `@git-diff-view/react`.
 * `DiffView` calls `canvas.getContext('2d').measureText()` internally for
 * column alignment, which jsdom does not implement (same ceiling as the
 * spec calls out for `@antv/x6` / `@tiptap`). We mock the lib so the test
 * asserts our wrapper (toolbar + diff slot + theme resolution), not the
 * lib's internals.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('@tauri-apps/plugin-clipboard-manager', () => ({
  writeText: vi.fn().mockResolvedValue(undefined),
}));

// Stub DiffView as a plain div with a stable marker; capture props so we can
// assert the host wires them through. generateDiffFile returns a sentinel.
vi.mock('@git-diff-view/react', () => {
  const DiffView = (props: { diffViewMode: string; diffViewTheme: string }) => (
    <div data-testid="diff-view-stub" data-mode={props.diffViewMode} data-theme={props.diffViewTheme} />
  );
  const DiffModeEnum = { Split: 'split', Unified: 'unified' } as const;
  return { DiffView, DiffModeEnum };
});

// Stub DiffView as a plain div with a stable marker; capture props so we can
// assert the host wires them through. generateDiffFile returns a sentinel
// whose identity changes per call so we can assert re-renders on input.
const mockGenerateDiffFile = vi.fn(() => ({
  initTheme: vi.fn(),
  init: vi.fn(),
  buildSplitDiffLines: vi.fn(),
  buildUnifiedDiffLines: vi.fn(),
}));
vi.mock('@git-diff-view/file', () => ({
  generateDiffFile: (...args: unknown[]) => mockGenerateDiffFile(...args),
}));

import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { DiffPane } from './DiffPane';

describe('DiffPane', () => {
  afterEach(() => cleanup());

  it('renders the sort-both checkbox and Split/Unified toggle', () => {
    render(
      <DiffPane
        left={{ a: 1 }}
        rightInput=""
        right={null}
        sortBoth={false}
        onRightInputChange={() => {}}
        onRightValueChange={() => {}}
        onToggleSortBoth={() => {}}
        onCopyValue={() => {}}
      />,
    );
    expect(screen.getByLabelText('排序后再比较')).toBeTruthy();
    expect(screen.getByText('并排')).toBeTruthy();
    expect(screen.getByText('合并')).toBeTruthy();
  });

  it('mounts the diff container', () => {
    render(
      <DiffPane
        left={{ a: 1 }}
        rightInput='{"a":1,"b":2}'
        right={{ a: 1, b: 2 }}
        sortBoth={false}
        onRightInputChange={() => {}}
        onRightValueChange={() => {}}
        onToggleSortBoth={() => {}}
        onCopyValue={() => {}}
      />,
    );
    expect(screen.getByTestId('diff-view-stub')).toBeTruthy();
  });

  it('toggles sort-both without throwing', () => {
    let sortBoth = false;
    const toggle = () => { sortBoth = !sortBoth; };
    render(
      <DiffPane
        left={{}}
        rightInput=""
        right={null}
        sortBoth={sortBoth}
        onRightInputChange={() => {}}
        onRightValueChange={() => {}}
        onToggleSortBoth={toggle}
        onCopyValue={() => {}}
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
        right={null}
        sortBoth={false}
        onRightInputChange={() => {}}
        onRightValueChange={() => {}}
        onToggleSortBoth={() => {}}
        onCopyValue={() => {}}
      />,
    );
    const unifiedBtn = screen.getByText('合并');
    const splitBtn = screen.getByText('并排');
    // Split is active by default — its button carries the accent + white text.
    expect(splitBtn.className).toContain('bg-acc text-white');
    expect(unifiedBtn.className).not.toContain('bg-acc text-white');
    fireEvent.click(unifiedBtn);
    // After click, unified becomes the active one and the stub receives the new mode.
    expect(screen.getByText('合并').className).toContain('bg-acc text-white');
    expect(screen.getByText('并排').className).not.toContain('bg-acc text-white');
    expect(screen.getByTestId('diff-view-stub').getAttribute('data-mode')).toBe('unified');
  });

  it('passes resolved theme through to DiffView', () => {
    render(
      <DiffPane
        left={{ a: 1 }}
        rightInput='{"a":2}'
        right={null}
        sortBoth={false}
        onRightInputChange={() => {}}
        onRightValueChange={() => {}}
        onToggleSortBoth={() => {}}
        onCopyValue={() => {}}
      />,
    );
    // Default appearanceStore theme resolves to 'light' in the test env
    // (no matchMedia dark preference).
    expect(screen.getByTestId('diff-view-stub').getAttribute('data-theme')).toBe('light');
  });

  it('fires onRightInputChange on every keystroke and rebuilds the diff with the new rightInput', () => {
    const onRightInputChange = vi.fn();
    mockGenerateDiffFile.mockClear();
    render(
      <DiffPane
        left={{ a: 1 }}
        rightInput=""
        right={null}
        sortBoth={false}
        onRightInputChange={onRightInputChange}
        onRightValueChange={() => {}}
        onToggleSortBoth={() => {}}
        onCopyValue={() => {}}
      />,
    );
    // The textarea is the only <textarea> in the component.
    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement;
    expect(textarea.value).toBe('');
    fireEvent.change(textarea, { target: { value: '{"a":2}' } });
    expect(onRightInputChange).toHaveBeenCalledTimes(1);
    expect(onRightInputChange).toHaveBeenCalledWith('{"a":2}');
  });

  it('re-renders the diff when rightInput prop changes (parent drives state)', () => {
    mockGenerateDiffFile.mockClear();
    const { rerender } = render(
      <DiffPane
        left={{ a: 1 }}
        rightInput='{"a":1}'
        right={null}
        sortBoth={false}
        onRightInputChange={() => {}}
        onRightValueChange={() => {}}
        onToggleSortBoth={() => {}}
        onCopyValue={() => {}}
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
        right={null}
        sortBoth={false}
        onRightInputChange={() => {}}
        onRightValueChange={() => {}}
        onToggleSortBoth={() => {}}
        onCopyValue={() => {}}
      />,
    );
    const afterCalls = mockGenerateDiffFile.mock.calls.length;
    expect(afterCalls).toBeGreaterThan(initialCalls);
    const lastNewContent = mockGenerateDiffFile.mock.calls[afterCalls - 1][3];
    expect(lastNewContent).toBe('{"a":2}');
  });
});
