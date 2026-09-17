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
 */
const BLOCK_TAGS = new Set([
  'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'blockquote', 'pre', 'ul', 'ol', 'li', 'table', 'hr', 'div',
  'img',
]);

// `.md-preview` is font-size:14px, line-height:1.8 → one source line ≈ 1.8em.
// Using em (not px) keeps the gap proportional if the preview font changes.
const EM_PER_LINE = 1.8;

export function rehypeBlankGap(options: { offset?: number } = {}) {
  const offset = options.offset ?? 0;
  return (tree: any) => {
    const kids = Array.isArray(tree.children) ? tree.children : [];
    if (kids.length === 0) return;
    const next: any[] = [];
    let prevEndLine: number | null = null;
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
          if (gap > 0) {
            next.push({
              type: 'element',
              tagName: 'div',
              properties: {
                className: ['md-blank-gap'],
                style: `height:calc(${gap} * ${EM_PER_LINE}em)`,
                ariaHidden: true,
              },
              children: [],
            });
          }
        }
        prevEndLine = Math.max(prevEndLine ?? 0, endLine);
      }
      next.push(node);
    }
    tree.children = next;
  };
}
