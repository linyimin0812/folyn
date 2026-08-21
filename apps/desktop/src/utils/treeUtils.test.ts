import { describe, it, expect } from 'vitest';
import type { VaultEntry } from '@quill/vault-provider';
import {
  flattenTree,
  flattenFileTree,
  collectAllDirPaths,
  matchesSearch,
  insertEntry,
  removeEntry,
  renameEntry,
} from './treeUtils';

const tree: VaultEntry[] = [
  {
    path: 'notes',
    name: 'notes',
    type: 'dir',
    children: [
      {
        path: 'notes/a.md',
        name: 'a.md',
        type: 'file',
      },
      {
        path: 'notes/sub',
        name: 'sub',
        type: 'dir',
        children: [{ path: 'notes/sub/b.md', name: 'b.md', type: 'file' }],
      },
    ],
  },
  { path: 'root.md', name: 'root.md', type: 'file' },
];

describe('flattenTree', () => {
  it('walks files and directories depth-first', () => {
    expect(flattenTree(tree)).toEqual([
      'notes',
      'notes/a.md',
      'notes/sub',
      'notes/sub/b.md',
      'root.md',
    ]);
  });

  it('returns an empty array for empty input', () => {
    expect(flattenTree([])).toEqual([]);
  });
});

describe('flattenFileTree', () => {
  it('only includes files, with path and name', () => {
    expect(flattenFileTree(tree)).toEqual([
      { path: 'notes/a.md', name: 'a.md' },
      { path: 'notes/sub/b.md', name: 'b.md' },
      { path: 'root.md', name: 'root.md' },
    ]);
  });
});

describe('collectAllDirPaths', () => {
  it('returns paths of every directory, top-down', () => {
    expect(collectAllDirPaths(tree)).toEqual(['notes', 'notes/sub']);
  });

  it('returns an empty array when there are no directories', () => {
    expect(collectAllDirPaths([{ path: 'a.md', name: 'a.md', type: 'file' }])).toEqual([]);
  });
});

describe('matchesSearch', () => {
  it('matches by name (case-insensitive substring)', () => {
    expect(matchesSearch({ path: 'a', name: 'README', type: 'file' }, 'read')).toBe(true);
  });

  it('matches when a descendant name matches', () => {
    const node: VaultEntry = {
      path: 'notes',
      name: 'notes',
      type: 'dir',
      children: [{ path: 'notes/secret.md', name: 'secret.md', type: 'file' }],
    };
    expect(matchesSearch(node, 'sec')).toBe(true);
  });

  it('returns false when no name in the subtree matches', () => {
    const node: VaultEntry = {
      path: 'notes',
      name: 'notes',
      type: 'dir',
      children: [{ path: 'notes/a.md', name: 'a.md', type: 'file' }],
    };
    expect(matchesSearch(node, 'zzz')).toBe(false);
  });
});

describe('insertEntry', () => {
  it('appends a root-level file', () => {
    const result = insertEntry(tree, 'new.md', 'file');
    expect(result).toHaveLength(3);
    expect(result[result.length - 1]).toEqual({ path: 'new.md', name: 'new.md', type: 'file' });
  });

  it('inserts under the matching parent dir', () => {
    const result = insertEntry(tree, 'notes/c.md', 'file');
    const notes = result.find((e) => e.path === 'notes');
    expect(notes?.children).toContainEqual({ path: 'notes/c.md', name: 'c.md', type: 'file' });
  });

  it('inserts into a nested dir', () => {
    const result = insertEntry(tree, 'notes/sub/c.md', 'file');
    const notes = result.find((e) => e.path === 'notes');
    const sub = notes?.children?.find((e) => e.path === 'notes/sub');
    expect(sub?.children).toContainEqual({ path: 'notes/sub/c.md', name: 'c.md', type: 'file' });
  });

  it('returns tree unchanged when the parent dir is not in the tree', () => {
    const result = insertEntry(tree, 'missing/x.md', 'file');
    expect(result).toBe(tree);
  });

  it('does not mutate the input tree', () => {
    const before = JSON.parse(JSON.stringify(tree));
    insertEntry(tree, 'notes/c.md', 'file');
    expect(tree).toEqual(before);
  });
});

describe('removeEntry', () => {
  it('removes a root-level file', () => {
    const result = removeEntry(tree, 'root.md');
    expect(flattenTree(result)).toEqual(['notes', 'notes/a.md', 'notes/sub', 'notes/sub/b.md']);
  });

  it('removes a nested file', () => {
    const result = removeEntry(tree, 'notes/sub/b.md');
    expect(flattenTree(result)).toEqual(['notes', 'notes/a.md', 'notes/sub', 'root.md']);
  });

  it('removes a dir and its subtree', () => {
    const result = removeEntry(tree, 'notes/sub');
    expect(flattenTree(result)).toEqual(['notes', 'notes/a.md', 'root.md']);
  });

  it('returns the input reference when path is not found', () => {
    expect(removeEntry(tree, 'missing.md')).toBe(tree);
  });

  it('does not mutate the input tree', () => {
    const before = JSON.parse(JSON.stringify(tree));
    removeEntry(tree, 'notes/a.md');
    expect(tree).toEqual(before);
  });
});

describe('renameEntry', () => {
  it('renames a root-level file', () => {
    const result = renameEntry(tree, 'root.md', 'renamed.md');
    expect(flattenTree(result)).toEqual(['notes', 'notes/a.md', 'notes/sub', 'notes/sub/b.md', 'renamed.md']);
  });

  it('renames a nested file in place', () => {
    const result = renameEntry(tree, 'notes/a.md', 'notes/c.md');
    const notes = result.find((e) => e.path === 'notes');
    expect(notes?.children?.find((e) => e.path === 'notes/c.md')).toBeDefined();
    expect(notes?.children?.find((e) => e.path === 'notes/a.md')).toBeUndefined();
  });

  it('renames a dir and rewrites child paths', () => {
    const result = renameEntry(tree, 'notes/sub', 'notes/renamed-sub');
    expect(flattenTree(result)).toEqual(['notes', 'notes/a.md', 'notes/renamed-sub', 'notes/renamed-sub/b.md', 'root.md']);
  });

  it('renames a dir to a new parent and rewrites child paths', () => {
    const result = renameEntry(tree, 'notes/sub', 'other/sub');
    expect(flattenTree(result)).toContain('other/sub');
    expect(flattenTree(result)).toContain('other/sub/b.md');
    expect(flattenTree(result)).not.toContain('notes/sub');
  });

  it('returns the input reference when oldPath is not found', () => {
    expect(renameEntry(tree, 'missing.md', 'x.md')).toBe(tree);
  });

  it('does not mutate the input tree', () => {
    const before = JSON.parse(JSON.stringify(tree));
    renameEntry(tree, 'notes/sub', 'notes/renamed-sub');
    expect(tree).toEqual(before);
  });
});
