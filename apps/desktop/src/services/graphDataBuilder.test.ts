import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { WikiEntry } from '@/types/wiki';

// Shared Tauri mocks are auto-loaded via test/setup.ts — no per-file vi.mock.

// Controlled wiki + vault contents for the pure graph transforms.
// Declare mock fns via a single vi.hoisted call so the bindings are available
// to the hoisted vi.mock factories.
const { files, listFilesImpl, wikiReadFile, vaultReadFile, vaultFileTree } = vi.hoisted(() => {
  const files = new Map<string, string>();
  const listFilesImpl = vi.fn(async (_dir: string) => [] as WikiEntry[]);
  const wikiReadFile = vi.fn(async (_path: string) => '');
  const vaultReadFile = vi.fn(async (_path: string) => '');
  const vaultFileTree = vi.fn(() => [] as import('@mochi/vault-provider').VaultEntry[]);
  return { files, listFilesImpl, wikiReadFile, vaultReadFile, vaultFileTree };
});

listFilesImpl.mockImplementation(async (dir: string): Promise<WikiEntry[]> => {
  const prefix = dir ? `${dir}/` : '';
  return [...files.keys()]
    .filter((p) => p.startsWith(prefix))
    .map((p) => {
      const name = p.slice(prefix.length);
      return { path: p, name, type: 'file' as const };
    });
});
wikiReadFile.mockImplementation(async (path: string) => files.get(path) ?? '');
vaultReadFile.mockImplementation(async (path: string) => files.get(path) ?? '');

vi.mock('./wikiProvider', () => ({
  wikiProvider: {
    listFiles: listFilesImpl,
    readFile: wikiReadFile,
  },
}));

vi.mock('@/store/vaultStore', () => ({
  useVaultStore: {
    getState: () => ({ fileTree: vaultFileTree(), readFile: vaultReadFile }),
  },
}));

import { buildGraphData } from './graphDataBuilder';

beforeEach(() => {
  files.clear();
  listFilesImpl.mockClear();
  wikiReadFile.mockClear();
  vaultReadFile.mockClear();
  vaultFileTree.mockReturnValue([]);
});

function md(frontmatter: string, body: string): string {
  return `---\n${frontmatter}\n---\n\n${body}`;
}

describe('buildGraphData — nodes', () => {
  it('produces a node per wiki page with title/type/tags from frontmatter', async () => {
    files.set('entities/a.md', md('title: Alpha\ntype: entity\ntags: [x, y]', 'body'));
    files.set('concepts/b.md', md('title: Beta\ntype: concept', 'body'));

    const { nodes } = await buildGraphData();

    expect(nodes).toHaveLength(2);
    const alpha = nodes.find((n) => n.id === 'wiki://entities/a.md')!;
    expect(alpha.label).toBe('Alpha');
    expect(alpha.type).toBe('entity');
    expect(alpha.tags).toEqual(['x', 'y']);
    expect(alpha.linkCount).toBe(0);
    const beta = nodes.find((n) => n.id === 'wiki://concepts/b.md')!;
    expect(beta.type).toBe('concept');
  });

  it('falls back to the file name (sans .md) when title is missing', async () => {
    files.set('entities/notitle.md', 'body only');
    const { nodes } = await buildGraphData();
    expect(nodes[0].label).toBe('notitle');
    expect(nodes[0].type).toBe('entity'); // default type
  });

  it('skips non-markdown and unreadable files', async () => {
    files.set('entities/keep.md', md('title: Keep', 'body'));
    files.set('entities/skip.txt', 'ignore me');
    const { nodes } = await buildGraphData();
    expect(nodes.map((n) => n.label)).toEqual(['Keep']);
  });
});

describe('buildGraphData — direct link signal', () => {
  it('creates a weight-3 edge with directLink=true for [[wiki://]] targets', async () => {
    // Different types so type-affinity (weight 1) does not also fire —
    // isolating the direct-link signal.
    files.set('entities/a.md', md('title: A\ntype: entity', 'see [[concepts/b.md]]'));
    files.set('concepts/b.md', md('title: B\ntype: concept', 'body'));
    const { edges, nodes } = await buildGraphData();
    expect(edges).toHaveLength(1);
    expect(edges[0].source).toBe('wiki://entities/a.md');
    expect(edges[0].target).toBe('wiki://concepts/b.md');
    expect(edges[0].weight).toBe(3);
    expect(edges[0].signals.directLink).toBe(true);
    // linkCount propagated to both endpoints
    expect(nodes.find((n) => n.id === 'wiki://entities/a.md')!.linkCount).toBe(1);
    expect(nodes.find((n) => n.id === 'wiki://concepts/b.md')!.linkCount).toBe(1);
  });

  it('dedupes multiple links between the same pair into one edge', async () => {
    files.set('entities/a.md', md('title: A\ntype: entity', '[[concepts/b.md]] [[concepts/b.md]] [[concepts/b.md]]'));
    files.set('concepts/b.md', md('title: B\ntype: concept', '[[entities/a.md]]'));
    const { edges } = await buildGraphData();
    expect(edges).toHaveLength(1);
    // directLink counted once even though links repeat
    expect(edges[0].weight).toBe(3);
  });

  it('ignores links to unknown targets (orphans stay unlinked)', async () => {
    files.set('entities/a.md', md('title: A', '[[entities/ghost.md]]'));
    const { edges, nodes } = await buildGraphData();
    expect(edges).toHaveLength(0);
    expect(nodes[0].linkCount).toBe(0);
  });

  it('resolves links via the wiki:// prefix variant', async () => {
    files.set('entities/a.md', md('title: A', 'link to [[wiki://concepts/b.md]]'));
    files.set('concepts/b.md', md('title: B', ''));
    const { edges } = await buildGraphData();
    // [[wiki://concepts/b.md]] -> link = "wiki://concepts/b.md" matches node id directly
    expect(edges).toHaveLength(1);
  });
});

