/**
 * Compute the preview scroll align-point for the cursor inside a fenced code
 * block. Pure (no DOM) so it can be unit-tested; the cursor-sync effect reads
 * blockOffset / blockHeight / padTop from the live DOM and calls this.
 *
 * Fenced code renders only the content BETWEEN fences — the fence lines
 * themselves aren't content rows, and blank lines inside code are valid
 * content. So the cursor's content row maps to an exact pixel position, not a
 * fraction of blockHeight.
 *
 * @param srcLines       full document split by '\n' (0-indexed)
 * @param blockSrcLine   1-indexed source line of the OPENING fence (data-source-line on <pre>)
 * @param cursorLine     1-indexed editor cursor line
 * @param blockOffset    px offset of the block's top from the scroll container's content top
 * @param blockHeight     px height of the rendered <pre> (includes top+bottom code padding)
 * @param padTop          px top padding of the <code> element
 */
export function codeBlockAlignPoint(
  srcLines: string[],
  blockSrcLine: number,
  cursorLine: number,
  blockOffset: number,
  blockHeight: number,
  padTop: number,
): number {
  // Closing fence: a line whose trimmed content is only backticks or tildes
  // (3+). Scan from the first content line (srcLines[blockSrcLine]) — the
  // opening fence (e.g. ```js) does NOT match (it has a trailing language),
  // so the first match after it is the real closing fence.
  const FENCE_RE = /^(`{3,}|~{3,})\s*$/;
  let closeLine = srcLines.length + 1; // 1-indexed closing fence (default: one past EOF if unclosed)
  for (let i = blockSrcLine; i < srcLines.length; i++) {
    if (FENCE_RE.test(srcLines[i].trim())) { closeLine = i + 1; break; }
  }
  const contentRowCount = Math.max(0, closeLine - blockSrcLine - 1);
  if (cursorLine <= blockSrcLine) {
    return blockOffset; // on/before opening fence → top of block
  }
  if (cursorLine >= closeLine) {
    return blockOffset + blockHeight; // on/after closing fence → bottom
  }
  if (contentRowCount === 0) {
    return blockOffset + padTop; // empty fence → just past top padding
  }
  const row = cursorLine - blockSrcLine - 1; // 0-indexed content row
  return blockOffset + padTop + (row / contentRowCount) * (blockHeight - 2 * padTop);
}
