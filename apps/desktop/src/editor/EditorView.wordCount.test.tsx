import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRef } from 'react';
import { render, cleanup, act } from '@testing-library/react';
import { FolynEditor, type FolynEditorHandle } from '@/editor/EditorView';
import { useEditorViewStateStore } from '@/store/editorViewState';

// Word count regression tests: the status-bar count used to recompute the
// full-doc regex split on EVERY keystroke (~57ms/5MB per doc change). It is
// now set immediately on mount/tab-switch and trailing-debounced
// (WORD_COUNT_DEBOUNCE_MS = 500ms) on doc changes, reading the current doc
// at flush time.

function wordCount(): number {
  return useEditorViewStateStore.getState().wordCount;
}

function mount(initialContent: string) {
  const ref = createRef<FolynEditorHandle>();
  const onChange = vi.fn();
  render(
    <FolynEditor
      ref={ref}
      initialContent={initialContent}
      filePath="wordcount-test.md"
      onChange={onChange}
    />,
  );
  const view = ref.current?.getView() ?? null;
  if (!view) throw new Error('editor view missing after mount');
  return { view, onChange };
}

describe('FolynEditor word count', () => {
  beforeEach(() => {
    useEditorViewStateStore.setState({ wordCount: -1 });
  });
  afterEach(() => {
    vi.useRealTimers();
    cleanup();
  });

  it('sets the word count immediately on mount', () => {
    mount('one two three');
    expect(wordCount()).toBe(3);
  });

  it('does NOT recompute on doc change; recomputes 500ms after the last one', () => {
    vi.useFakeTimers();
    const { view } = mount('one two');
    expect(wordCount()).toBe(2);

    act(() => {
      view.dispatch({ changes: { from: 7, to: 7, insert: ' three' } });
    });
    expect(wordCount()).toBe(2); // not per keystroke
    vi.advanceTimersByTime(499);
    expect(wordCount()).toBe(2); // not before the debounce window closes
    vi.advanceTimersByTime(1);
    expect(wordCount()).toBe(3); // flushed from the current doc
  });

  it('coalesces a burst of edits into one flush with the latest content', () => {
    vi.useFakeTimers();
    const { view } = mount('one two');

    let publishes = 0;
    const unsub = useEditorViewStateStore.subscribe((s, prev) => {
      if (s.wordCount !== prev.wordCount) publishes++;
    });
    try {
      act(() => {
        view.dispatch({ changes: { from: 7, to: 7, insert: ' three' } });
      });
      act(() => {
        view.dispatch({ changes: { from: 13, to: 13, insert: ' four' } });
      });
      expect(wordCount()).toBe(2); // still the pre-burst value
      vi.advanceTimersByTime(500);
      expect(wordCount()).toBe(4); // one flush, latest content
      expect(publishes).toBe(1);
    } finally {
      unsub();
    }
  });

  it('reschedules on each edit: the flush follows the LAST doc change', () => {
    vi.useFakeTimers();
    const { view } = mount('one two');
    act(() => {
      view.dispatch({ changes: { from: 7, to: 7, insert: ' three' } });
    });
    vi.advanceTimersByTime(300);
    act(() => {
      view.dispatch({ changes: { from: 13, to: 13, insert: ' four' } });
    });
    vi.advanceTimersByTime(200); // 500ms since the FIRST edit only
    expect(wordCount()).toBe(2); // timer was rescheduled
    vi.advanceTimersByTime(300); // 500ms since the LAST edit
    expect(wordCount()).toBe(4);
  });

  it('cancels a pending flush on unmount', () => {
    vi.useFakeTimers();
    const ref = createRef<FolynEditorHandle>();
    const { unmount } = render(
      <FolynEditor ref={ref} initialContent="one two" filePath="wordcount-test.md" onChange={() => {}} />,
    );
    expect(wordCount()).toBe(2);
    const view = ref.current?.getView();
    if (!view) throw new Error('editor view missing after mount');
    act(() => {
      view.dispatch({ changes: { from: 7, to: 7, insert: ' three' } });
    });
    unmount();
    vi.advanceTimersByTime(1000);
    expect(wordCount()).toBe(2); // no post-unmount publish
  });
});
