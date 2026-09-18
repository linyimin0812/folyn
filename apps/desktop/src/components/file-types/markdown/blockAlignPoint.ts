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
 * - Multi-line blocks: step by the cursor's MEASURED Y offset below the
 *   paragraph's first line in the editor (cursorBlockOffsetY, published by
 *   EditorView), clamped at the cursor's viewport depth. The measurement
 *   includes the soft-wrap rows of every earlier line — line arithmetic
 *   cannot: the (K-1)·lineHeight estimate missed those wraps, so the
 *   accumulated excess landed the block top progressively BELOW the editor
 *   paragraph top (one line per wrap, worst on the last line — the reported
 *   首行完美 / 非首行整体往下偏移), and before that, height fractions
 *   mis-mapped joined paragraphs (the preview joins and re-wraps source
 *   lines, so per-source-line rendered height ≠ editor line height). The
 *   measured offset pins the block TOP to the editor paragraph top, so the
 *   preview pane does not move while the cursor walks the block's lines.
 *   The align point may run past a short (joined) block's bottom on
 *   purpose — it is where the cursor's line sits in the editor's frame,
 *   and the scroll target need not stay inside the block.
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
 * @param blockOffset  px offset of the block's top from the scroll container's content top
 * @param blockHeight   px height of the rendered block
 * @param lineFrac     vertical fraction (0..1) of the cursor within its soft-wrapped
 *   source line (editor side); a long single-line paragraph soft-wraps in the
 *   editor, and as the cursor moves down the wraps its screen Y drops — without
 *   this, top-aligning a single-line block left the preview stuck at the block
 *   top while the cursor drifted down (the reported soft-wrap drift). ~0 when
 *   the line isn't wrapped.
 * @param cursorViewportDepth  px depth of the cursor line top into the shared
 *   preview viewport (cursorScreenY - containerRect.top). Clamps the
 *   multi-line step so the pinned block top never rises above the viewport:
 *   when the paragraph is scrolled off the top in the editor, the block glues
 *   to the viewport top instead of disappearing. 0 → top-align.
 * @param cursorBlockOffsetY   px of the cursor's visual line top below the
 *   first line of its containing markdown BLOCK (paragraph, fenced code,
 *   list item paragraph, …), measured in the editor (EditorView publishes
 *   it; includes earlier lines' soft-wrap rows). 0 (unknown / first line) →
 *   top-align.
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

/**
 * Which part of a rendered GFM table the cursor's source line maps to.
 * Tables render one <tr> per source line, but the |---| separator line
 * renders as the thead/tbody border (~0 height) and cell padding makes
 * rows taller than editor lines — so neither the editor-line step (which
 * pins the table top and lets rows drift below the cursor, growing per
 * row: the reported "表格预览偏下") nor a height fraction (which mis-maps
 * the separator) aligns rows to the cursor. The effect resolves the anchor
 * against the live DOM (thead row 0 / thead bottom / tbody row index) and
 * measures its offset; a tbody index past the rendered rows falls back to
 * the table bottom.
 *
 * @param delta  cursorLine - blockSrcLine (0-based offset within the table's
 *   source lines: 0 = header, 1 = separator, 2+ = body rows)
 */
export type TableRowAnchor =
  | { kind: 'thead-row' }
  | { kind: 'thead-bottom' }
  | { kind: 'tbody-row'; index: number };

export function tableRowAnchor(delta: number): TableRowAnchor {
  if (delta <= 0) return { kind: 'thead-row' };
  if (delta === 1) return { kind: 'thead-bottom' };
  return { kind: 'tbody-row', index: delta - 2 };
}

export function blockAlignPoint(
  tagName: string,
  srcLines: string[],
  blockSrcLine: number,
  blockOffset: number,
  blockHeight: number,
  lineFrac: number = 0,
  cursorViewportDepth: number = 0,
  cursorBlockOffsetY: number = 0,
): number {
  if (HEADING_RE.test(tagName)) return blockOffset + blockHeight / 2;
  // ponytail: list items top-align (one line each) and must NOT use the
  // blockLineSpan fraction — the span loop counts subsequent items too
  // (tight lists have no blank-line separators), re-merging the whole list.
  if (tagName === 'LI') return blockOffset;

  const blockLineSpan = blockLastSrcLine(srcLines, blockSrcLine) - blockSrcLine + 1;

  if (blockLineSpan > 1) {
    // Step by the cursor's MEASURED Y offset below the paragraph's first
    // line in the editor (cursorBlockOffsetY) — see the header comment.
    // It includes every earlier line's soft-wrap rows, which the
    // (K-1)·lineHeight estimate missed (that excess drifted the block top
    // below the editor paragraph top, one line per wrap, worst on the
    // last line). Pins the block TOP to the editor paragraph top; the
    // align point may run past a short (joined) block's bottom on purpose.
    // Clamped at the cursor's viewport depth so a paragraph scrolled off
    // the editor's top keeps its block glued to the preview viewport top
    // instead of disappearing above it.
    return blockOffset + Math.min(Math.max(0, cursorBlockOffsetY), Math.max(0, cursorViewportDepth));
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
