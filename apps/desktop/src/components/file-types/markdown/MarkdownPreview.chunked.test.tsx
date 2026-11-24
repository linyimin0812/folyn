// @vitest-environment jsdom
/**
 * Windowed chunked rendering (Phase A3 of the markdown-large-file-open-lag
 * fix) — component-level tests:
 *
 *  - jsdom has NO layout engine (clientHeight is 0 everywhere): the window
 *    hook must DEGRADE to mounting ALL chunks — the doc renders complete
 *    and correct, just not windowed. This is the designed fallback for any
 *    zero-measured / hidden container.
 *  - fullRender (export + presentation paths): the whole document mounts
 *    through the full-document pipeline — no chunk machinery at all.
 *  - Below the chunked thresholds: the render path is EXACTLY the
 *    historical single-pass full render (no spacers, no chunk hoisting).
 *  - Above the thresholds: all chunks' blocks carry the same doc-absolute
 *    data-source-line stamps the full render produces (parity of the
 *    cursor-sync contract), and no content is lost.
 *  - Typing (content change) keeps cached chunk output: an in-place edit
 *    re-renders exactly the ONE changed chunk (A5 per-chunk cache).
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { render, act, cleanup, waitFor } from '@testing-library/react';

vi.mock('../excalidraw/ExcalidrawPreview', () => ({ ExcalidrawPreview: () => null }));
// ponytail: mock the registry + ai store so the import graph skips the heavy
// file-type components (excalidraw dist → open-color JSON, markmap →
// window.katex) — these tests only exercise the markdown pipeline.
vi.mock('@/components/file-types/registry', () => ({
  getHandlerByExtension: () => null,
  getHandlerById: () => null,
  getModeComponent: () => null,
}));
vi.mock('@/store/aiConfigStore', () => ({ useAiConfigStore: () => ({}) }));
// ponytail: spy on the shared render entry so the per-chunk cache test can
// count pipeline invocations (cache hits must NOT invoke the pipeline).
vi.mock('./markdownPipeline', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./markdownPipeline')>();
  const spy = vi.fn(actual.renderMarkdownBody);
  return { ...actual, renderMarkdownBody: spy, __renderSpy: spy };
});

import { MarkdownPreview } from './MarkdownPreview';
import { useEditorViewStateStore } from '@/store/editorViewState';
// The mocked module namespace — carries the __renderSpy export.
import * as mockedPipeline from './markdownPipeline';
const renderSpy = () => (mockedPipeline as unknown as { __renderSpy: ReturnType<typeof vi.fn> }).__renderSpy;

/** Above CHUNKED_MAX_CHUNKS (200) and CHUNKED_MIN_CHARS (100_000).
 *  The padding sentence pushes the body past the 100k character limit —
 *  240 short paragraphs alone only reach ~37k and would exercise the
 *  ordinary full-render path instead of the chunked one. */
function buildLargeDoc(chunkCount: number): string {
  const paras: string[] = [];
  for (let i = 0; i < chunkCount; i++) {
    paras.push(`# chunk ${i} heading`);
    paras.push('');
    paras.push(`para ${i} line one with enough text to make the body exceed one hundred kilobytes in total size so the chunked threshold kicks in for the character limit too. This padding sentence exists purely to push the total past the threshold because two hundred and forty short paragraphs only reach about thirty-seven kilobytes which is not enough for a real test of the chunked path in this suite. It repeats on purpose. It repeats on purpose. It repeats on purpose. It repeats on purpose. It repeats on purpose.`);
    paras.push('');
  }
  return paras.join('\n');
}

const LARGE = buildLargeDoc(240);

const baseProps = {
  filePath: '/tmp/note.md',
  vaultRoot: '',
  onChange: () => {},
  cursorLine: 0,
  cursorViewportY: 0,
  editorViewportTop: 0,
  hasSelection: false,
};

const root = (utils: ReturnType<typeof render>) =>
  utils.container.querySelector('.md-preview') as HTMLElement;

function renderPreview(content: string, extra: Record<string, unknown> = {}) {
  return render(<MarkdownPreview content={content} {...baseProps} {...extra} />);
}

