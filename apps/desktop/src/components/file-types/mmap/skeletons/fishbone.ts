import type { MmapSkeletonStrategy, SkeletonBranchParams } from './types';

// ponytail: right spine (me-main::before), first-level branches alternate
// up/down. Main bone stubs left from child then diagonals to child's
// left-center; sub-branches use vertical elbows (separate generator).
function slantedBranch({ pT, pH, cT, cL, cH }: SkeletonBranchParams): string {
  // Attaches to the horizontal spine at the parent's vertical center, stubs
  // left from the child by 30px, then diagonals to the child's left-center.
  // The spine itself is drawn as fishbone me-main::before. Keeps bones short
  // and roughly parallel instead of fanning from the root.
  const ySpine = pT + pH / 2;
  const yChild = cT + cH / 2;
  const xChild = cL;
  const stub = 30;
  return `M ${xChild - stub} ${ySpine} L ${xChild} ${yChild}`;
}

function verticalBranch({ pT, pL, pW, pH, cT, cL, cW }: SkeletonBranchParams): string {
  const x1 = pL + pW / 2;
  const y1 = pT + pH;
  const x2 = cL + cW / 2;
  const y2 = cT;
  const midY = y1 + (y2 - y1) / 2;
  return `M ${x1} ${y1} L ${x1} ${midY} L ${x2} ${midY} L ${x2} ${y2}`;
}

const css = `
  .map-container[data-mmap-skeleton="fishbone"] .map-canvas me-nodes {
    padding-block: 64px;
    padding-inline: 32px;
  }
  .map-container[data-mmap-skeleton="fishbone"] me-root {
    margin-inline-end: 44px;
  }
  .map-container[data-mmap-skeleton="fishbone"] me-main {
    display: flex;
    flex-direction: row;
    align-items: center;
    margin: 0;
    position: relative;
  }
  .map-container[data-mmap-skeleton="fishbone"] me-main::before {
    content: '';
    position: absolute;
    left: -44px;
    right: 0;
    top: 50%;
    height: 2px;
    background: var(--main-color);
    pointer-events: none;
    z-index: 0;
  }
  .map-container[data-mmap-skeleton="fishbone"] me-wrapper {
    display: flex;
    flex-direction: column;
    align-items: center;
    margin-inline: 16px;
    gap: 8px;
    position: relative;
    z-index: 1;
  }
  .map-container[data-mmap-skeleton="fishbone"] me-wrapper me-children {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
  }
  .map-container[data-mmap-skeleton="fishbone"] me-main > me-wrapper:nth-child(odd) {
    margin-block-start: -56px;
    flex-direction: column-reverse;
  }
  .map-container[data-mmap-skeleton="fishbone"] me-main > me-wrapper:nth-child(even) {
    margin-block-start: 56px;
  }
`;

export const fishboneStrategy: MmapSkeletonStrategy = {
  name: 'fishbone',
  css,
  branch: { main: slantedBranch, sub: verticalBranch },
  init: (inst) => {
    if (inst.direction !== 1) inst.initRight();
  },
  directionEnabled: false,
};
