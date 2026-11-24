import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import type { MarkdownChunk } from './chunkMarkdown';

/**
 * ponytail: windowed chunk mounting for LARGE markdown docs (the
 * markdown-open-lag fix). The chunked body renders only the chunks near
 * the viewport; the rest are height-estimated `.md-chunk-spacer` divs.
 * The window is recomputed on scroll / resize / content change, plus one
 * rAF after every mount change so newly mounted chunks are measured and
 * the window converges.
 *
 * Chunk attribution needs NO wrapper DOM: `.md-preview`'s top-level
 * children carry `data-source-line` (blocks — attributed to the chunk
 * whose body-line range contains the line, via binary search) or
 * `data-md-chunk` (spacers). Chunk children stay hoisted as direct
 * children of `.md-preview`, so the runtime gap-compensation walk,
 * cursor-sync block queries and export DOM extraction see the exact same
 * structure as a full render (plus inert spacers).
 *
 * jsdom / zero-measured containers (clientHeight 0) and containers with
 * no scrolling ancestor degrade to mounting ALL chunks — correct, just
 * not windowed (tests, embedded mini-previews).
 */

/** Chunks mounted above/below the visible ones. */
const OVERSCAN_CHUNKS = 2;
/** Extra px around the viewport that counts as visible. */
const OVERSCAN_PX = 600;
/** Initial window before any DOM measurement (px of estimated content). */
const INITIAL_WINDOW_PX = 3200;
/** Line-height estimate before the editor has measured one. */
export const CHUNK_ESTIMATE_LINE_HEIGHT = 24;
/** Viewport-height cap for the cursor-sync pre-mount band: bounds the
 *  transient mount cost on very tall viewports (residual coverage gaps
 *  fall to the sync's drift correction). */
const ENSURE_VIEWPORT_CAP = 1200;
/** Estimate-space pad for the pre-mount band: line-arithmetic estimates
 *  under-cover soft-wrapped content (real heights run taller), so the
 *  band buys extra estimated px to compensate. */
const ENSURE_BAND_PAD = 1.5;
/** Viewport fallback when the scroller is not measurable at ensure time. */
const ENSURE_VIEWPORT_FALLBACK = 800;

/** First scroller (overflow-y auto/scroll) above `el`, or null. */
function findScrollContainer(el: HTMLElement): HTMLElement | null {
  let node: HTMLElement | null = el.parentElement;
  while (node && node !== document.body) {
    const overflowY = getComputedStyle(node).overflowY;
    if (overflowY === 'auto' || overflowY === 'scroll') return node;
    node = node.parentElement;
  }
  return null;
}

/** Doc-absolute line → chunk index (chunks tile the body without overlap). */
function findChunkForLine(chunks: MarkdownChunk[], bodyLine: number): number {
  let lo = 0;
  let hi = chunks.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const c = chunks[mid];
    if (bodyLine < c.startLine) hi = mid - 1;
    else if (bodyLine > c.startLine + c.lineCount - 1) lo = mid + 1;
    else return mid;
  }
  return -1;
}

