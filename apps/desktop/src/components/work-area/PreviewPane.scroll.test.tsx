import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, act } from '@testing-library/react';
import { createElement } from 'react';
import { PreviewPane } from './PreviewPane';
import type { FileTab, ViewMode } from '@/store/editorStore';
import type { PreviewProps } from '../file-types/types';

// The .prev-body scroll container stays mounted across tab switches (no key
// change), so it keeps the previous file's scrollTop unless PreviewPane
// resets it. A newly opened file has no saved previewScrollTop — the pane
// must reset scrollTop to 0 instead of leaving the previous file's position
// behind (which the browser clamps into the 100vh markdown bottom pad and
// shows as a near-full-viewport blank page — the reported "新打开一个
// Markdown文件，预览页留有一大片空白").

function tab(id: string, name: string, overrides: Partial<FileTab> = {}): FileTab {
  return {
    id,
    name,
    path: `/vault/${name}`,
    content: '# hello',
    isDirty: false,
    fileType: 'markdown',
    activity: 'files',
    ...overrides,
  };
}

function DummyPreview(_props: PreviewProps) {
  return createElement('div', null, 'preview');
}

function flushFrames() {
  // The restore effect applies on double rAF.
  return act(async () => {
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    await new Promise((r) => requestAnimationFrame(() => r(null)));
  });
}

function prevBody(): HTMLElement {
  const el = document.querySelector('.prev-body') as HTMLElement | null;
  if (!el) throw new Error('.prev-body not found');
  return el;
}

afterEach(() => cleanup());

describe('PreviewPane scroll on tab switch', () => {
  it('resets scrollTop to 0 when the incoming tab has no saved previewScrollTop', async () => {
    const { rerender } = render(
      <PreviewPane activeTab={tab('a', 'a.md')} Preview={DummyPreview} vaultRoot="/vault" viewMode="preview" />,
    );
    // Simulate the previous file's deep scroll position left on the shared
    // (not remounted) scroll container.
    act(() => { prevBody().scrollTop = 2000; });

    rerender(
      <PreviewPane activeTab={tab('b', 'b.md')} Preview={DummyPreview} vaultRoot="/vault" viewMode="preview" />,
    );
    await flushFrames();

    expect(prevBody().scrollTop).toBe(0);
  });

  it('restores the saved scrollTop when the incoming tab has one', async () => {
    const { rerender } = render(
      <PreviewPane activeTab={tab('a', 'a.md')} Preview={DummyPreview} vaultRoot="/vault" viewMode="preview" />,
    );
    act(() => { prevBody().scrollTop = 2000; });

    rerender(
      <PreviewPane
        activeTab={tab('b', 'b.md', { previewScrollTop: 1234 })}
        Preview={DummyPreview}
        vaultRoot="/vault"
        viewMode="preview"
      />,
    );
    await flushFrames();

    expect(prevBody().scrollTop).toBe(1234);
  });

  it('does not touch the scroll position when the same tab re-renders (content edits)', async () => {
    const { rerender } = render(
      <PreviewPane activeTab={tab('a', 'a.md')} Preview={DummyPreview} vaultRoot="/vault" viewMode="preview" />,
    );
    act(() => { prevBody().scrollTop = 777; });
    await flushFrames();
    expect(prevBody().scrollTop).toBe(777);
  });
});
