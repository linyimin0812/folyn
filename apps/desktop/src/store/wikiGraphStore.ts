import { create } from 'zustand';
import { buildGraphData } from '@/services/graphDataBuilder';
import type { WikiGraphNode, WikiGraphEdge } from '@/types/wiki';

interface WikiGraphState {
  nodes: WikiGraphNode[];
  edges: WikiGraphEdge[];
  isBuilding: boolean;

  buildGraph: () => Promise<void>;
  getNeighborIds: (nodeId: string) => Set<string>;
}

export const useWikiGraphStore = create<WikiGraphState>((set, get) => ({
  nodes: [],
  edges: [],
  isBuilding: false,

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