describe('buildGraphData — source overlap signal', () => {
  it('adds a weight-4 sourceOverlap edge between pages sharing a source', async () => {
    // Different types so type-affinity does not also fire, isolating the
    // source-overlap signal.
    files.set(
      'syntheses/s1.md',
      md('title: S1\ntype: synthesis\nsources:\n  - notes/shared.md', 'body'),
    );
    files.set(
      'syntheses/s2.md',
      md('title: S2\ntype: comparison\nsources:\n  - notes/shared.md', 'body'),
    );
    const { edges } = await buildGraphData();
    expect(edges).toHaveLength(1);
    expect(edges[0].signals.sourceOverlap).toBe(true);
    expect(edges[0].weight).toBe(4);
  });
});

describe('buildGraphData — type affinity + adamic-adar', () => {
  it('adds type affinity (weight 1) between same-typed non-user pages', async () => {
    // Two entities, no direct link, no source overlap — affinity only.
    // (adamic-adar requires common neighbors; with no edges it stays 0.)
    files.set('entities/a.md', md('title: A\ntype: entity', '[[entities/c.md]]'));
    files.set('entities/b.md', md('title: B\ntype: entity', '[[entities/c.md]]'));
    files.set('entities/c.md', md('title: C\ntype: entity', ''));
    const { edges } = await buildGraphData();
    const ab = edges.find(
      (e) =>
        (e.source === 'wiki://entities/a.md' && e.target === 'wiki://entities/b.md') ||
        (e.source === 'wiki://entities/b.md' && e.target === 'wiki://entities/a.md'),
    )!;
    expect(ab.signals.typeAffinity).toBe(1);
    expect(ab.weight).toBeGreaterThan(0);
  });

  it('does not apply type affinity for user-file type', async () => {
    // Both files link to each other so both are included as user-file nodes.
    vaultFileTree.mockReturnValue([
      { path: 'notes/a.md', name: 'a.md', type: 'file' },
      { path: 'notes/b.md', name: 'b.md', type: 'file' },
    ]);
    files.set('notes/a.md', md('title: A', '[[notes/b.md]]'));
    files.set('notes/b.md', md('title: B', '[[notes/a.md]]'));
    const { edges } = await buildGraphData();
    const edge = edges.find((e) => e.source === 'notes/a.md' || e.target === 'notes/a.md')!;
    expect(edge.signals.typeAffinity).toBe(0);
    expect(edge.signals.directLink).toBe(true);
  });
});

describe('buildGraphData — vault user files', () => {
  it('includes a vault file only if it has wiki links or is a source', async () => {
    vaultFileTree.mockReturnValue([
      { path: 'notes/linked.md', name: 'linked.md', type: 'file' },
      { path: 'notes/empty.md', name: 'empty.md', type: 'file' },
    ]);
    files.set('notes/linked.md', 'body [[entities/a.md]]');
    files.set('notes/empty.md', 'just text, no links');
    files.set('entities/a.md', md('title: A\ntype: entity', ''));
    const { nodes } = await buildGraphData();
    expect(nodes.map((n) => n.id)).toContain('notes/linked.md');
    expect(nodes.map((n) => n.id)).not.toContain('notes/empty.md');
  });

  it('includes a vault file referenced as a wiki source even without links', async () => {
    vaultFileTree.mockReturnValue([
      { path: 'notes/src.md', name: 'src.md', type: 'file' },
    ]);
    files.set('notes/src.md', 'no links here');
    files.set(
      'syntheses/s.md',
      md('title: S\ntype: synthesis\nsources:\n  - notes/src.md', ''),
    );
    const { nodes } = await buildGraphData();
    expect(nodes.map((n) => n.id)).toContain('notes/src.md');
  });

  it('flattens nested directory trees to collect all .md files', async () => {
    vaultFileTree.mockReturnValue([
      {
        path: 'notes',
        name: 'notes',
        type: 'dir',
        children: [
          { path: 'notes/sub/deep.md', name: 'deep.md', type: 'file' },
          { path: 'notes/sub', name: 'sub', type: 'dir', children: [] },
        ],
      },
    ]);
    files.set('notes/sub/deep.md', '[[entities/a.md]]');
    files.set('entities/a.md', md('title: A\ntype: entity', ''));
    const { nodes } = await buildGraphData();
    expect(nodes.map((n) => n.id)).toContain('notes/sub/deep.md');
  });
});

describe('buildGraphData — edge filtering', () => {
  it('filters out zero-weight edges', async () => {
    // Two pages with no relationship at all -> no edge.
    files.set('entities/a.md', md('title: A\ntype: entity', ''));
    files.set('concepts/b.md', md('title: B\ntype: concept', ''));
    const { edges } = await buildGraphData();
    expect(edges).toHaveLength(0);
  });
});
