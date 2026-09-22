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
  return el.matches('.code-block-wrapper, pre');
}

export function planGapHeights(
  blocks: GapBlock[],
  gaps: Map<number, GapEntry>,
  editorLineHeight: number,
  isCodeBlock: (el: Element) => boolean = isCodeBlockEl
): { writes: Array<[Element, number]>; origin: number } {
  let origin = blocks[0].top;
  let shift = 0; // accumulated downward shift from the writes above
  const writes: Array<[Element, number]> = [];
  for (let i = 1; i < blocks.length; i++) {
    // ponytail: code blocks are capped by design (420px) and render at code
    // metrics, not the editor's prose line height — their shortfall is grid
    // noise, so it never dumps into ANY later gap (adjacent or not) and the
    // grid re-anchors at the code block's actual rendered bottom (intra-block
    // cursor alignment is codeBlockAlignPoint + inner scroll's job).
    if (isCodeBlock(blocks[i - 1].el)) {
      origin = blocks[i].top + shift - (blocks[i].line - blocks[0].line) * editorLineHeight;
      continue; // the gap after a code block (if any) keeps its static height
    }
    const gap = gaps.get(i - 1);
    if (!gap) continue; // adjacent blocks (no blank line) — absorbed at the next gap
    const desired = origin + (blocks[i].line - blocks[0].line) * editorLineHeight;
    const newH = Math.max(8, gap.curH + desired - (blocks[i].top + shift));
    writes.push([gap.el, newH]);
    shift += newH - gap.curH;
  }
  return { writes, origin };
}
