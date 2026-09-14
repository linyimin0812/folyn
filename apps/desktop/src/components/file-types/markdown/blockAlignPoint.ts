/**
 * Compute the preview scroll align-point for the cursor inside a non-code
 * markdown block (paragraph, heading, list, blockquote, image, etc.).
 * Pure (no DOM) so it can be unit-tested; the cursor-sync effect reads
 * blockOffset / blockHeight / tagName from the live DOM and calls this.
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
 * - Single source line that renders tall (image, etc.): falls back to
 *   cursor-column fraction.
 *
 * @param srcLines     full document split by '\n' (0-indexed)
 * @param blockSrcLine 1-indexed source line of the block (data-source-line)
 * @param cursorLine   1-indexed editor cursor line
 * @param cursorCol    1-indexed editor cursor column
 * @param lineLength   length of the editor cursor's source line
 * @param blockOffset  px offset of the block's top from the scroll container's content top
 * @param blockHeight   px height of the rendered block
 */
const HEADING_RE = /^H[1-6]$/;

export function blockAlignPoint(
  tagName: string,
  srcLines: string[],
  blockSrcLine: number,
  cursorLine: number,
  cursorCol: number,
  lineLength: number,
  blockOffset: number,
  blockHeight: number,
): number {
  if (HEADING_RE.test(tagName)) return blockOffset + blockHeight / 2;
  // ponytail: list items top-align (one line each) and must NOT use the
  // blockLineSpan fraction — the span loop counts subsequent items too
  // (tight lists have no blank-line separators), re-merging the whole list.
  if (tagName === 'LI') return blockOffset;

  let blockLineSpan = 0;
  for (let i = blockSrcLine - 1; i < srcLines.length; i++) {
    if (srcLines[i].trim() === '') break;
    blockLineSpan++;
  }
  if (blockLineSpan < 1) blockLineSpan = 1;

  let intraFrac = 0;
  if (blockLineSpan > 1) {
    intraFrac = Math.min(1, Math.max(0, (cursorLine - blockSrcLine) / (blockLineSpan - 1)));
  } else {
    const ll = lineLength || 1;
    intraFrac = Math.min(1, Math.max(0, cursorCol / ll));
  }
  return blockOffset + intraFrac * blockHeight;
}
