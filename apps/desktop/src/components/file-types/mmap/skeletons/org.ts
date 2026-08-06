import type { MmapSkeletonStrategy, SkeletonBranchParams } from './types';

// ponytail: top-down org chart. Vertical elbow connectors parent→child.
// Right-branching at root level (direction=1); CSS flips me-nodes to column.
function orgBranch({ pT, pL, pW, pH, cT, cL, cW }: SkeletonBranchParams): string {
  const x1 = pL + pW / 2;
  const y1 = pT + pH;
  const x2 = cL + cW / 2;
  const y2 = cT;
  const midY = y1 + (y2 - y1) / 2;
  return `M ${x1} ${y1} L ${x1} ${midY} L ${x2} ${midY} L ${x2} ${y2}`;
}

const css = `
  .map-container[data-mmap-skeleton="org"] .map-canvas me-nodes {
    display: flex;
    flex-direction: column;
    justify-content: flex-start;
    align-items: center;
    padding: 24px;
  }
  .map-container[data-mmap-skeleton="org"] me-root {
    margin: 8px 0 32px;
  }
  .map-container[data-mmap-skeleton="org"] me-main {
    display: flex;
    flex-direction: row;
    justify-content: center;
    align-items: flex-start;
    width: max-content;
    margin: 0;
  }
  .map-container[data-mmap-skeleton="org"] me-wrapper {
    display: flex;
    flex-direction: column;
    align-items: center;
    margin: 0 14px;
  }
  .map-container[data-mmap-skeleton="org"] me-parent {
    display: flex;
    flex-direction: column;
    align-items: center;
    margin: 0;
    padding: 0;
  }
  .map-container[data-mmap-skeleton="org"] me-wrapper me-children {
    display: flex;
    flex-direction: row;
    justify-content: center;
    align-items: flex-start;
    margin-top: 18px;
  }
`;

export const orgStrategy: MmapSkeletonStrategy = {
  name: 'org',
  css,
  branch: { main: orgBranch, sub: orgBranch },
  init: (inst) => {
    if (inst.direction !== 1) inst.initRight();
  },
  directionEnabled: false,
};
