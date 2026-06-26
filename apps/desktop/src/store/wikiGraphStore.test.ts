import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useWikiGraphStore } from './wikiGraphStore';
import type { WikiGraphNode, WikiGraphEdge } from '@/types/wiki';

// Stub the graph builder so we control nodes/edges without touching wiki files.
vi.mock('@/services/graphDataBuilder', () => ({
  buildGraphData: vi.fn(),
}));

import { buildGraphData } from '@/services/graphDataBuilder';

const sampleNodes: WikiGraphNode[] = [
  { id: 'a', label: 'A', type: 'entity', linkCount: 2, tags: [] },
  { id: 'b', label: 'B', type: 'entity', linkCount: 1, tags: [] },
  { id: 'c', label: 'C', type: 'concept', linkCount: 1, tags: [] },
];

const sampleEdges: WikiGraphEdge[] = [
  { source: 'a', target: 'b', weight: 3, signals: { directLink: true, sourceOverlap: false, adamicAdar: 0, typeAffinity: 0 } },
  { source: 'a', target: 'c', weight: 1, signals: { directLink: false, sourceOverlap: false, adamicAdar: 0.5, typeAffinity: 0 } },
];

beforeEach(() => {
  vi.clearAllMocks();
  useWikiGraphStore.setState({ nodes: [], edges: [], isBuilding: false });
});

describe('useWikiGraphStore initial state', () => {
  it('starts empty and idle', () => {
    const s = useWikiGraphStore.getState();
    expect(s.nodes).toEqual([]);
    expect(s.edges).toEqual([]);
    expect(s.isBuilding).toBe(false);
  });
});

describe('useWikiGraphStore.buildGraph', () => {
  it('builds nodes and edges from the graph data builder', async () => {
    vi.mocked(buildGraphData).mockResolvedValueOnce({ nodes: sampleNodes, edges: sampleEdges });

    await useWikiGraphStore.getState().buildGraph();

    const s = useWikiGraphStore.getState();
    expect(s.nodes).toBe(sampleNodes);
    expect(s.edges).toBe(sampleEdges);
    expect(s.isBuilding).toBe(false);
  });

  it('sets isBuilding during the build then clears it on success', async () => {
    let resolveBuild: (v: { nodes: WikiGraphNode[]; edges: WikiGraphEdge[] }) => void = () => {};
    vi.mocked(buildGraphData).mockImplementationOnce(
      () => new Promise((resolve) => { resolveBuild = resolve; }),
    );
    const pending = useWikiGraphStore.getState().buildGraph();
    expect(useWikiGraphStore.getState().isBuilding).toBe(true);
    resolveBuild({ nodes: sampleNodes, edges: sampleEdges });
    await pending;
    expect(useWikiGraphStore.getState().isBuilding).toBe(false);
  });

  it('clears isBuilding even when the builder throws', async () => {
    vi.mocked(buildGraphData).mockRejectedValueOnce(new Error('boom'));
    await expect(useWikiGraphStore.getState().buildGraph()).rejects.toThrow('boom');
    expect(useWikiGraphStore.getState().isBuilding).toBe(false);
    // Previous state is preserved on failure.
    expect(useWikiGraphStore.getState().nodes).toEqual([]);
  });
});

describe('useWikiGraphStore.getNeighborIds', () => {
  beforeEach(() => {
    useWikiGraphStore.setState({ edges: sampleEdges });
  });

  it('returns both outgoing and incoming neighbors', () => {
    const neighbors = useWikiGraphStore.getState().getNeighborIds('a');
    expect(neighbors).toBeInstanceOf(Set);
    expect(Array.from(neighbors).sort()).toEqual(['b', 'c']);
  });

  it('returns an empty set for an isolated node', () => {
    expect(useWikiGraphStore.getState().getNeighborIds('zzz').size).toBe(0);
  });

  it('returns the reverse neighbor for a target-only node', () => {
    expect(Array.from(useWikiGraphStore.getState().getNeighborIds('b'))).toEqual(['a']);
    expect(Array.from(useWikiGraphStore.getState().getNeighborIds('c'))).toEqual(['a']);
  });
});
