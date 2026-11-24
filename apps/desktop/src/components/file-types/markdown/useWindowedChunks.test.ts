import { describe, expect, it } from 'vitest';
import { chunkMarkdown } from './chunkMarkdown';
import { chunksToMountForLine } from './useWindowedChunks';

/**
 * Unit tests for the cursor-sync mount bridge `chunksToMountForLine` —
 * which chunk indices `ensureChunkMountedForLine` mounts for a doc-absolute
 * cursor line. The regression locked down here: a cursor line inside an
 * INTER-CHUNK blank run belongs to no chunk (the gap path's blank lines are
 * chunk boundaries), and the old `findChunkForLine(...) === -1 → no-op`
 * mounted NOTHING — the sync then aligned to the next MOUNTED block (the
 * always-mounted last chunk ≈ doc bottom) and the preview visibly jumped
 * to the bottom and back. The gap path must mount BOTH neighbors: the
 * block ABOVE the gap is the sync's target, the block BELOW it is the gap
 * path's align point.
 */

/** Doc of N single-line chunks, two blank lines between each. */
function docOf(chunkTexts: string[]): string {
  return chunkTexts.join('\n\n\n');
}

describe('chunksToMountForLine (cursor-sync mount bridge)', () => {
  it('a line inside a chunk mounts that chunk and its successor', () => {
    const { chunks } = chunkMarkdown(docOf(['a', 'b', 'c']));
    // No frontmatter: doc line == body line. Chunk 0 = line 1.
    expect(chunksToMountForLine(chunks, 0, 1)).toEqual([0, 1]);
    expect(chunksToMountForLine(chunks, 0, 4)).toEqual([1, 2]);
  });

  it('a line in an inter-chunk blank gap mounts BOTH neighbors (the regression)', () => {
    // Chunks: a@1, b@4, c@7 (3-blank runs between). Lines 2-3 are the gap
    // after chunk 0; lines 5-6 the gap after chunk 1.
    const { chunks } = chunkMarkdown(docOf(['a', 'b', 'c']));
    // Cursor on line 2 (gap between chunk 0 and chunk 1): the block above
    // the gap (a, chunk 0) is the target; the block below (b, chunk 1) is
    // the align point — BOTH must mount.
    expect(chunksToMountForLine(chunks, 0, 2)).toEqual([1, 0]);
    expect(chunksToMountForLine(chunks, 0, 3)).toEqual([1, 0]);
    // Gap between chunk 1 and chunk 2 (lines 5-6).
    expect(chunksToMountForLine(chunks, 0, 5)).toEqual([2, 1]);
    expect(chunksToMountForLine(chunks, 0, 6)).toEqual([2, 1]);
  });

  it('frontmatter shifts doc lines and a frontmatter cursor mounts chunk 0', () => {
    const { chunks } = chunkMarkdown(docOf(['a', 'b']));
    // 3 lines of frontmatter: doc line 4 == body line 1.
    expect(chunksToMountForLine(chunks, 3, 4)).toEqual([0, 1]);
    // A cursor ON the frontmatter (doc line 2, above the body): resolves to
    // chunk 0 with no predecessor (indices clamp at 0 → negative dropped).
    expect(chunksToMountForLine(chunks, 3, 2)).toEqual([0, -1]);
  });

  it('a cursor past the EOF gap mounts the last chunk and its predecessor', () => {
    const { chunks } = chunkMarkdown(docOf(['a', 'b', 'c']) + '\n\n\n\n');
    // Doc lines: a@1, b@4, c@7, EOF blanks 8-10. A cursor on trailing
    // blank line 9 (past the last chunk): the last chunk (always mounted
    // anyway) + its predecessor.
    expect(chunksToMountForLine(chunks, 0, 9)).toEqual([2, 1]);
    expect(chunksToMountForLine(chunks, 0, 100)).toEqual([2, 1]);
  });

  it('single-chunk and empty docs are clamped safely', () => {
    expect(chunksToMountForLine([], 0, 1)).toEqual([]);
    const { chunks } = chunkMarkdown('only');
    // Inside the only chunk: [0, min(1, 0)] — both resolve to 0.
    expect(chunksToMountForLine(chunks, 0, 1)).toEqual([0, 0]);
    // Past its EOF: [0, -1] — the -1 is dropped by the caller's bounds check.
    expect(chunksToMountForLine(chunks, 0, 5)).toEqual([0, -1]);
  });

  it('the gap path never returns an interior index pair that skips a neighbor', () => {
    // Exhaustive: every line of a 5-chunk doc resolves to a mount set that
    // includes the chunk before AND after the line's gap (when both exist).
    const { chunks } = chunkMarkdown(docOf(['a', 'b', 'c', 'd', 'e']));
    // Chunks: a@1 b@4 c@7 d@10 e@13; gaps at 2-3, 5-6, 8-9, 11-12.
    const byLine = new Map<number, number[]>();
    for (let line = 1; line <= 15; line++) {
      byLine.set(line, chunksToMountForLine(chunks, 0, line));
    }
    expect(byLine.get(2)).toEqual([1, 0]);
    expect(byLine.get(5)).toEqual([2, 1]);
    expect(byLine.get(8)).toEqual([3, 2]);
    expect(byLine.get(11)).toEqual([4, 3]);
    // Content lines mount the containing chunk + successor.
    expect(byLine.get(1)).toEqual([0, 1]);
    expect(byLine.get(13)).toEqual([4, 4]);
    // Past EOF.
    expect(byLine.get(14)).toEqual([4, 3]);
  });
});
