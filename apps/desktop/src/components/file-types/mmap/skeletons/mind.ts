import type { MmapSkeletonStrategy } from './types';

// ponytail: classic mind map — both sides, mind-elixir's default branch
// generators. No CSS override, no overlay. Direction toolbar enabled.
export const mindStrategy: MmapSkeletonStrategy = {
  name: 'mind',
  css: '',
  init: (inst) => {
    if (inst.direction !== 2) inst.initSide();
  },
  directionEnabled: true,
};
