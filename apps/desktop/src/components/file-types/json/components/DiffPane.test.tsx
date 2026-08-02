// @vitest-environment jsdom
/**
 * DiffPane tests (MergeView variant).
 *
 * DiffPane mounts a CodeMirror 6 `MergeView` (two side-by-side editors
 * with char-level inline diff highlighting). Real CM6 layout measurement
 * doesn't work in jsdom (`getClientRects` ceiling — same as Json5CodeMirror
 * tests), so we mock `@codemirror/merge`'s `MergeView` as a stub. The
 * other CM6 modules (state/view/lang-json/etc.) construct pure-data
 * Extension objects at import + call time, no DOM, so they run real.
 *
 * Stats (+N -M) are computed from the real `diff` package over the two
 * text values, so stat assertions use deterministic baseline vs candidate
 * inputs.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('@tauri-apps/plugin-clipboard-manager', () => ({
  writeText: vi.fn().mockResolvedValue(undefined),
}));

// Stub MergeView — exposes a minimal EditorView-like surface (`state.doc`,
// `dispatch`, `destroy`) so DiffPane's external-value-sync effects can run
// without throwing.
const { MergeViewImpl } = vi.hoisted(() => {
  const MergeViewImpl = vi.fn((config: { a?: { doc?: string }; b?: { doc?: string } }) => {
    const makeStubView = (initialDoc: string) => {
      let doc = initialDoc;
      return {
        state: { doc: { toString: () => doc } },
        dispatch: vi.fn((spec: { changes?: { insert?: string } }) => {
          if (spec.changes?.insert !== undefined) doc = spec.changes.insert;
        }),
      };
    };
    return {
      a: makeStubView(config.a?.doc ?? ''),
      b: makeStubView(config.b?.doc ?? ''),
      dom: document.createElement('div'),
      destroy: vi.fn(),
      reconfigure: vi.fn(),
    };
  });
  return { MergeViewImpl };
});

vi.mock('@codemirror/merge', () => ({
  MergeView: MergeViewImpl,
}));

import { render, screen, cleanup } from '@testing-library/react';
import { DiffPane } from './DiffPane';

describe('DiffPane (MergeView)', () => {
  afterEach(() => {
    cleanup();
    MergeViewImpl.mockClear();
  });

  it('renders stats badges (+N -M) derived from baseline vs empty right', () => {
    // left={{a:1}} → leftText = `{\n  "a": 1\n}` (3 lines); rightText=''
    // → 3 removed, 0 added → +0 -3.
    render(<DiffPane left={{ a: 1 }} />);
    expect(screen.getByText('+0')).toBeTruthy();
    expect(screen.getByText('-3')).toBeTruthy();
  });

  it('mounts MergeView once with baseline in editor a and empty editor b', () => {
    render(<DiffPane left={{ a: 1 }} />);
    expect(MergeViewImpl).toHaveBeenCalledTimes(1);
    const call = MergeViewImpl.mock.calls[0][0];
    // editor a initial doc is the formatted baseline.
    expect(call.a.doc).toBe('{\n  "a": 1\n}');
    // editor b initial doc is empty.
    expect(call.b.doc).toBe('');
  });

  it('updates stats when left prop changes (file switch resets baseline)', () => {
    const { rerender } = render(<DiffPane left={{ a: 1 }} />);
    expect(screen.getByText('-3')).toBeTruthy(); // 3-line baseline vs empty
    // Switch to a 4-line baseline.
    rerender(<DiffPane left={{ a: 1, b: 2 }} />);
    expect(screen.getByText('-4')).toBeTruthy();
  });

  it('renders the MergeView host element', () => {
    const { container } = render(<DiffPane left={{ a: 1 }} />);
    const host = container.querySelector('.min-h-0.flex-1.overflow-auto');
    expect(host).toBeTruthy();
  });

  it('destroys MergeView on unmount', () => {
    const { unmount } = render(<DiffPane left={{ a: 1 }} />);
    const instance = MergeViewImpl.mock.results[0].value;
    expect(instance.destroy).not.toHaveBeenCalled();
    unmount();
    expect(instance.destroy).toHaveBeenCalledTimes(1);
  });
});
