import { create } from 'zustand';
import { buildGraphData } from '@/services/graphDataBuilder';
import type { WikiGraphNode, WikiGraphEdge } from '@/types/wiki';

// ponytail: zoom/pan live in the store (not useState) so they survive
// WikiGraphView unmount when the user navigates away and comes back.
type SetNum = number | ((prev: number) => number);

interface WikiGraphState {
  nodes: WikiGraphNode[];
  edges: WikiGraphEdge[];
  isBuilding: boolean;

  zoom: number;
  panX: number;
  panY: number;
  setZoom: (v: SetNum) => void;
  setPanX: (v: SetNum) => void;
  setPanY: (v: SetNum) => void;

  buildGraph: () => Promise<void>;
  getNeighborIds: (nodeId: string) => Set<string>;
}

const applyNum = (v: SetNum, prev: number) =>
  typeof v === 'function' ? (v as (p: number) => number)(prev) : v;

export const useWikiGraphStore = create<WikiGraphState>((set, get) => ({
  nodes: [],
  edges: [],
  isBuilding: false,

  zoom: 1,
  panX: 0,
  panY: 0,
  setZoom: (v) => set({ zoom: applyNum(v, get().zoom) }),
  setPanX: (v) => set({ panX: applyNum(v, get().panX) }),
  setPanY: (v) => set({ panY: applyNum(v, get().panY) }),

  buildGraph: async () => {
    set({ isBuilding: true });
    try {
      const { nodes, edges } = await buildGraphData();
      set({ nodes, edges });
    } finally {
      set({ isBuilding: false });
    }
  },

  getNeighborIds: (nodeId) => {
    const neighbors = new Set<string>();
    for (const edge of get().edges) {
      if (edge.source === nodeId) neighbors.add(edge.target);
      if (edge.target === nodeId) neighbors.add(edge.source);
    }
    return neighbors;
  },
}));
