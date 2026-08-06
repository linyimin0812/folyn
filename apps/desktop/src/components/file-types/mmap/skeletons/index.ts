import type { MindElixirInstance } from 'mind-elixir';
import type { MmapSkeleton } from '../outlineConverter';
import type { MainBranchGenerator, SubBranchGenerator, MmapSkeletonStrategy } from './types';
import { mindStrategy } from './mind';
import { orgStrategy } from './org';
import { treeStrategy } from './tree';

export const SKELETON_REGISTRY: Record<MmapSkeleton, MmapSkeletonStrategy> = {
  mind: mindStrategy,
  org: orgStrategy,
  tree: treeStrategy,
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

// ponytail: resolve a skeleton string to a known strategy, falling back to
// 'mind' for unknown values. Sources may carry a skeleton name that was
// removed from the registry (e.g. 'bracket' was deleted), or a future name
// not yet registered — silently render as the default mind map instead of
// throwing on `strategy.css` / `.init` / `.directionEnabled`.
function resolve(skeleton: MmapSkeleton | undefined): MmapSkeletonStrategy {
  return SKELETON_REGISTRY[skeleton ?? 'mind'] ?? mindStrategy;
}

// ponytail: dispatch entry. Tears down the previous strategy, swaps CSS +
// data attribute + branch generators. Does NOT call strategy.init — the
// caller decides whether to enforce direction (mount respects the source's
// data.direction for the default mind case; a user picker action always
// enforces). `defaults` are mind-elixir's captured default generators (used
// when the strategy doesn't override branch — mind).
export function applySkeleton(
  inst: MindElixirInstance,
  skeleton: MmapSkeleton | undefined,
  defaults?: { main: MainBranchGenerator; sub: SubBranchGenerator },
): void {
  const prevName = inst.container.dataset.mmapSkeleton as MmapSkeleton | undefined;
  const prev = prevName ? SKELETON_REGISTRY[prevName] : undefined;
  prev?.teardown?.(inst);

  const strategy = resolve(skeleton);
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
}

// ponytail: enforce the skeleton's implied direction. Call this when the
// caller knows direction should be reset to the skeleton's canonical value
// (user picker action, explicit skeleton in source). Skip for the default
// mind case when the source's data.direction should be respected.
export function runSkeletonInit(
  inst: MindElixirInstance,
  skeleton: MmapSkeleton | undefined,
): void {
  resolve(skeleton).init(inst);
}

// ponytail: postLinkDiv dispatcher — called from mind-elixir's linkDiv
// event listener. Routes to the active strategy's postLinkDiv if defined
// (e.g. tree non-leaf box coloring).
export function runPostLinkDiv(
  inst: MindElixirInstance,
  skeleton: MmapSkeleton | undefined,
): void {
  resolve(skeleton).postLinkDiv?.(inst);
}

export function isDirectionEnabled(skeleton: MmapSkeleton | undefined): boolean {
  return resolve(skeleton).directionEnabled;
}
