import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  flattenMarkdownFiles,
  buildFileCommands,
  resetFileCommandsCache,
} from './fileCommands';
import type { VaultEntry } from '@folyn/vault-provider';

// Mock editorIoService so file command run() calls a spyable openFile (PR2:
// openFile moved from editorStore action to editorIoService function). vi.mock
// factories are hoisted above imports, so declare the fn via vi.hoisted.
const openFileMock = vi.hoisted(() => vi.fn());
vi.mock('@/services/editorIoService', () => ({
  openFile: openFileMock,
}));

function file(name: string, path?: string): VaultEntry {
  return { type: 'file', name, path: path ?? name };
}
function dir(name: string, children: VaultEntry[], path?: string): VaultEntry {
  return { type: 'dir', name, path: path ?? name, children };
}

beforeEach(() => {
  resetFileCommandsCache();
  openFileMock.mockClear();
});

describe('flattenMarkdownFiles', () => {
  it('collects only .md files from a nested tree', () => {
    const tree: VaultEntry[] = [
      dir('notes', [
        file('a.md', 'notes/a.md'),
        file('b.txt', 'notes/b.txt'),
        file('c.mdx', 'notes/c.mdx'),
      ]),
      file('readme.md', 'readme.md'),
      file('image.png', 'image.png'),
    ];
    const names = flattenMarkdownFiles(tree).map((f) => f.name);
    // Scope is .md (matches the search panel's flattenMarkdownFiles).
    expect(names).toEqual(['a.md', 'readme.md']);
  });

  it('returns a path-sorted list (stable order)', () => {
    const tree: VaultEntry[] = [
      dir('z', [file('z.md', 'z/z.md')]),
      file('a.md', 'a.md'),
      dir('m', [file('m.md', 'm/m.md')]),
    ];
    const paths = flattenMarkdownFiles(tree).map((f) => f.path);
    expect(paths).toEqual(['a.md', 'm/m.md', 'z/z.md']);
  });

  it('walks into empty dirs without error', () => {
    expect(flattenMarkdownFiles([dir('empty', [])])).toEqual([]);
  });
});

describe('buildFileCommands', () => {
  it('builds a file command per .md file with category "file"', () => {
    const tree: VaultEntry[] = [file('a.md', 'dir/a.md'), file('b.md', 'b.md')];
    const cmds = buildFileCommands(tree);
    expect(cmds).toHaveLength(2);
    expect(cmds.every((c) => c.category === 'file')).toBe(true);
    expect(cmds.map((c) => c.id)).toEqual(['file:b.md', 'file:dir/a.md']);
  });

  it('keywords come from path segments', () => {
    const cmds = buildFileCommands([file('a.md', 'notes/sub/a.md')]);
    expect(cmds[0].keywords).toEqual(['notes', 'sub', 'a.md']);
  });

  it('run() calls editorStore.openFile with the file path and name', () => {
    const cmds = buildFileCommands([file('note.md', 'dir/note.md')]);
    cmds[0].run();
    expect(openFileMock).toHaveBeenCalledWith('dir/note.md', 'note.md');
  });

  it('memoizes by tree reference (same array → same result)', () => {
    const tree: VaultEntry[] = [file('a.md', 'a.md')];
    const first = buildFileCommands(tree);
    const second = buildFileCommands(tree);
    expect(second).toBe(first);
  });

  it('rebuilds when the tree reference changes', () => {
    buildFileCommands([file('a.md', 'a.md')]);
    const next = buildFileCommands([file('b.md', 'b.md')]);
    expect(next.map((c) => c.id)).toEqual(['file:b.md']);
  });
});
