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
 * - Multi-line blocks: map the cursor's RELATIVE depth within its editor
 *   block (cursorBlockOffsetY / cursorBlockHeight — both wrap-exact editor
 *   measurements, re-anchored into the target block's frame by the caller)
 *   proportionally onto the preview block: first line → top, last line →
 *   bottom, middle → the matching relative place. The old absolute-px step
 *   (editor offset applied directly as preview px) mis-mapped whenever the
 *   panes re-wrapped differently (narrower editor → more rows; 800px
 *   preview → fewer): the preview text at the cursor's screen height sat
 *   progressively EARLIER in the paragraph as it grew, and clamping the
 *   step at the cursor's viewport depth glued the block top to the preview
 *   viewport while the editor's paragraph scrolled off — the two panes
 *   showed different "progress" through a tall paragraph. The fraction is
 *   scale-free; cursorBlockHeight 0 (unknown / cursor on the first line) →
 *   top-align (the first line's fraction is 0 anyway).
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
 * @param cursorBlockOffsetY   px of the cursor's visual line top below the
 *   first line of its containing markdown BLOCK (paragraph, fenced code,
 *   list item paragraph, …), measured in the editor (EditorView publishes
 *   it; includes earlier lines' soft-wrap rows). 0 (unknown / first line) →
 *   top-align.
 * @param cursorBlockHeight   px height of that same editor block (first
 *   line top → last line bottom, wrap-exact, re-anchored into this block's
 *   frame by the caller — directive scaffolding subtracted). The
 *   multi-line fraction's denominator. 0 (unknown) → top-align.
 */
const HEADING_RE = /^H[1-6]$/;

/**
 * Last 1-indexed source line of the block that starts at blockSrcLine: the
 * run of non-blank lines, ALSO terminated by a directive fence line (::: /
 * :::: … at line start) — remark-directive ends a block at a fence even
 * without a blank line. Shared by blockAlignPoint (in-block fraction) and
 * the cursor-sync effect (gap detection → gapAlignPoint).
 */
export function blockLastSrcLine(srcLines: string[], blockSrcLine: number): number {
  let span = 0;
  for (let i = blockSrcLine - 1; i < srcLines.length; i++) {
    if (srcLines[i].trim() === '') break;
    // A directive line ends the block in the preview's remark-directive
    // grammar — the blank-run span used to run THROUGH directive lines (a
    // paragraph inside :::tab counted the whole container into its span),
    // so a cursor on the scaffolding below never registered as a gap and
    // the block mis-aligned. The block's own first line is exempt (a
    // directive-wrapper target's opening line must not terminate it).
    if (i > blockSrcLine - 1 && /^\s*:::/.test(srcLines[i])) break;
    span++;
  }
  if (span < 1) span = 1;
  return blockSrcLine + span - 1;
}

/**
 * Last 1-indexed source line of the container directive OPENED at openLine —
 * its closing fence. remark-directive closes a container at the first
 * pure-colon line whose colon count is >= the opening fence's (inner
 * sub-directives open with FEWER colons — :::tab inside ::::tabs — so their
 * fences don't close the outer container). Unmatched → the document end
 * (span to EOF, mirroring blockLastSrcLine's fallback). Used as a
 * [data-container] block's span: blank-run scanning ended a tabs/carousel
 * container at its first INTERNAL blank line (or ran its whole body into a
 * preceding paragraph's span), so a cursor deep inside mis-detected as a
 * gap and aligned past the container.
 */
export function directiveCloseLine(srcLines: string[], openLine: number): number {
  const open = /^\s*(:{3,})/.exec(srcLines[openLine - 1] ?? '');
  const openColons = open ? open[1].length : 3;
  for (let i = openLine; i < srcLines.length; i++) {
    const fence = /^\s*(:{3,})\s*$/.exec(srcLines[i]);
    if (fence && fence[1].length >= openColons) return i + 1;
  }
  return srcLines.length;
}

/**
 * Re-anchor the editor-measured cursor offset (cursorBlockOffsetY, measured
 * from the editor block anchor line — the syntax-tree block's first line,
 * published as cursorBlockLine) into the TARGET preview block's frame
 * (anchored at blockSrcLine). Directives are invisible to the editor's
 * markdown parser, so inside ::::tabs / ::::carousel the editor's anchor
 * (the blank-delimited run start, directive lines included) and the preview
 * block's first line (the content line, scaffolding lines above it) differ
 * by the lines between them — the un-converted offset stepped the block by
 * an offset anchored at the wrong line, landing inner content a scaffolding
 * run BELOW the cursor (the reported 预览整体偏下). Line arithmetic across
 * the gap is exact for unwrapped lines (directive scaffolding lines never
 * wrap in practice). anchorLine === blockSrcLine (outside containers) →
 * no-op.
 */
export function blockRelativeOffsetY(
  cursorBlockOffsetY: number,
  anchorLine: number,
  blockSrcLine: number,
  editorLineHeight: number,
): number {
  return cursorBlockOffsetY + (anchorLine - blockSrcLine) * editorLineHeight;
}

/**
 * Align point for a show-one-at-a-time container (tabs / carousel) while the
 * cursor sits on a line its visible content doesn't map to — directive
 * scaffolding, a hidden sibling's lines, a blank between children. Only ONE
 * child renders, so there is no per-line pixel map; PIN the container top to
 * the editor position of the container's first line: blockOffset + rel,
 * where rel is the cursor's editor Y below that line (the effect resolves it
 * wrap-exact from the editor's measured container-line screen Y when
 * available, else blockRelativeOffsetY's line-arithmetic re-anchor), clamped
 * at the cursor's viewport depth like the paragraph pin. Top-aligning the
 * container to the cursor's line instead dragged the whole preview down as
 * the cursor descended (the reported 只有首行对齐 / 预览整体偏下); the pin
 * keeps the pane still while the cursor walks the container's lines.
 */
export function containerAlignPoint(
  blockOffset: number,
  rel: number,
  cursorViewportDepth: number,
): number {
  return blockOffset + Math.min(Math.max(0, rel), Math.max(0, cursorViewportDepth));
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
  cursorBlockOffsetY: number = 0,
  cursorBlockHeight: number = 0,
): number {
  if (HEADING_RE.test(tagName)) return blockOffset + blockHeight / 2;
  // ponytail: list items top-align (one line each) and must NOT use the
  // blockLineSpan fraction — the span loop counts subsequent items too
  // (tight lists have no blank-line separators), re-merging the whole list.
  if (tagName === 'LI') return blockOffset;

  const blockLineSpan = blockLastSrcLine(srcLines, blockSrcLine) - blockSrcLine + 1;

  if (blockLineSpan > 1) {
    // Map the cursor's RELATIVE depth in its editor block (both measured,
    // wrap-exact) onto the preview block. First line → frac 0 → top-align
    // (the editor paragraph top and the preview block top pin together);
    // last line ≈ frac 1 → the block bottom rides at the cursor; middle →
    // the matching relative place, so the text at the cursor's screen
    // height corresponds to the cursor's position in the paragraph even
    // when the panes re-wrap it differently (the editor shows N rows, the
    // preview M≠N — an absolute editor-px offset has no valid scale here).
    // No viewport-depth clamp: when the paragraph top scrolls off in the
    // editor, the preview block top scrolls off too — matching panes beats
    // keeping the block top glued inside the viewport (the old clamp made
    // the two panes show different progress through a tall paragraph).
    if (cursorBlockHeight > 0) {
      const frac = Math.min(1, Math.max(0, cursorBlockOffsetY / cursorBlockHeight));
      return blockOffset + frac * blockHeight;
    }
    // Unknown editor height (cursor on the block's first line, or
    // unmeasured) → top-align; the first line's fraction is 0 anyway.
    return blockOffset;
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
