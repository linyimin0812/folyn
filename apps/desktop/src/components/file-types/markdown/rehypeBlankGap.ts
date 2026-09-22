/**
 * Rehype plugin: render the BLANK LINES between block-level elements as
 * proportional vertical gaps, so the preview's blocks stack at the same rate
 * the editor cursor descends through those blank lines.
 *
 * Why: a blank line in the editor occupies a full line height (~22px), but
 * markdown renders it as 0 height — paragraphs separate by only their 8px
 * margin. So as the cursor moves down past blank lines, the editor cursor's
 * screen Y outruns the preview block's rendered position → the active block
 * ends up ABOVE the cursor, the cursor-sync `desired` goes NEGATIVE, and
 * scrollTop (can't go below 0) can't bring the block down. The previous fix
 * pushed content down via a transform — but that left a blank band at the
 * preview top ("预览页前面很多空白"), and capping it re-introduced the
 * misalignment ("又不对齐了").
 *
 * This plugin instead inserts a gap element between consecutive top-level
 * blocks sized to the number of blank source lines between them (× the
 * preview's line-height, via `calc(N * 1.8em)` so it tracks the preview
 * font metrics, not a hardcoded px). The blocks then descend past blank
 * lines at ~the editor's rate, `desired` stays ≥ 0, and the normal scroll
 * alignment works with NO top blank band.
 *
 * Only top-level blocks are spaced (the gap is between sibling blocks in the
 * root). `position.start.line` / `position.end.line` come from remark-parse
 * (frontmatter is stripped before parsing, so lines are body-relative; the
 * `offset` option shifts them to match the editor's frontmatter-adjusted
 * line numbers, though it cancels out of the gap math).
 *
 * The gap is `aria-hidden` and carries no content — purely a vertical
 * spacer so layout matches the editor.
 *
 * NOTE: these static heights are only the pre-measurement approximation.
 * MarkdownPreview's useLayoutEffect re-sizes each gap at runtime so the
 * block AFTER it lands on the editor's line grid — the static calc cannot
 * know rendered block heights (re-wrapped paragraphs, capped code blocks),
 * and the accumulated shortfall is what left short docs unaligned. See the
 * "runtime blank-gap compensation" effect in MarkdownPreview.tsx.
 */
const BLOCK_TAGS = new Set([
  'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'blockquote', 'pre', 'ul', 'ol', 'li', 'table', 'hr', 'div',
  'img',
]);

// `.md-preview` sets `--md-gap-line` to the editor's actual line height (see
// MarkdownPreview). The gap div itself carries `margin: -8px 0` (index.css)
// which cancels the two adjacent paragraph margins (8px each) so the gap
// height is the FULL inter-block space — one blank-line gap = one editor
// line, exactly matching the editor's descent rate (the old hardcoded 1.8em
// guessed the editor line height AND left the margins stacking on top of
// it, overshot, read as "空格很大"). Falls back to 1.8em before the editor
// has measured (editorLineHeight === 0).
const EM_PER_LINE = 1.6;

export function rehypeBlankGap(options: { offset?: number; totalLines?: number } = {}) {
  const offset = options.offset ?? 0;
  const totalLines = options.totalLines;
  return (tree: any) => {
    const kids = Array.isArray(tree.children) ? tree.children : [];
    if (kids.length === 0) return;
    const next: any[] = [];
    let prevEndLine: number | null = null;
    const gapDiv = (gap: number) => ({
      type: 'element',
      tagName: 'div',
      properties: {
        className: ['md-blank-gap'],
        style: `height:calc(${gap} * var(--md-gap-line, ${EM_PER_LINE}em))`,
        ariaHidden: true,
      },
      children: [],
    });
    for (const node of kids) {
      if (
        node?.type === 'element' &&
        BLOCK_TAGS.has(node.tagName) &&
        node.position?.start?.line != null &&
        node.position?.end?.line != null
      ) {
        const startLine = node.position.start.line + offset;
        const endLine = node.position.end.line + offset;
        if (prevEndLine != null) {
          const gap = startLine - prevEndLine - 1;
          if (gap > 0) next.push(gapDiv(gap));
        } else {
          // Leading gap: the editor renders EVERY line from 1 — leading
          // blanks AND frontmatter lines (the body starts at editor line
          // offset+1) — but the preview rendered nothing above the first
          // block. The cursor in the first content block then had N·lh of
          // editor content above it that the preview lacked: desiredRaw went
          // negative, scrollTop clamped at 0, and the block sat N lines ABOVE
          // the cursor (short docs / doc tops never aligned). Render those
          // lines as a leading gap div; the runtime compensation pins block 0
          // onto the editor's line-1 phase (planGapHeights' grid).
          const leading = startLine - 1;
          if (leading > 0) next.push(gapDiv(leading));
        }
        prevEndLine = Math.max(prevEndLine ?? 0, endLine);
      }
      next.push(node);
    }
    // Trailing EOF blanks: the region below the last block is where the
    // editor cursor sits after every Enter (the new line is blank until its
    // first char). No div is rendered there by the loop above (it needs a
    // NEXT block), so the cursor-sync's EOF-gap align-point extension had
    // no scroll height to land in — the old transform push-down (blank band
    // at the top) was covering it. Render the trailing blank lines as a
    // gap div too: the preview descends past the last block at the editor's
    // line rate, exactly like between-block blanks.
    if (totalLines != null && prevEndLine != null) {
      const trailing = Math.max(0, totalLines - prevEndLine);
      if (trailing > 0) next.push(gapDiv(trailing));
    }
    tree.children = next;
  };
}
