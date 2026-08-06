import type { MindElixirInstance, MainLineParams, SubLineParams } from 'mind-elixir';
import type { MmapSkeleton } from '../outlineConverter';

// ponytail: the 8 position fields shared by MainLineParams and SubLineParams.
// Strategy functions destructure only these — declaring the param as this
// subset (supertype of both MainLineParams and SubLineParams) lets the
// function slot into either generator type without a cast.
export interface SkeletonBranchParams {
  pT: number;
  pL: number;
  pW: number;
  pH: number;
  cT: number;
  cL: number;
  cW: number;
  cH: number;
}

export type MainBranchGenerator = (
  this: MindElixirInstance,
  params: MainLineParams,
) => string;

export type SubBranchGenerator = (
  this: MindElixirInstance,
  params: SubLineParams,
) => string;

export interface MmapSkeletonStrategy {
  name: MmapSkeleton;
  css: string;
  branch?: { main: MainBranchGenerator; sub: SubBranchGenerator };
  init: (inst: MindElixirInstance) => void;
  directionEnabled: boolean;
  teardown?: (inst: MindElixirInstance) => void;
  postLinkDiv?: (inst: MindElixirInstance) => void;
}
