import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, act, fireEvent } from '@testing-library/react';
import { createElement } from 'react';
import { PreviewPane } from './PreviewPane';
import { useEditorStore } from '@/store/editorStore';
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

  it('saves a scroll onto the tab it shows, even after the store moved to another tab', async () => {
    useEditorStore.setState({ tabs: [tab('a', 'a.md'), tab('b', 'b.md')], activeTabId: 'a' });
    render(
      <PreviewPane activeTab={tab('a', 'a.md')} Preview={DummyPreview} vaultRoot="/vault" viewMode="preview" />,
    );
    act(() => {
      prevBody().scrollTop = 640;
      fireEvent.scroll(prevBody());
    });
    // The switch lands in the store before the work area renders the new tab.
    useEditorStore.setState({ activeTabId: 'b' });
    await act(() => new Promise((r) => setTimeout(r, 250)));

    const [a, b] = useEditorStore.getState().tabs;
    expect(a.previewScrollTop).toBe(640);
    expect(b.previewScrollTop).toBeUndefined();
  });

  it('holds the restored position while the document is still growing, without saving the clamped value', async () => {
    useEditorStore.setState({ tabs: [tab('a', 'a.md'), tab('b', 'b.md', { previewScrollTop: 1500 })], activeTabId: 'a' });
    const { rerender } = render(
      <PreviewPane activeTab={tab('a', 'a.md')} Preview={DummyPreview} vaultRoot="/vault" viewMode="preview" />,
    );
    rerender(
      <PreviewPane activeTab={tab('b', 'b.md', { previewScrollTop: 1500 })} Preview={DummyPreview} vaultRoot="/vault" viewMode="preview" />,
    );
    // Images not loaded yet: the browser clamps the position short.
    act(() => {
      prevBody().scrollTop = 300;
      fireEvent.scroll(prevBody());
    });
    await flushFrames();
    expect(prevBody().scrollTop).toBe(1500);
    await act(() => new Promise((r) => setTimeout(r, 250)));
    expect(useEditorStore.getState().tabs[1].previewScrollTop).toBe(1500);
  });

  it('hands the position back to the reader on their first scroll', async () => {
    const { rerender } = render(
      <PreviewPane activeTab={tab('a', 'a.md')} Preview={DummyPreview} vaultRoot="/vault" viewMode="preview" />,
    );
    rerender(
      <PreviewPane activeTab={tab('b', 'b.md', { previewScrollTop: 1500 })} Preview={DummyPreview} vaultRoot="/vault" viewMode="preview" />,
    );
    await flushFrames();
    expect(prevBody().dataset.restoringScroll).toBe('');

    act(() => {
      fireEvent.wheel(prevBody());
      prevBody().scrollTop = 900;
    });
    await flushFrames();
    expect(prevBody().scrollTop).toBe(900);
    expect(prevBody().dataset.restoringScroll).toBeUndefined();
  });

  it('a kept-alive pane keeps its own DOM and scroll while hidden and comes back where it was', async () => {
    useEditorStore.setState({ tabs: [tab('a', 'a.md')], activeTabId: 'a' });
    const { rerender } = render(
      <PreviewPane activeTab={tab('a', 'a.md')} Preview={DummyPreview} vaultRoot="/vault" viewMode="preview" />,
    );
    const body = prevBody();
    act(() => {
      body.scrollTop = 820;
      fireEvent.scroll(body);
    });

    rerender(
      <PreviewPane activeTab={tab('a', 'a.md')} Preview={DummyPreview} vaultRoot="/vault" viewMode="preview" active={false} />,
    );
    expect(body.closest('[data-preview-hidden]')).not.toBeNull();
    // Scrolls of a hidden pane (layout settling behind another tab) are not the reader's.
    act(() => {
      body.scrollTop = 100;
      fireEvent.scroll(body);
    });
    await act(() => new Promise((r) => setTimeout(r, 250)));
    expect(useEditorStore.getState().tabs[0].previewScrollTop).toBe(820);

    act(() => { body.scrollTop = 820; });
    rerender(
      <PreviewPane activeTab={tab('a', 'a.md', { previewScrollTop: 820 })} Preview={DummyPreview} vaultRoot="/vault" viewMode="preview" active />,
    );
    await flushFrames();
    expect(prevBody()).toBe(body);
    expect(body.closest('[data-preview-hidden]')).toBeNull();
    expect(body.scrollTop).toBe(820);
  });
});

// Zoom plumbing regression: usePreviewZoom/cursor-sync/gap-compensation
// walk `.md-preview`.parentElement for the scroll container, so the Preview
// must stay `.prev-body`'s DIRECT child — an intermediate zoom wrapper div
// here broke split-mode cursor alignment once already. The --md-zoom var is
// owned by usePreviewZoom (set when enabled, removed when disabled) — React
// never renders it, so mid-animation store commits can't snap it back.
describe('PreviewPane zoom plumbing (DOM structure)', () => {
  it('renders the Preview as .prev-body direct child with --md-zoom set to the store zoom when enabled', () => {
    render(
      <PreviewPane activeTab={tab('a', 'a.md')} Preview={DummyPreview} vaultRoot="/vault" viewMode="preview" />,
    );
    const body = prevBody();
    expect(body.firstElementChild?.textContent).toBe('preview');
    expect(body.style.getPropertyValue('--md-zoom')).toBe('1');
  });

  it('removes --md-zoom in split mode (CSS fallback keeps 1:1 editor geometry)', () => {
    render(
      <PreviewPane activeTab={tab('a', 'a.md')} Preview={DummyPreview} vaultRoot="/vault" viewMode="split" />,
    );
    expect(prevBody().style.getPropertyValue('--md-zoom')).toBe('');
  });
});
