// @vitest-environment jsdom
/**
 * Windowed chunked rendering WITH A SIMULATED SCROLLER — jsdom has no
 * layout engine, so these tests stub one at the prototype level (modeled
 * on MarkdownPreview.cursorsync.shortdoc.test.tsx's mini layout engine):
 * the scroll container gets an inline overflow-y + a stubbed clientHeight,
 * and .md-preview's children (blocks by data-source-line registry, gaps +
 * chunk spacers by their live style height) get real rects computed from a
 * children walk, offset by the scroller's live scrollTop. useWindowedChunks'
 * rAF window walk then windows for real, exactly like a browser — unlike
 * MarkdownPreview.chunked.test.tsx, whose zero-measured container exercises
 * the DEGRADE-to-all-mounted path.
 *
 * Doc shape (buildLargeDoc): 240 × (heading, blank, para, blank) = 960
 * lines, >100KB. The chunker emits ONE CHUNK PER BLOCK: chunk 2k = the
 * heading at doc line 4k+1, chunk 2k+1 = the para at doc line 4k+3 (the
 * blank runs between blocks are the inter-chunk gaps). Geometry (the
 * engine's registry): headings 20px, paras 100px; with sync ACTIVE the
 * blank runs render as .md-blank-gap (calc(N × 24px)) → 168px per
 * heading+para pair; with sync IDLE there are no gap divs → 120px per pair.
 *
 * Regression coverage (review findings on the windowed/chunked preview):
 *  FIX 1 — reader-scroll survival: a mounted-set change caused by the
 *    READER's own preview scroll (mountVersion bump) must NOT re-align the
 *    preview to the cursor. The sync is cursor/content-driven: a re-run
 *    whose inputs are unchanged since the last completed alignment
 *    early-returns (the reader's scrollTop survives). Old behavior: every
 *    mountVersion bump re-ran the full alignment → snap-back-to-cursor (or
 *    scrollTo-top when the reader scrolled past the cursor's chunk so no
 *    block ≤ cursorLine is mounted).
 *  FIX 1b — restore-hold guard order: while the host holds
 *    data-restoring-scroll, a cursor move mounts NOTHING (the guards run
 *    BEFORE the mount bridge — the old order mounted the cursor's chunk,
 *    the next rAF window walk unmounted it again, a frame-rate
 *    mount/unmount loop through the whole 1.5s hold).
 *  FIX 2 — inter-chunk gap: a cursor line in a blank run BETWEEN chunks
 *    belongs to no chunk; the mount bridge must mount BOTH neighbors (the
 *    block above the gap is the sync target, the block below is the gap
 *    path's align point). Old behavior: no-op → the sync aligned to a far
 *    already-mounted block → a visible jump-elsewhere-and-back.
 *  FIX 3 — spacer height cache: an edit keeps the measured heights of
 *    chunks whose identity (startLine + text) survived, drops the edited
 *    chunk's stale entry. Old behavior: the whole cache was clear()ed in
 *    an effect AFTER the render consumed the stale index-keyed values,
 *    with no re-render — unmounted spacers kept WRONG heights until
 *    remounted.
 *  FIX 4 — pre-mount band, JUMP-gated: the cursor-sync's mount bridge
 *    pre-mounts the post-alignment band AROUND the target BEFORE the
 *    alignment writes scrollTop (estimate-space, padded) — but ONLY when
 *    the anchor chunk is unmounted (a real jump). The alignment lands on
 *    mounted, measured geometry — no estimate→real swaps happen after it,
 *    so no drift, no hard-jump corrections, and the scroll arrives at
 *    real content instead of spacer blankness popping in (the reported
 *    闪动). The jump gate: the sync effect re-runs on every keystroke /
 *    editor-scroll frame and the walk's trim removes the band's excess
 *    between runs — unconditional staging re-mounted ~70 chunks at
 *    keystroke rate (the reported 变卡). Old behavior: only the target's
 *    chunk mounted; the walk mounted the band one frame later and every
 *    swap shifted the just-aligned block, corrected by visible scrollTop
 *    jumps.
 *  FIX 5 — residual drift correction: when the pre-mount band
 *    under-covers (real heights ≪ estimates — the wrap direction
 *    reversed: shrunk blocks), chunks still mount after the alignment and
 *    shift it; a mountVersion-only re-run corrects by the block's
 *    CONTENT-SPACE drift (scroll-invariant — reader scroll shows 0 drift,
 *    so no snap-back) and re-bases the anchor, converging. Old behavior:
 *    the input gate early-returned and nothing corrected.
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

import { MarkdownPreview } from './MarkdownPreview';
import { useEditorViewStateStore } from '@/store/editorViewState';

const LH = 24; // editor line height
const EDITOR_PAD = 16; // .cm-content padding-top (editor line 1's top)
const VIEWPORT_TOP = 100; // shared editor/preview pane top on screen
const VIEWPORT_H = 600;
const CONTENT_TOP = 16; // .md-preview content offset (matches EDITOR_PAD)

// Filler big enough that the 240×2-block doc clears CHUNKED_MIN_CHARS
// (100_000) — CHUNKED_MAX_CHUNKS (200) is cleared by the 480 chunks.
const FILLER =
  'lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore et dolore magna aliqua enim ad minim veniam quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat duis aute irure dolor in reprehenderit in voluptate velit esse cillum. ';

function buildLargeDoc(chunkCount: number): string {
  const paras: string[] = [];
  for (let i = 0; i < chunkCount; i++) {
    paras.push(`# chunk ${i} heading`);
    paras.push('');
    paras.push(`para ${i} line one ${FILLER}${FILLER}`);
    paras.push('');
  }
  return paras.join('\n');
}

const LARGE = buildLargeDoc(240);
// Doc-chunk i (heading line 4i+1, para line 4i+3); line 4i+4 is the blank
// run AFTER doc-chunk i's para — the inter-chunk gap the FIX 2 path covers.
// Chunk indices: 2i = the heading, 2i+1 = the para.
const docChunkHeadingLine = (i: number) => 4 * i + 1;
const docChunkParaLine = (i: number) => 4 * i + 3;
const docChunkGapLine = (i: number) => 4 * i + 4;

// ---- mini layout engine -------------------------------------------------
// Block heights by data-source-line; heading lines 20px, para lines 100px
// (deliberately ≠ the 24px/line editor rate so measured spacer heights are
// distinguishable from line-arithmetic estimates).
const HEIGHTS = new Map<number, number>();
let scrollContainerEl: HTMLElement | null = null;

const registerDoc = (content: string) => {
  HEIGHTS.clear();
  content.split('\n').forEach((t, i) => {
    if (t.trim() === '') return;
    const line = i + 1;
    HEIGHTS.set(line, (line - 1) % 4 === 0 ? 20 : 100);
  });
};

/** A gap/spacer div's live height: 'NNpx' or calc(N × var(--md-gap-line)). */
const inlineHeightOf = (el: HTMLElement): number => {
  const s = el.style.height ?? '';
  if (s.endsWith('px')) return parseFloat(s) || 0;
  const m = s.match(/^calc\((\d+)/);
  return m ? Number(m[1]) * LH : 0;
};

const childHeight = (el: HTMLElement): number => {
  if (el.classList.contains('md-chunk-spacer') || el.classList.contains('md-blank-gap')) {
    return inlineHeightOf(el);
  }
  return HEIGHTS.get(Number(el.getAttribute('data-source-line'))) ?? 0;
};

/** Content-space top of a child of .md-preview (children walk). */
const topOf = (el: HTMLElement): number => {
  const rootEl = el.closest('.md-preview');
  if (!rootEl) return 0;
  let y = CONTENT_TOP;
  for (const kid of Array.from(rootEl.children) as HTMLElement[]) {
    if (kid === el) return y;
    y += childHeight(kid);
  }
  return CONTENT_TOP;
};

const isPreviewContent = (el: HTMLElement): boolean =>
  el.closest('.md-preview') != null
  && (el.classList.contains('md-chunk-spacer')
    || el.classList.contains('md-blank-gap')
    || el.getAttribute('data-source-line') != null);

const rect = (top: number, h: number): DOMRect =>
  ({ top, bottom: top + h, height: h, left: 0, right: 600, width: 600, x: 0, y: top, toJSON: () => ({}) }) as DOMRect;
const zeroRect = (): DOMRect =>
  ({ top: 0, bottom: 0, height: 0, left: 0, right: 0, width: 0, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;

let spies: { mockRestore: () => void }[] = [];
let origScrollTo: ((this: Element, o?: ScrollToOptions) => void) | undefined;

beforeAll(() => {
  spies.push(vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    if (this === scrollContainerEl) return rect(VIEWPORT_TOP, VIEWPORT_H);
    if (!isPreviewContent(this)) return zeroRect();
    const h = childHeight(this);
    return rect(VIEWPORT_TOP + topOf(this) - (scrollContainerEl?.scrollTop ?? 0), h);
  }));
  spies.push(vi.spyOn(HTMLElement.prototype, 'getClientRects').mockImplementation(function (this: HTMLElement) {
    return isPreviewContent(this) ? [this.getBoundingClientRect() as DOMRect] : [];
  }));
  origScrollTo = Element.prototype.scrollTo;
  Element.prototype.scrollTo = function (this: Element, o?: ScrollToOptions) {
    (this as HTMLElement).scrollTop = o?.top ?? 0;
  };
  act(() => {
    useEditorViewStateStore.getState().setEditorContentPadTop(EDITOR_PAD);
  });
});

afterAll(() => {
  spies.forEach((s) => s.mockRestore());
  spies = [];
  if (origScrollTo) Element.prototype.scrollTo = origScrollTo;
  scrollContainerEl = null;
  act(() => {
    useEditorViewStateStore.getState().setEditorContentPadTop(0);
  });
  cleanup();
});

// ---- helpers --------------------------------------------------------------

const root = (utils: ReturnType<typeof render>) =>
  utils.container.querySelector('.md-preview') as HTMLElement;
const scrollEl = (utils: ReturnType<typeof render>) => root(utils).parentElement as HTMLElement;
const spacerOf = (utils: ReturnType<typeof render>, i: number) =>
  root(utils).querySelector(`.md-chunk-spacer[data-md-chunk="${i}"]`) as HTMLElement | null;
const textOf = (utils: ReturnType<typeof render>) => root(utils).textContent ?? '';

/** Arm the simulated scroller on a fresh render: inline overflow-y (found
 *  by findScrollContainer once the walk re-runs) + a real clientHeight. */
const armScroller = (utils: ReturnType<typeof render>): HTMLElement => {
  const sc = scrollEl(utils);
  sc.style.overflowY = 'auto';
  Object.defineProperty(sc, 'clientHeight', { value: VIEWPORT_H, configurable: true });
  scrollContainerEl = sc;
  return sc;
};

/** One editor step: cursor line + editor metrics via the store (mirrors
 *  EditorView's setCursorViewportY publication). The editor keeps the
 *  cursor within its 600px viewport — cursorViewportY is the cursor's Y in
 *  the EDITOR VIEWPORT (≤ ~400), never its doc-absolute Y. */
const driveCursor = (utils: ReturnType<typeof render>, content: string, line: number) => {
  const cursorViewportY = Math.min(EDITOR_PAD + (line - 1) * LH, 400);
  act(() => {
    utils.rerender(
      <MarkdownPreview
        content={content}
        filePath="/tmp/note.md"
        vaultRoot=""
        onChange={() => {}}
        cursorLine={line}
        cursorViewportY={cursorViewportY}
        editorViewportTop={VIEWPORT_TOP}
        hasSelection={false}
      />,
    );
    useEditorViewStateStore.getState().setCursorViewportY(
      cursorViewportY, VIEWPORT_TOP, 0, LH, 0, 0, line,
    );
  });
};

const renderIdle = (content: string) =>
  render(
    <MarkdownPreview
      content={content}
      filePath="/tmp/note.md"
      vaultRoot=""
      onChange={() => {}}
      cursorLine={0}
      cursorViewportY={0}
      editorViewportTop={0}
      hasSelection={false}
    />,
  );

/** Wait until the initial window converged: the top doc-chunks mounted,
 *  far chunks spacers. */
const waitForWindowed = async (utils: ReturnType<typeof render>) => {
  await waitFor(() => {
    expect(textOf(utils)).toContain('chunk 0 heading');
    expect(spacerOf(utils, 200)).toBeTruthy(); // far-away chunk is a spacer
  });
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('MarkdownPreview windowed rendering — simulated scroller', () => {
  // The mini layout engine's rect walk is O(children²) per recompute and
  // the 480-chunk doc's pipeline render is heavy — each test legitimately
  // needs tens of seconds of jsdom time.
  it('the doc clears both chunked thresholds (windowing armed — real windows, not the degrade path)', async () => {
    expect(LARGE.length).toBeGreaterThan(100_000); // CHUNKED_MIN_CHARS
    registerDoc(LARGE);
    const utils = renderIdle(LARGE);
    const sc = armScroller(utils);
    await waitForWindowed(utils);
    // The rAF window walk found the stubbed scroller and narrowed the
    // estimate-based initial set to the visible window.
    await waitFor(() => {
      // Top doc-chunks (0..~10) mounted; doc-chunk 1's para is chunk 3.
      expect(spacerOf(utils, 22)).toBeTruthy();
      expect(textOf(utils)).toContain('chunk 1 heading');
      expect(textOf(utils)).toContain('para 1 line one');
    });
    expect(sc.clientHeight).toBe(VIEWPORT_H);
    expect(root(utils).querySelectorAll('.md-chunk-spacer').length).toBeGreaterThan(200);
    cleanup();
  }, 60_000);

  it("FIX 1: the reader's own scroll survives a window change (no snap-back to the cursor)", async () => {
    registerDoc(LARGE);
    // Start with the cursor on doc-chunk 0's para (inside the initial
    // window — the sync completes immediately: mounts nothing, aligns near
    // the top).
    const utils = render(
      <MarkdownPreview
        content={LARGE}
        filePath="/tmp/note.md"
        vaultRoot=""
        onChange={() => {}}
        cursorLine={docChunkParaLine(0)}
        cursorViewportY={EDITOR_PAD + (docChunkParaLine(0) - 1) * LH}
        editorViewportTop={VIEWPORT_TOP}
        hasSelection={false}
      />,
    );
    const sc = armScroller(utils);
    act(() => {
      useEditorViewStateStore.getState().setCursorViewportY(
        EDITOR_PAD + (docChunkParaLine(0) - 1) * LH, VIEWPORT_TOP, 0, LH, 0, 0, docChunkParaLine(0),
      );
    });
    await waitForWindowed(utils);
    // The first alignment completed (scrollTop settled near the cursor at
    // the top) and the deferred parse flushed (no later re-run pending).
    await waitFor(() => expect(sc.scrollTop).toBeLessThan(2000));
    await sleep(400);
    expect(sc.scrollTop).toBeLessThan(2000);

    // The READER scrolls the preview far past the cursor's chunk.
    sc.scrollTop = 4000;
    sc.dispatchEvent(new Event('scroll'));
    // The window follows the reader (mountVersion bumped: early chunks
    // unmounted, mid chunks mounted) — non-vacuous: the set DID change.
    await waitFor(() => {
      expect(textOf(utils)).toContain('chunk 25 heading'); // ~4.2k content px
      expect(spacerOf(utils, 0)).toBeTruthy();
    }, { timeout: 10_000 });
    // THE regression: the sync must not re-assert its alignment on the
    // mountVersion-only re-run — the reader's position survives. (Old code
    // re-ran the full alignment → snap-back to the cursor near the top.)
    await waitFor(() => expect(sc.scrollTop).toBe(4000), { timeout: 10_000 });
    // …and it STAYS there (no late re-assert once effects settle).
    await sleep(150);
    expect(sc.scrollTop).toBe(4000);
    cleanup();
  }, 60_000);

  it('FIX 1b: during the restoringScroll hold a cursor move mounts nothing (no mount/unmount loop)', async () => {
    registerDoc(LARGE);
    const utils = renderIdle(LARGE);
    const sc = armScroller(utils);
    await waitForWindowed(utils);

    // PreviewPane is restoring the saved reading position for this tab.
    sc.dataset.restoringScroll = '';
    // Cursor jumps to a FAR gap line while the hold is active.
    driveCursor(utils, LARGE, docChunkGapLine(100));
    // Several frames pass: the guards run BEFORE the mount bridge, so
    // nothing mounts — both neighbors of the gap stay spacers the whole
    // hold (old order: mount → rAF unmount → mount… a frame-rate loop).
    for (let k = 0; k < 5; k++) {
      await sleep(40);
      expect(textOf(utils)).not.toContain('para 100 line one'); // chunk 201
      expect(textOf(utils)).not.toContain('chunk 101 heading'); // chunk 202
      expect(spacerOf(utils, 201)).toBeTruthy();
      expect(spacerOf(utils, 202)).toBeTruthy();
    }
    // Hold released + the next cursor move mounts and aligns normally.
    delete sc.dataset.restoringScroll;
    driveCursor(utils, LARGE, docChunkHeadingLine(101));
    await waitFor(() => {
      expect(textOf(utils)).toContain('chunk 101 heading');
    }, { timeout: 10_000 });
    cleanup();
  }, 60_000);

  it('FIX 2: a cursor line in an inter-chunk blank gap mounts BOTH neighbor chunks', async () => {
    registerDoc(LARGE);
    const utils = renderIdle(LARGE);
    const sc = armScroller(utils);
    await waitForWindowed(utils);

    // Cursor onto the blank line BETWEEN doc-chunk 100's para (chunk 201)
    // and doc-chunk 101's heading (chunk 202) — a line that belongs to no
    // chunk. Old code: findChunkForLine misses → no-op → the sync aligned
    // to a far already-mounted block (jump-elsewhere-and-back).
    driveCursor(utils, LARGE, docChunkGapLine(100));
    await waitFor(() => {
      expect(textOf(utils)).toContain('para 100 line one'); // chunk 201
      expect(textOf(utils)).toContain('chunk 101 heading'); // chunk 202
    }, { timeout: 10_000 });
    // And the sync aligned INTO that neighborhood: the gap path aligns the
    // NEXT block's top (chunk 202's heading, ~13.2k content px) to the
    // cursor's editor-viewport Y (~400) — not the top window.
    await waitFor(() => expect(sc.scrollTop).toBeGreaterThan(10_000), { timeout: 10_000 });
    cleanup();
  }, 60_000);

  it('FIX 4: a jump pre-mounts the band onto measured geometry — no post-alignment jumps, no per-keystroke re-staging (no flicker, no lag)', async () => {
    registerDoc(LARGE);
    // Boost the REAL heights of doc-chunks 90..99's paras — far above the
    // initial window, never measured, so without the pre-mount their
    // spacers carry the 48px line-arithmetic estimate. driveCursor targets
    // doc-chunk 100's para; the overscan band above it (~1000 real px)
    // intersects the boosted region — the pre-mount band (estimate-space,
    // padded ×1.5) covers it entirely, so the alignment reads MEASURED
    // geometry and nothing swaps under it afterwards.
    for (let k = 90; k <= 99; k++) HEIGHTS.set(docChunkParaLine(k), 300);
    const utils = renderIdle(LARGE);
    const sc = armScroller(utils);
    await waitForWindowed(utils);
    driveCursor(utils, LARGE, docChunkParaLine(100));
    const para = () =>
      root(utils).querySelector(`[data-source-line="${docChunkParaLine(100)}"]`) as HTMLElement | null;
    await waitFor(() => expect(para()).toBeTruthy(), { timeout: 10_000 });
    // The alignment puts the para's top at the cursor's screen Y
    // (driveCursor caps the editor-viewport Y at 400 → screen 500).
    const cursorScreenY = VIEWPORT_TOP + 400;
    // The walk churn + trims are rAF-driven and each walk is O(children²)
    // in jsdom, so settle time varies with machine load — WAIT for the
    // invariant, not a fixed-time snapshot.
    await waitFor(
      () => expect(Math.abs((para()?.getBoundingClientRect().top ?? 0) - cursorScreenY)).toBeLessThanOrEqual(3),
      { timeout: 30_000 },
    );
    // …and it STAYS (no late drift once effects settle).
    await sleep(300);
    expect(Math.abs((para()?.getBoundingClientRect().top ?? 0) - cursorScreenY)).toBeLessThanOrEqual(3);
    // THE flicker regression: after the alignment write, scrollTop NEVER
    // changes again — every drift correction is a visible hard jump (the
    // reported 闪动), and without the pre-mount the boosted swaps above
    // the para forced a chain of them. (The walk's trim of the band's
    // excess swaps measured↔measured — height-neutral, no correction.)
    const settled = sc.scrollTop;
    await sleep(400);
    expect(sc.scrollTop).toBe(settled);
    expect(Math.abs((para()?.getBoundingClientRect().top ?? 0) - cursorScreenY)).toBeLessThanOrEqual(3);

    // THE lag regression (变卡): a NEARBY cursor move (anchor chunk already
    // mounted — one doc-chunk below, inside the walk's band + pin) must NOT
    // re-stage the pre-mount band. The band is only for real jumps; the
    // sync effect re-runs on every keystroke and the walk's trim removes
    // the band's excess between runs, so unconditional staging re-mounts
    // ~70 chunks at keystroke rate. The staged band is observable
    // synchronously in the act() flush (before the next rAF walk trims):
    // with the jump gate, doc-chunk 90's heading (a band-only chunk, far
    // above the walk band) stays a spacer; without the gate it renders.
    const farBandHeading = () =>
      root(utils).querySelector(`[data-source-line="${docChunkHeadingLine(90)}"]`);
    driveCursor(utils, LARGE, docChunkHeadingLine(101));
    expect(farBandHeading()).toBeNull();
    // The nearby move still aligns its own target (no band needed — the
    // anchor was mounted, measured geometry above)…
    const heading101 = () =>
      root(utils).querySelector(`[data-source-line="${docChunkHeadingLine(101)}"]`) as HTMLElement | null;
    await waitFor(
      () => expect(Math.abs((heading101()?.getBoundingClientRect().top ?? 0) - cursorScreenY)).toBeLessThanOrEqual(3),
      { timeout: 30_000 },
    );
    await sleep(300);
    // …and nothing re-staged the band later either.
    expect(farBandHeading()).toBeNull();
    cleanup();
  }, 90_000);

  it('FIX 5: residual mount drift beyond the pre-mount band is corrected by the content-space drift (alignment survives)', async () => {
    registerDoc(LARGE);
    // SHRINK the real heights of doc-chunks 60..99's paras to 8px — real
    // ≪ estimate (the wrap direction reversed). The pre-mount band buys
    // ESTIMATE-space coverage (48px/chunk), so it under-covers REAL px: the
    // walk band above the aligned para (~1000 real px) extends ~4 doc-chunk
    // pairs beyond the pre-mounted edge, those chunks mount AFTER the
    // alignment, and each estimate→real swap (48 → 28/16) shifts the para
    // up ~200px — the drift correction must restore it and re-base its
    // anchor (converging after one correction, not over-correcting).
    for (let k = 60; k <= 99; k++) HEIGHTS.set(docChunkParaLine(k), 8);
    const utils = renderIdle(LARGE);
    const sc = armScroller(utils);
    await waitForWindowed(utils);
    driveCursor(utils, LARGE, docChunkParaLine(100));
    const para = () =>
      root(utils).querySelector(`[data-source-line="${docChunkParaLine(100)}"]`) as HTMLElement | null;
    await waitFor(() => expect(para()).toBeTruthy(), { timeout: 10_000 });
    const cursorScreenY = VIEWPORT_TOP + 400;
    // Converge: the residual drift correction restores the aligned screen
    // position (old behavior: the input gate early-returned, the para sat
    // ~200px off and stayed there — the user-reported misalignment).
    await waitFor(
      () => expect(Math.abs((para()?.getBoundingClientRect().top ?? 0) - cursorScreenY)).toBeLessThanOrEqual(3),
      { timeout: 30_000 },
    );
    // …and it STAYS: the correction re-based its anchor to the
    // post-correction offset, so later re-runs don't re-fire (no cumulative
    // over-correction loop).
    await sleep(400);
    expect(Math.abs((para()?.getBoundingClientRect().top ?? 0) - cursorScreenY)).toBeLessThanOrEqual(3);
    cleanup();
  }, 90_000);

  it('FIX 3: an edit preserves measured spacer heights of unchanged chunks, drops the edited one', async () => {
    registerDoc(LARGE);
    const utils = renderIdle(LARGE); // sync idle → no gap divs (120px/pair)
    const sc = armScroller(utils);
    await waitForWindowed(utils);
    // Scroll away so the early chunks unmount as MEASURED spacers (their
    // heights were recorded while they were mounted).
    sc.scrollTop = 4000;
    sc.dispatchEvent(new Event('scroll'));
    await waitFor(() => {
      expect(textOf(utils)).toContain('chunk 33 heading'); // ~4.0k content px
      expect(spacerOf(utils, 0)).toBeTruthy();
    });
    // Measured heights: chunk 0 = the h1 (20px); chunk 11 = doc-chunk 5's
    // para (100px). NOT the (1+1)×24+16 = 64px line-arithmetic estimates.
    expect(parseFloat(spacerOf(utils, 0)?.style.height ?? '0')).toBe(20);
    expect(parseFloat(spacerOf(utils, 11)?.style.height ?? '0')).toBe(100);

    // In-place edit of doc-chunk 5's para (same line count → no startLine
    // shifts): chunk 11's identity (startLine + text) changes; every other
    // chunk keeps its identity. The 150ms parse debounce lands the new
    // chunks — wait for the settle first (the rAF walk churn is slow).
    const edited = LARGE.replace('para 5 line one', 'para 5 EDITED line one');
    act(() => {
      utils.rerender(
        <MarkdownPreview
          content={edited}
          filePath="/tmp/note.md"
          vaultRoot=""
          onChange={() => {}}
          cursorLine={0}
          cursorViewportY={0}
          editorViewportTop={0}
          hasSelection={false}
        />,
      );
    });
    // The re-chunk drops chunk 11's stale measurement → its spacer falls
    // back to the 64px estimate… (old code: the index-keyed map kept the
    // stale 100px entry through this render and clear()ed afterwards with
    // no re-render — the spacer kept the WRONG height).
    await waitFor(() => {
      expect(parseFloat(spacerOf(utils, 11)?.style.height ?? '0')).toBe(64);
    }, { timeout: 15_000 });
    // …while chunk 0's (unchanged identity) measured height survives.
    expect(parseFloat(spacerOf(utils, 0)?.style.height ?? '0')).toBe(20);
    // The window itself still covers the reader's position (the edit did
    // not reset geometry anywhere visible).
    expect(textOf(utils)).toContain('chunk 33 heading');
    cleanup();
  }, 90_000);
});
