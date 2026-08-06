import type { MindElixirInstance } from 'mind-elixir';
import type { MmapSkeletonStrategy, SkeletonBranchParams } from './types';

// ponytail: right-branching tree with right-angle elbow connectors. Non-leaf
// nodes get a bordered box (drawn via postLinkDiv) so all branches look
// coordinated, not just the first level.
function treeBranch({ pT, pL, pW, pH, cT, cL, cH }: SkeletonBranchParams): string {
  const x1 = pL + pW;
  const y1 = pT + pH / 2;
  const x2 = cL;
  const y2 = cT + cH / 2;
  // Lines always leave the parent's right-center and enter the child's
  // left-center. Only when the two centers are already aligned does the
  // connector stay a single horizontal line; otherwise it is a rounded
  // elbow with quadratic-bezier corners (radius 8px). No diagonals.
  if (Math.abs(y2 - y1) < 2) {
    return `M ${x1} ${y1} L ${x2} ${y2}`;
  }
  const midX = x1 + (x2 - x1) / 2;
  const r = 8;
  const dy = y2 - y1;
  const rY = Math.sign(dy) * Math.min(r, Math.abs(dy) / 2);
  return `M ${x1} ${y1} H ${midX - r} Q ${midX} ${y1} ${midX} ${y1 + rY} V ${y2 - rY} Q ${midX} ${y2} ${midX + r} ${y2} H ${x2}`;
}

const css = `
  .map-container[data-mmap-skeleton="tree"] .map-canvas me-nodes {
    padding: 24px;
  }
  .map-container[data-mmap-skeleton="tree"] me-children {
    margin-inline-start: 32px;
  }
  .map-container[data-mmap-skeleton="tree"] me-parent {
    padding-inline-start: 0;
  }
  .map-container[data-mmap-skeleton="tree"] .map-canvas {
    --node-gap-x: 0;
    --node-gap-y: 24px;
    --main-gap-y: 48px;
  }
  .map-container[data-mmap-skeleton="tree"] me-wrapper:has(> me-children > me-wrapper) > me-parent > me-tpc {
    border: 1.5px solid var(--main-color);
    border-radius: var(--main-radius);
  }
`;

// ponytail: give every non-leaf node in the tree skeleton the same box as the
// main (first-level) nodes. mind-elixir only colors first-level borders with
// the branch palette; this pass propagates that color down to deeper branches
// so all boxes stay coordinated.
function applyTreeNonLeafBoxes(inst: MindElixirInstance): void {
  const palette = inst.theme.palette;
  if (!palette?.length) return;
  inst.container.querySelectorAll('me-main > me-wrapper').forEach((mainWrapper, i) => {
    const rootTpc = mainWrapper.querySelector<HTMLElement>(
      ':scope > me-parent > me-tpc',
    );
    if (!rootTpc) return;
    const color =
      (rootTpc as HTMLElement & { nodeObj?: { branchColor?: string } }).nodeObj
        ?.branchColor || palette[i % palette.length];
    mainWrapper.querySelectorAll('me-wrapper').forEach((descWrapper) => {
      const tpc = descWrapper.querySelector<HTMLElement>(
        ':scope > me-parent > me-tpc',
      );
      if (
        tpc &&
        descWrapper.querySelector(':scope > me-children > me-wrapper')
      ) {
        tpc.style.borderColor = color;
      }
    });
  });
}

export const treeStrategy: MmapSkeletonStrategy = {
  name: 'tree',
  css,
  branch: { main: treeBranch, sub: treeBranch },
  init: (inst) => {
    if (inst.direction !== 1) inst.initRight();
  },
  directionEnabled: false,
  postLinkDiv: applyTreeNonLeafBoxes,
};
