/**
 * Compute the preview scroll align-point for the cursor inside a non-code
 * markdown block (paragraph, heading, list, blockquote, image, etc.).
 * Pure (no DOM) so it can be unit-tested; the cursor-sync effect reads
 * blockOffset / blockHeight / tagName from the live DOM and calls this.
 *
 * Only handles the cursor INSIDE the block (on one of its source lines).
 * When the cursor sits on a blank line below the block (the gap to the
 * next block), the effect calls gapAlignPoint instead — see that helper.
 *
 * - Headings (h1-h6) are a single source line that renders tall (large font
 *   + padding-bottom + border). The cursor-column fraction would map
 *   horizontal cursor movement to vertical drift through the tall box, so
 *   the highlight slides off the cursor line as the cursor moves right.
 *   A heading is one line — center the block on the cursor line
 *   (alignPoint = blockOffset + blockHeight/2) so the highlight box is
 *   symmetric around the cursor, instead of top-aligning (which left the
 *   whole box below the cursor with text pinned to the top).
 * - List items (li): top-align to the cursor line (blockOffset). A tight
 *   list item is one source line; its blockLineSpan loop would otherwise
 *   count every following item (no blank line separates them), re-merging
 *   the whole list into one span. Top-aligning each item keeps them
 *   independent — one item highlights/aligns per cursor line, not the
 *   whole <ul>.
 * - Multi-line blocks: fraction by source-line offset within the block's
 *   blank-line-terminated span.
 * - Single source line: top-align to the cursor line. The cursor's
 *   horizontal column has no bearing on vertical alignment, so the old
 *   cursor-column fraction (which swept the preview top→bottom as the cursor
 *   moved left/right — the reported same-line drift) is gone. Top-aligning
 *   matches the multi-line first-line mapping (cursor on a line → that
 *   line's top aligns to the cursor line top). Headings render very tall, so
 *   they still center (symmetric highlight) via the early return above.
 *
 * @param srcLines     full document split by '\n' (0-indexed)
 * @param blockSrcLine 1-indexed source line of the block (data-source-line)
 * @param cursorLine   1-indexed editor cursor line
 * @param blockOffset  px offset of the block's top from the scroll container's content top
 * @param blockHeight   px height of the rendered block
 * @param lineFrac     vertical fraction (0..1) of the cursor within its soft-wrapped
 *   source line (editor side); a long single-line paragraph soft-wraps in the
 *   editor, and as the cursor moves down the wraps its screen Y drops — without
 *   this, top-aligning a single-line block left the preview stuck at the block
 *   top while the cursor drifted down (the reported soft-wrap drift). ~0 when
 *   the line isn't wrapped.
 */
const HEADING_RE = /^H[1-6]$/;

/**
 * Last 1-indexed source line of the blank-line-terminated block that starts
 * at blockSrcLine (the block's final non-blank line). Shared by blockAlignPoint
 * (in-block fraction) and the cursor-sync effect (gap detection → gapAlignPoint).
 */
export function blockLastSrcLine(srcLines: string[], blockSrcLine: number): number {
  let span = 0;
  for (let i = blockSrcLine - 1; i < srcLines.length; i++) {
    if (srcLines[i].trim() === '') break;
    span++;
  }
  if (span < 1) span = 1;
  return blockSrcLine + span - 1;
}

/**
 * Align point for the cursor sitting on a blank line below a block — the gap
 * between this block and the next. Blank lines render no height in the preview,
 * so the cursor's downward drift across blank lines cannot map to preview
 * height; extending by a guessed editor line height drifted (editor vs preview
 * line heights differ, plus block margins). Instead align to the NEXT block's
 * top so the preview advances to the content that follows the cursor's blank
 * line (the cursor is on the separator before the next block). If there is no
 * next block (cursor on trailing blank lines at EOF), stay on the current
 * block's bottom — there is nothing below to advance to.
 *
 * @param prevBlockBottom   px bottom of the block above the gap (blockOffset + blockHeight)
 * @param nextBlockOffset   px top of the next block, or null if there is none
 */
export function gapAlignPoint(prevBlockBottom: number, nextBlockOffset: number | null): number {
  return nextBlockOffset != null ? nextBlockOffset : prevBlockBottom;
}

export function blockAlignPoint(
  tagName: string,
  srcLines: string[],
  blockSrcLine: number,
  cursorLine: number,
  blockOffset: number,
  blockHeight: number,
  lineFrac: number = 0,
): number {
  if (HEADING_RE.test(tagName)) return blockOffset + blockHeight / 2;
  // ponytail: list items top-align (one line each) and must NOT use the
  // blockLineSpan fraction — the span loop counts subsequent items too
  // (tight lists have no blank-line separators), re-merging the whole list.
  if (tagName === 'LI') return blockOffset;

  const blockLineSpan = blockLastSrcLine(srcLines, blockSrcLine) - blockSrcLine + 1;

  if (blockLineSpan > 1) {
    // Map the cursor's source line to its RENDERED ROW TOP inside the
    // block, not a [0,1] sweep across the whole block height. The old
    // `(cursorLine - blockSrcLine) / (blockLineSpan - 1)` mapped the first
    // line to the block top (0 → perfect, so line 1 aligned) but the last
    // line to the block BOTTOM (1 → one row + margins below where it
    // should be), and every line in between was pushed down proportionally
    // — the reported "first line perfect, other lines drift downward".
    // A block with N source rows renders N rows; row K (1-indexed from the
    // block start) has its top at (K-1)/N of the (marginless) blockHeight,
    // so the denominator is N (blockLineSpan), not N-1.
    const rowFrac = (cursorLine - blockSrcLine) / blockLineSpan;
    return blockOffset + Math.min(1, Math.max(0, rowFrac)) * blockHeight;
  }
  // Single source line: map the cursor's position within the soft-wrapped
  // block onto the preview block height. A long single-line paragraph
  // soft-wraps in the editor into N visual lines; top-aligning it here
  // (lineFrac=0) left the preview stuck at the block top while the cursor
  // drifted down the wraps (the reported soft-wrap drift). lineFrac (0 at
  // the first visual line, 1 at the last) interpolates the align point down
  // the preview block so it tracks the cursor. Unwrapped lines keep
  // lineFrac≈0 → top-align, and since left/right movement on a single
  // visual line never changes the cursor's screen Y, there is no horizontal
  // drift either.
  return blockOffset + Math.min(1, Math.max(0, lineFrac)) * blockHeight;
}