describe('MarkdownPreview windowed chunked rendering', () => {
  beforeAll(() => {
    // Editor metrics so the gap-compensation effect runs like in the app.
    act(() => {
      useEditorViewStateStore.getState().setEditorContentPadTop(16);
    });
  });

  afterAll(() => {
    act(() => {
      useEditorViewStateStore.getState().setEditorContentPadTop(0);
    });
    cleanup();
  });

  it('jsdom (zero-measured container) degrades to mounting ALL chunks — complete content, no spacers', async () => {
    expect(LARGE.length).toBeGreaterThan(100_000); // CHUNKED_MIN_CHARS — the chunked path is armed
    const utils = renderPreview(LARGE);
    // The rAF recompute finds clientHeight 0 → commits the all-chunks set.
    await waitFor(() => {
      expect(root(utils).querySelectorAll('.md-chunk-spacer').length).toBe(0);
    });
    // Every chunk's content is present.
    const text = root(utils).textContent ?? '';
    expect(text).toContain('chunk 0 heading');
    expect(text).toContain('chunk 239 heading');
    const blocks = root(utils).querySelectorAll('[data-source-line]');
    expect(blocks.length).toBeGreaterThanOrEqual(480); // 240 × (heading + para)
    // Stamps are doc-absolute and ordered.
    const lines = Array.from(blocks).map((b) => Number(b.getAttribute('data-source-line')));
    for (let i = 1; i < lines.length; i++) expect(lines[i]).toBeGreaterThan(lines[i - 1]);
    cleanup();
  });

  it('data-source-line stamps match the full-document render exactly (chunked vs full)', async () => {
    // Same doc through both paths; the stamped line sequences must match.
    const utilsChunked = renderPreview(LARGE);
    await waitFor(() => {
      expect(root(utilsChunked).querySelectorAll('.md-chunk-spacer').length).toBe(0);
    });
    const utilsFull = renderPreview(LARGE, { fullRender: true });
    const stampSeq = (u: ReturnType<typeof render>) =>
      Array.from(root(u).querySelectorAll('[data-source-line]')).map((b) =>
        `${b.tagName}:${b.getAttribute('data-source-line')}`);
    expect(stampSeq(utilsChunked)).toEqual(stampSeq(utilsFull));
    cleanup();
  });

  it('fullRender mounts the whole document through the single full pipeline (no chunk spacers)', () => {
    const utils = renderPreview(LARGE, { fullRender: true });
    expect(root(utils).querySelectorAll('.md-chunk-spacer').length).toBe(0);
    expect(root(utils).querySelectorAll('[data-source-line]').length).toBeGreaterThanOrEqual(480);
    expect((root(utils).textContent ?? '')).toContain('chunk 239 heading');
    cleanup();
  });

  it('below the thresholds: exactly the historical full render (no chunk machinery)', () => {
    const content = 'para one.\n\npara two.\n\npara three.';
    const utils = renderPreview(content);
    // No spacers, no chunk markers; the blocks are the full render's.
    expect(root(utils).querySelectorAll('.md-chunk-spacer').length).toBe(0);
    const stamps = Array.from(root(utils).querySelectorAll('[data-source-line]'))
      .map((b) => Number(b.getAttribute('data-source-line')));
    expect(stamps).toEqual([1, 3, 5]);
    cleanup();
  });

  it('an in-place edit re-renders exactly the changed chunk (A5 cache: pipeline invoked once)', async () => {
    const utils = renderPreview(LARGE);
    await waitFor(() => {
      expect(root(utils).querySelectorAll('.md-chunk-spacer').length).toBe(0);
    });
    await waitFor(() => {
      expect((root(utils).textContent ?? '')).toContain('chunk 239 heading');
    });
    const callsBefore = renderSpy().mock.calls.length;
    // In-place edit of chunk 0's paragraph (same line count → no startLine
    // shifts): only that chunk's cache key changes.
    const edited = LARGE.replace('para 0 line one', 'para 0 EDITED line one');
    act(() => {
      utils.rerender(<MarkdownPreview content={edited} {...baseProps} />);
    });
    // Large-doc parse debounce (150ms) then the re-render.
    await waitFor(() => {
      expect((root(utils).textContent ?? '')).toContain('para 0 EDITED line one');
    });
    expect(renderSpy().mock.calls.length - callsBefore).toBe(1);
    cleanup();
  });
});