/** First chunk index whose startLine is > bodyLine (binary search). */
function firstChunkAfterLine(chunks: MarkdownChunk[], bodyLine: number): number {
  let lo = 0;
  let hi = chunks.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (chunks[mid].startLine > bodyLine) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

/**
 * The chunk indices to mount for a doc-absolute cursor line — the
 * cursor-sync bridge's target set (pure, exported for tests).
 *
 * A line INSIDE a chunk mounts that chunk and its SUCCESSOR (the gap path
 * below aligns to the NEXT block, which lives in the successor).
 *
 * A line in an inter-chunk blank run belongs to NO chunk (findChunkForLine
 * misses) — but the sync still needs geometry on both sides of the gap:
 * the block ABOVE it (the greatest line ≤ cursorLine, in the predecessor)
 * as the target, and the block BELOW (the successor's first block) as the
 * align point. Mount BOTH neighbors. A cursor above the body (frontmatter
 * / leading blanks) resolves to chunk 0 + no predecessor; a cursor past the
 * EOF gap resolves to the last chunk (always mounted anyway) + its
 * predecessor. Without the gap path a cursor jump onto an unvisited blank
 * line mounted nothing, and the sync aligned to the next MOUNTED block —
 * the always-mounted last chunk at the doc bottom — a visible
 * jump-to-bottom-and-back.
 */
export function chunksToMountForLine(
  chunks: MarkdownChunk[],
  frontmatterLineCount: number,
  docLine: number,
): number[] {
  if (chunks.length === 0) return [];
  const bodyLine = docLine - frontmatterLineCount;
  const idx = findChunkForLine(chunks, bodyLine);
  if (idx >= 0) return [idx, Math.min(idx + 1, chunks.length - 1)];
  // Gap (or pre-body / past-EOF): the first chunk starting after the line,
  // clamped to the last chunk, plus its predecessor.
  const next = Math.min(firstChunkAfterLine(chunks, bodyLine), chunks.length - 1);
  return [next, next - 1];
}

/**
 * Chunk identity for the measured-height cache: `startLine` + the chunk
 * text — the same identity the per-chunk element cache in MarkdownPreview
 * uses (cache key by startLine + text verification). An edit that changes
 * a chunk's text or shifts its startLine makes it a NEW identity (its old
 * measurement is stale); an edit elsewhere keeps the identity and the
 * measurement survives.
 */
function chunkIdentity(c: MarkdownChunk): string {
  return `${c.startLine}\u0000${c.text}`;
}

export interface WindowedChunksParams {
  /** Windowing armed (doc above the chunked threshold). */
  enabled: boolean;
  chunks: MarkdownChunk[];
  containerRef: React.RefObject<HTMLDivElement | null>;
  /** Frontmatter line count — data-source-line values are doc-absolute. */
  frontmatterLineCount: number;
  /** Editor line height (px) for height estimates; 0 → fallback. */
  lineHeight: number;
}

export interface WindowedChunksState {
  /** Indices of mounted chunks (non-contiguous is fine). */
  mounted: Set<number>;
  /** Bumps by 1 on every mounted-set change. */
  mountVersion: number;
  /** Mount the chunk(s) needed to sync a doc-absolute line (cursor sync)
   *  plus the post-alignment BAND around them (see ensureChunkMountedForLine).
   *  Returns true when the mounted set changed (a mount commit is pending
   *  — the DOM is stale until the re-render). */
  ensureChunkMountedForLine: (docLine: number) => boolean;
  /**
   * Measured content-space height of chunk `i` (leading gap included),
   * or undefined when never measured. Keyed by chunk IDENTITY
   * (startLine + text) internally, so an edit elsewhere in the doc keeps
   * the measurements of unchanged chunks — spacers don't collapse back
   * to line-arithmetic estimates on every parse flush.
   */
  measuredHeight: (i: number) => number | undefined;
}

export function useWindowedChunks({
  enabled,
  chunks,
  containerRef,
  frontmatterLineCount,
  lineHeight,
}: WindowedChunksParams): WindowedChunksState {
  const mountedRef = useRef<Set<number>>(new Set<number>());
  // The cursor-sync's PINNED doc line (set by ensureChunkMountedForLine):
  // its chunks stay mounted on every recompute, like the last chunk.
  // The completed alignment's drift anchor is the target block ELEMENT —
  // if the window rotation unmounts it (a walk reading pre-correction
  // rects), the anchor goes blind and later content-space drift breaks the
  // alignment with no one left to correct it (the user-reported 对齐后
  // 又不对齐). Pinning costs ≤2 chunks of memory.
  const pinnedLineRef = useRef<number | null>(null);
  const versionRef = useRef(0);
  // Measured heights keyed by chunk IDENTITY (startLine + text), not
  // index: indices shift on every edit; identities survive edits that
  // don't touch the chunk.
  const measuredHeightsRef = useRef<Map<string, number>>(new Map());
  const prevChunksRef = useRef<MarkdownChunk[] | null>(null);
  const [mounted, setMounted] = useState<Set<number>>(() => {
    if (!enabled) return new Set(chunks.map((_, i) => i));
    // Initial window from line estimates (no DOM yet): cover roughly
    // INITIAL_WINDOW_PX of content from the top of the doc.
    const lh = lineHeight > 0 ? lineHeight : CHUNK_ESTIMATE_LINE_HEIGHT;
    let budget = INITIAL_WINDOW_PX;
    const set = new Set<number>();
    for (let i = 0; i < chunks.length; i++) {
      set.add(i);
      budget -= (chunks[i].lineCount + chunks[i].blankLinesAfter) * lh;
      if (budget <= 0) break;
    }
    return set;
  });
  const [mountVersion, setMountVersion] = useState(0);
  mountedRef.current = mounted;

  const commit = useCallback((next: Set<number>) => {
    const cur = mountedRef.current;
    if (cur.size === next.size && [...next].every((i) => cur.has(i))) return;
    mountedRef.current = next;
    versionRef.current += 1;
    setMounted(next);
    setMountVersion(versionRef.current);
  }, []);

  // ponytail: rebuild the measured-height cache during render, keyed by
  // chunk identity. The OLD code clear()ed the whole map in an effect on
  // every [chunks] change — i.e. after the render already consumed the
  // (then still-old) values, with no re-render afterwards — so every
  // debounced parse flush while typing reverted all unmounted spacers to
  // line-arithmetic estimates and off-screen geometry reset per flush
  // (reading position jumped when the viewport was away from the cursor,
  // or sync was off). Rebuilding during render keeps measurements for
  // chunks whose identity (startLine + text) survived the edit and drops
  // the stale ones in the same pass. The prune is idempotent — same chunks
  // + same source map produce the same result — so re-renders and
  // StrictMode double-renders are safe.
  if (prevChunksRef.current !== chunks) {
    prevChunksRef.current = chunks;
    const pruned = new Map<string, number>();
    for (const c of chunks) {
      const k = chunkIdentity(c);
      const h = measuredHeightsRef.current.get(k);
      if (h != null) pruned.set(k, h);
    }
    measuredHeightsRef.current = pruned;
  }

  const recompute = useCallback(() => {
    if (!enabled) return;
    const root = containerRef.current;
    if (!root) return;
    const sc = findScrollContainer(root);
    if (!sc || sc.clientHeight === 0) {
      // jsdom / hidden container — degrade to all (correct, not windowed).
      commit(new Set(chunks.map((_, i) => i)));
      return;
    }
    const scRect = sc.getBoundingClientRect();
    const visTop = scRect.top - OVERSCAN_PX;
    const visBottom = scRect.bottom + OVERSCAN_PX;
    const next = new Set<number>();
    // Always mount the last chunk: the EOF gap + trailing content must
    // exist for the cursor-at-EOF sync path (and for scroll-height).
    if (chunks.length > 0) next.add(chunks.length - 1);
    // And the cursor-sync's pinned chunks (see pinnedLineRef) — same
    // reasoning as the last chunk: the sync's drift anchor must survive
    // window rotation.
    if (pinnedLineRef.current != null) {
      for (const k of chunksToMountForLine(chunks, frontmatterLineCount, pinnedLineRef.current)) {
        if (k >= 0) next.add(k);
      }
    }
    const heights = measuredHeightsRef.current;
    const starts = new Map<number, number>();
    const ends = new Map<number, number>();
    // Leading .md-blank-gap(s) before a chunk's first block belong to that
    // chunk (per-chunk rehypeBlankGap); accumulate their measured height.
    let pendingGap = 0;
    for (const kid of Array.from(root.children) as HTMLElement[]) {
      if (kid.classList.contains('md-chunk-spacer')) {
        const rect = kid.getBoundingClientRect();
        if (rect.bottom > visTop && rect.top < visBottom) {
          const idx = Number(kid.getAttribute('data-md-chunk'));
          if (Number.isInteger(idx)) {
            for (let k = Math.max(0, idx - OVERSCAN_CHUNKS); k <= Math.min(chunks.length - 1, idx + OVERSCAN_CHUNKS); k++) {
              next.add(k);
            }
          }
        }
        pendingGap = 0;
        continue;
      }
      if (kid.classList.contains('md-blank-gap')) {
        pendingGap += kid.getBoundingClientRect().height;
        continue;
      }
      const lineRaw = kid.getAttribute('data-source-line');
      if (lineRaw == null) continue; // SkillMetaCard etc.
      const idx = findChunkForLine(chunks, Number(lineRaw) - frontmatterLineCount);
      if (idx < 0) continue;
      const rect = kid.getBoundingClientRect();
      if (rect.bottom > visTop && rect.top < visBottom) {
        for (let k = Math.max(0, idx - OVERSCAN_CHUNKS); k <= Math.min(chunks.length - 1, idx + OVERSCAN_CHUNKS); k++) {
          next.add(k);
        }
      }
      // Measurement in content space (chunk height incl. its leading gap).
      const contentTop = rect.top - scRect.top + sc.scrollTop;
      if (!starts.has(idx)) starts.set(idx, contentTop - pendingGap);
      ends.set(idx, Math.max(ends.get(idx) ?? 0, contentTop + rect.height));
      pendingGap = 0;
    }
    for (const [idx, start] of starts) {
      heights.set(chunkIdentity(chunks[idx]), (ends.get(idx) ?? start) - start);
    }
    commit(next);
  }, [enabled, chunks, containerRef, frontmatterLineCount, commit]);

  // Scroll events can fire faster than frames — coalesce recomputes to
  // one per frame (the walk reads rects over every child, so running it per
  // event would dominate on very long docs).
  const rafPendingRef = useRef(0);
  const schedule = useCallback(() => {
    if (rafPendingRef.current) return;
    rafPendingRef.current = requestAnimationFrame(() => {
      rafPendingRef.current = 0;
      recompute();
    });
  }, [recompute]);

  // Subscribe scroll/resize + one rAF per mount change (convergence).
  useLayoutEffect(() => {
    if (!enabled) return;
    const root = containerRef.current;
    if (!root) return;
    const sc = findScrollContainer(root);
    if (sc) sc.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    const raf = requestAnimationFrame(recompute);
    return () => {
      if (sc) sc.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      cancelAnimationFrame(raf);
      if (rafPendingRef.current) {
        cancelAnimationFrame(rafPendingRef.current);
        rafPendingRef.current = 0;
      }
    };
  }, [enabled, chunks, recompute, schedule, mounted, containerRef]);

  /** Cursor-sync bridge: mount the chunks a doc-absolute line needs (see
   *  chunksToMountForLine) — plus the whole post-alignment BAND around
   *  them. The alignment writes scrollTop and lands the viewport on a
   * region whose chunks are still never-measured estimate spacers; the
   * window walk then mounts them one frame later and every estimate→real
   * swap shifts the content below it, so the just-written alignment
   * breaks and the drift correction has to hard-jump scrollTop to
   * restore it — visibly, repeatedly (the reported 闪动). Pre-mounting
   * the band first means the swaps happen BEFORE the alignment reads
   * geometry: it lands on final geometry, nothing moves after, and the
   * scroll arrives at real content instead of spacer blankness popping
   * in. The walk trims the band's excess on its next run (the measured
   * heights are identity-cached, so the trim's spacer swaps are neutral).
   * Coverage is ESTIMATE-space (lineCount × lineHeight, padded for soft
   * wrap); a viewport cap bounds the transient mount cost. Returns true
   * when the mounted set changed. Also PINs the line: every later
   *  recompute keeps its chunks mounted (window rotation never unmounts
   *  the sync's drift anchor).
   *
   *  The JUMP gate: the band stages ONLY when the anchor chunk
   *  (targets[0] — the chunk at/after the cursor line, where the sync's
   *  alignment target lives) is NOT yet mounted — a real jump (far
   *  scroll, click). The sync effect re-runs on every input change (every
   *  keystroke, every editor-scroll frame) and the walk's trim removes
   *  the band's excess between runs, so staging unconditionally re-mounts
   *  ~70 chunks at keystroke rate (the reported 变卡). When the anchor is
   *  already mounted (typing, small scrolls — the walk's band covers the
   *  viewport and the aligned block sits in it), the targets alone
   *  suffice: geometry above is measured or height-cached (unmounts don't
   *  drop the identity-keyed cache), and residual swaps fall to the
   *  sync's drift correction / native scroll anchoring. */
  const ensureChunkMountedForLine = useCallback((docLine: number): boolean => {
    if (!enabled) return false;
    pinnedLineRef.current = docLine;
    const targets = chunksToMountForLine(chunks, frontmatterLineCount, docLine);
    if (targets.length === 0) return false;
    // Jump detection reads the PRE-staging mounted state: targets[0] is
    // the chunk at/after the cursor line — the sync's alignment anchor
    // lives in it. Already-mounted anchor = typing / small scroll → the
    // targets alone suffice (staging the band here would re-mount what
    // the walk's trim keeps removing, at keystroke rate).
    const jumping = !mountedRef.current.has(targets[0]);
    const next = new Set(mountedRef.current);
    let changed = false;
    for (const k of targets) {
      if (k < 0 || k >= chunks.length) continue;
      if (!next.has(k)) {
        next.add(k);
        changed = true;
      }
    }
    if (jumping) {
      const lo = Math.min(...targets);
      const hi = Math.max(...targets);
      const sc = containerRef.current != null ? findScrollContainer(containerRef.current) : null;
      const viewport = sc != null && sc.clientHeight > 0
        ? Math.min(sc.clientHeight, ENSURE_VIEWPORT_CAP)
        : ENSURE_VIEWPORT_FALLBACK;
      const budget = (viewport + OVERSCAN_PX) * ENSURE_BAND_PAD;
      const lh = lineHeight > 0 ? lineHeight : CHUNK_ESTIMATE_LINE_HEIGHT;
      const estChunk = (k: number) => (chunks[k].lineCount + chunks[k].blankLinesAfter) * lh;
      let up = 0;
      // The first OVERSCAN_CHUNKS above/below always mount (the walk mounts
      // ±2 around every in-band chunk); beyond that, cover the budget.
      for (let k = lo - 1; k >= 0 && (up < budget || lo - k <= OVERSCAN_CHUNKS); k--) {
        if (!next.has(k)) {
          next.add(k);
          changed = true;
        }
        up += estChunk(k);
      }
      let down = 0;
      for (let k = hi + 1; k < chunks.length && (down < budget || k - hi <= OVERSCAN_CHUNKS); k++) {
        if (!next.has(k)) {
          next.add(k);
          changed = true;
        }
        down += estChunk(k);
      }
    }
    if (changed) commit(next);
    return changed;
  }, [enabled, chunks, frontmatterLineCount, lineHeight, containerRef, commit]);

  // Index-based lookup over the identity-keyed cache (spacer heights).
  const measuredHeight = useCallback(
    (i: number): number | undefined => {
      const c = chunks[i];
      return c == null ? undefined : measuredHeightsRef.current.get(chunkIdentity(c));
    },
    [chunks],
  );

  return { mounted, mountVersion, ensureChunkMountedForLine, measuredHeight };
}
