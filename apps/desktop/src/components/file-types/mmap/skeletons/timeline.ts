import type { MmapSkeletonStrategy, SkeletonBranchParams } from './types';

// ponytail: horizontal timeline. Root on the left, main branch is a single
// horizontal→vertical→horizontal stub into each first-level child.
//
// subBranch is duplicated from tree.ts (right-angle elbow) on purpose so
// timeline's sub-branch shape is independent of tree's — change one without
// touching the other.
function timelineMain({ pT, pL, pW, pH, cT, cL, cH }: SkeletonBranchParams): string {
  const x1 = pL + pW;
  const yRoot = pT + pH / 2;
  const yChild = cT + cH / 2;
  const x2 = cL;
  return `M ${x1} ${yRoot} V ${yChild} H ${x2}`;
}

function subBranch({ pT, pL, pW, pH, cT, cL, cH }: SkeletonBranchParams): string {
  const x1 = pL + pW;
  const y1 = pT + pH / 2;
  const x2 = cL;
  const y2 = cT + cH / 2;
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
  .map-container[data-mmap-skeleton="timeline"] .map-canvas me-nodes {
    padding: 24px 40px;
  }
  .map-container[data-mmap-skeleton="timeline"] me-root {
    margin: 0 48px 0 0;
  }
`;

export const timelineStrategy: MmapSkeletonStrategy = {
  name: 'timeline',
  css,
  branch: { main: timelineMain, sub: subBranch },
  init: (inst) => {
    if (inst.direction !== 1) inst.initRight();
  },
  directionEnabled: false,
};
