export interface GapBlock {
  el: Element;
  line: number; // data-source-line (1-indexed)
  top: number; // measured content-space top
}

export interface GapEntry {
  el: Element;
  curH: number; // measured current gap height
}

export function isCodeBlockEl(el: Element): boolean {
  // .resizable-media: extension-rendered code fences (mermaid/plantuml/dot/…)
  // render at their own metrics like code blocks — their shortfall is grid
  // noise, never dumped into a later gap (same rationale as the capped pre).
  return el.matches('.code-block-wrapper, pre, .resizable-media');
}

export interface GapGrid {
  /** Absolute content-space Y of editor line 1 (the editor's content
   *  padding-top, published as editorContentPadTop). With a grid, block i's
   *  target is grid.top + (line_i − 1)·lh — every block lands where its
   *  editor line sits, from the very top of the doc. */
  top: number;
  /** The .md-blank-gap rendered BEFORE block 0 (leading blanks / frontmatter
   *  lines — see rehypeBlankGap). Resized so block 0's measured top (which
   *  includes the SkillMetaCard above) hits the grid, absorbing whatever
   *  sits above it. */
  leadingGap?: GapEntry;
}

export function planGapHeights(
  blocks: GapBlock[],
  gaps: Map<number, GapEntry>,
  editorLineHeight: number,
  isCodeBlock: (el: Element) => boolean = isCodeBlockEl,
  grid?: GapGrid,
): { writes: Array<[Element, number]>; origin: number } {
  // `origin`/`originLine`: the grid passes through (origin, originLine) —
  // target(line) = origin + (line − originLine)·lh. Legacy (no grid):
  // block 0's measured top + its line (relative grid, the old behavior).
  // With a grid: line 1 sits at grid.top (absolute — the editor's line-1
  // phase), so leading blanks / frontmatter align from the doc top.
  let origin = grid ? grid.top : blocks[0].top;
  let originLine = grid ? 1 : blocks[0].line;
  let shift = 0; // accumulated downward shift from the writes above
  const writes: Array<[Element, number]> = [];
  if (grid?.leadingGap) {
    // Pin block 0 onto the absolute grid. Its measured top includes the
    // SkillMetaCard + the static leading gap; resize the gap by the
    // difference (floor 0 — a card taller than the frontmatter's editor
    // span simply leaves the block lower, phase > grid.top, which the
    // scroll path absorbs).
    const target = grid.top + (blocks[0].line - 1) * editorLineHeight;
    const newH = Math.max(0, grid.leadingGap.curH + target - blocks[0].top);
    writes.push([grid.leadingGap.el, newH]);
    shift += newH - grid.leadingGap.curH;
  }
  for (let i = 1; i < blocks.length; i++) {
    // ponytail: code blocks are capped by design (420px) and render at code
    // metrics, not the editor's prose line height — their shortfall is grid
    // noise, so it never dumps into ANY later gap (adjacent or not) and the
    // grid re-anchors at the code block's actual rendered bottom (intra-block
    // cursor alignment is codeBlockAlignPoint + inner scroll's job).
    if (isCodeBlock(blocks[i - 1].el)) {
      origin = blocks[i].top + shift;
      originLine = blocks[i].line;
      continue; // the gap after a code block (if any) keeps its static height
    }
    const gap = gaps.get(i - 1);
    if (!gap) continue; // adjacent blocks (no blank line) — absorbed at the next gap
    const desired = origin + (blocks[i].line - originLine) * editorLineHeight;
    const newH = Math.max(8, gap.curH + desired - (blocks[i].top + shift));
    writes.push([gap.el, newH]);
    shift += newH - gap.curH;
  }
  // `origin` returned in the legacy frame — target(line) = origin + (line −
  // blocks[0].line)·lh — so existing callers/tests keep one meaning.
  return { writes, origin: origin + (blocks[0].line - originLine) * editorLineHeight };
}
