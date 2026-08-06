import type { MindElixirInstance } from 'mind-elixir';
import type { MmapSkeleton } from '../outlineConverter';
import type { MainBranchGenerator, SubBranchGenerator, MmapSkeletonStrategy } from './types';
import { mindStrategy } from './mind';
import { orgStrategy } from './org';
import { treeStrategy } from './tree';
import { fishboneStrategy } from './fishbone';
import { timelineStrategy } from './timeline';
import { bracketStrategy } from './bracket';

export const SKELETON_REGISTRY: Record<MmapSkeleton, MmapSkeletonStrategy> = {
  mind: mindStrategy,
  org: orgStrategy,
  tree: treeStrategy,
  fishbone: fishboneStrategy,
  timeline: timelineStrategy,
  bracket: bracketStrategy,
};

function ensureStyleEl(container: HTMLElement): HTMLStyleElement {
  const existing = container.querySelector<HTMLStyleElement>(
    'style[data-mmap-skeleton-style]',
  );
  if (existing) return existing;
  const style = document.createElement('style');
  style.dataset.mmapSkeletonStyle = '';
  container.appendChild(style);
  return style;
}

// ponytail: dispatch entry. Tears down the previous strategy, swaps CSS +
// data attribute + branch generators, then runs the new strategy's init.
// `defaults` are mind-elixir's captured default generators (passed in by
// the canvas) — used when the strategy doesn't override branch (mind/bracket).
export function applySkeleton(
  inst: MindElixirInstance,
  skeleton: MmapSkeleton | undefined,
  defaults?: { main: MainBranchGenerator; sub: SubBranchGenerator },
): void {
  const prevName = inst.container.dataset.mmapSkeleton as MmapSkeleton | undefined;
  const prev = prevName ? SKELETON_REGISTRY[prevName] : undefined;
  prev?.teardown?.(inst);

  const strategy = SKELETON_REGISTRY[skeleton ?? 'mind'];
  const style = ensureStyleEl(inst.container);
  style.textContent = strategy.css;
  if (strategy.name === 'mind') {
    delete inst.container.dataset.mmapSkeleton;
  } else {
    inst.container.dataset.mmapSkeleton = strategy.name;
  }
  if (strategy.branch) {
    inst.generateMainBranch = strategy.branch.main;
    inst.generateSubBranch = strategy.branch.sub;
  } else if (defaults?.main && defaults?.sub) {
    inst.generateMainBranch = defaults.main;
    inst.generateSubBranch = defaults.sub;
  }
  strategy.init(inst);
}

// ponytail: postLinkDiv dispatcher — called from mind-elixir's linkDiv
// event listener. Routes to the active strategy's postLinkDiv if defined
// (e.g. bracket overlay redraw, tree non-leaf box coloring).
export function runPostLinkDiv(
  inst: MindElixirInstance,
  skeleton: MmapSkeleton | undefined,
): void {
  SKELETON_REGISTRY[skeleton ?? 'mind'].postLinkDiv?.(inst);
}

export function isDirectionEnabled(skeleton: MmapSkeleton | undefined): boolean {
  return SKELETON_REGISTRY[skeleton ?? 'mind'].directionEnabled;
}
