import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useVaultStore } from './vaultStore';
import { externalFileProvider } from '@/services/externalFileProvider';
import { useAppearanceStore } from './appearanceStore';
import { usePrefsStore } from './prefsStore';
import { storageClient } from '@/utils/storageClient';
import type { VaultEntry } from '@folyn/vault-provider';

// Stub the file watcher so addVault/switchVault never touch Tauri watch APIs.
vi.mock('@/utils/fileWatcher', () => ({
  startVaultWatcher: vi.fn(async () => {}),
  stopVaultWatcher: vi.fn(async () => {}),
  suppressWatcherFor: vi.fn(),
  pauseWatcher: vi.fn(),
  resumeWatcher: vi.fn(),
}));

// Stub path resolver so ~ expansion is predictable.
vi.mock('@/utils/pathResolver', () => ({
  resolveBasePath: vi.fn(async (p: string) => p.replace(/\/+$/, '')),
}));

// Stub the external-file provider so copyExternalFileToVault never touches
// Tauri fs. The readFileBytes spy is configured per-test; writeFile/exists are
// unused by the store action but kept here so other imports stay happy.
vi.mock('@/services/externalFileProvider', () => ({
  externalFileProvider: {
    readFile: vi.fn(async (p: string) => `content-for:${p}`),
    readFileBytes: vi.fn(async (p: string) => {
      // Encode the default text body as UTF-8 so the binary path and the
      // legacy text path carry the same payload in the common (.md) case.
      return new TextEncoder().encode(`content-for:${p}`);
    }),
    writeFile: vi.fn(async () => {}),
    exists: vi.fn(async () => false),
  },
  resolveAbsolutePath: vi.fn(async (p: string) => p),
  isWithinHome: vi.fn(async () => true),
}));

/** A minimal in-memory fake of VaultManager used to drive store actions. */
function createFakeManager() {
  const files = new Map<string, string>();
  const tree: VaultEntry[] = [];
  return {
    files,
    tree,
    switchVault: vi.fn(async () => {}),
    createDir: vi.fn(async (path: string) => {
      if (path) tree.push({ path, name: path, type: 'dir' });
    }),
    listFiles: vi.fn(async () => [...tree]),
    writeFile: vi.fn(async (path: string, content: string) => {
      files.set(path, content);
      tree.push({ path, name: path.split('/').pop() || path, type: 'file' });
    }),
    readFile: vi.fn(async (path: string) => {
      if (!files.has(path)) throw new Error(`File not found: ${path}`);
      return files.get(path) as string;
    }),
    deleteFile: vi.fn(async (path: string) => {
      files.delete(path);
    }),
    deleteDir: vi.fn(async (path: string) => {
      const idx = tree.findIndex((e) => e.path === path);
      if (idx >= 0) tree.splice(idx, 1);
    }),
    rename: vi.fn(async (oldPath: string, newPath: string) => {
      const content = files.get(oldPath);
      if (content !== undefined) {
        files.delete(oldPath);
        files.set(newPath, content);
      }
    }),
    reset() {
      files.clear();
      tree.length = 0;
    },
  };
}

type FakeManager = ReturnType<typeof createFakeManager>;

beforeEach(() => {
  storageClient.__resetForTesting();
  useAppearanceStore.setState({
    showHiddenFiles: false,
    excludePatterns: '',
    vaultName: 'my-vault',
  });
  usePrefsStore.setState({
    dailyNotesDir: '__daily__',
  });
  useVaultStore.setState({
    vaults: [],
    activeVaultId: null,
    currentVault: null,
    fileTree: [],
    isLoading: false,
    error: null,
    pinnedPaths: [],
  } as never);
});

describe('useVaultStore initial state', () => {
  it('starts empty with no active vault', () => {
    const s = useVaultStore.getState();
    expect(s.vaults).toEqual([]);
    expect(s.activeVaultId).toBeNull();
    expect(s.currentVault).toBeNull();
    expect(s.fileTree).toEqual([]);
    expect(s.error).toBeNull();
    expect(s.isLoading).toBe(false);
  });
});

describe('useVaultStore.removeVault', () => {
  it('removes a non-current vault without touching active state', () => {
    useVaultStore.setState({
      vaults: [
        { id: 'v1', name: 'a', providerType: 'tauri', basePath: '/a' },
        { id: 'v2', name: 'b', providerType: 'tauri', basePath: '/b' },
      ],
      activeVaultId: 'v1',
      currentVault: { id: 'v1', name: 'a', providerType: 'tauri', basePath: '/a' },
    } as never);

    useVaultStore.getState().removeVault('v2');

    const s = useVaultStore.getState();
    expect(s.vaults.map((v) => v.id)).toEqual(['v1']);
    expect(s.activeVaultId).toBe('v1');
    expect(s.currentVault?.id).toBe('v1');
  });

  it('clears active state when removing the current vault', () => {
    useVaultStore.setState({
      vaults: [{ id: 'v1', name: 'a', providerType: 'tauri', basePath: '/a' }],
      activeVaultId: 'v1',
      currentVault: { id: 'v1', name: 'a', providerType: 'tauri', basePath: '/a' },
      fileTree: [{ path: 'x.md', name: 'x.md', type: 'file' }],
    } as never);

    useVaultStore.getState().removeVault('v1');

    const s = useVaultStore.getState();
    expect(s.vaults).toEqual([]);
    expect(s.activeVaultId).toBeNull();
    expect(s.currentVault).toBeNull();
    expect(s.fileTree).toEqual([]);
  });
});

describe('useVaultStore.togglePin', () => {
  it('adds and removes a pinned path, persisting per vault', async () => {
    useVaultStore.setState({
      activeVaultId: 'v1',
      pinnedPaths: [],
    } as never);

    await useVaultStore.getState().togglePin('notes/a.md');
    expect(useVaultStore.getState().pinnedPaths).toEqual(['notes/a.md']);

    await useVaultStore.getState().togglePin('notes/a.md');
    expect(useVaultStore.getState().pinnedPaths).toEqual([]);

    // Persisted under the vault-scoped key.
    const stored = await storageClient.get<string[]>('vault:pinned:v1');
    expect(stored).toEqual([]);
  });

  it('does not persist when no active vault is set', async () => {
    useVaultStore.setState({ activeVaultId: null, pinnedPaths: [] } as never);
    await useVaultStore.getState().togglePin('x.md');
    expect(useVaultStore.getState().pinnedPaths).toEqual(['x.md']);
  });
});

describe('useVaultStore file CRUD (via injected manager)', () => {
  let manager: FakeManager;

  beforeEach(() => {
    manager = createFakeManager();
    useVaultStore.setState({ manager: manager as never, currentVault: { id: 'v1', name: 'a', providerType: 'tauri', basePath: '/a' } } as never);
  });

  it('createFile writes content and refreshes the tree', async () => {
    await useVaultStore.getState().createFile('notes/a.md', 'hello');
    expect(manager.writeFile).toHaveBeenCalledWith('notes/a.md', 'hello');
    expect(useVaultStore.getState().fileTree.length).toBeGreaterThan(0);
  });

  it('writeFile delegates to the manager without refreshing', async () => {
    await useVaultStore.getState().writeFile('b.md', 'world');
    expect(manager.writeFile).toHaveBeenCalledWith('b.md', 'world');
    // writeFile does not call refreshFileTree, so listFiles is not invoked.
    expect(manager.listFiles).not.toHaveBeenCalled();
  });

  it('readFile delegates to the manager', async () => {
    await useVaultStore.getState().writeFile('c.md', 'content');
    const out = await useVaultStore.getState().readFile('c.md');
    expect(out).toBe('content');
    expect(manager.readFile).toHaveBeenCalledWith('c.md');
  });

  it('createDir and deleteDir delegate and refresh', async () => {
    await useVaultStore.getState().createDir('sub');
    expect(manager.createDir).toHaveBeenCalledWith('sub');
    await useVaultStore.getState().deleteDir('sub');
    expect(manager.deleteDir).toHaveBeenCalledWith('sub');
  });

  it('deleteFile delegates and refreshes', async () => {
    await useVaultStore.getState().createFile('d.md', 'x');
    await useVaultStore.getState().deleteFile('d.md');
    expect(manager.deleteFile).toHaveBeenCalledWith('d.md');
  });

  it('renameFile delegates to manager.rename', async () => {
    await useVaultStore.getState().renameFile('old.md', 'new.md');
    expect(manager.rename).toHaveBeenCalledWith('old.md', 'new.md');
  });

  it('renameFile rewrites the path and name of an open tab', async () => {
    const { useEditorStore } = await import('./editorStore');
    useEditorStore.setState({
      tabs: [
        { id: 'v1:old.md', name: 'old.md', path: 'old.md', content: '', isDirty: false, fileType: 'markdown', activity: 'files' },
      ],
      activeTabId: 'v1:old.md',
    });

    await useVaultStore.getState().renameFile('old.md', 'renamed.md');

    const tab = useEditorStore.getState().tabs[0];
    expect(tab.path).toBe('renamed.md');
    expect(tab.name).toBe('renamed.md');
    useEditorStore.setState({ tabs: [], activeTabId: null });
  });

  it('renameFile rewrites child tab paths when a directory is renamed', async () => {
    const { useEditorStore } = await import('./editorStore');
    useEditorStore.setState({
      tabs: [
        { id: 'v1:notes/a.md', name: 'a.md', path: 'notes/a.md', content: '', isDirty: false, fileType: 'markdown', activity: 'files' },
      ],
      activeTabId: 'v1:notes/a.md',
    });

    await useVaultStore.getState().renameFile('notes', 'journal');

    const tab = useEditorStore.getState().tabs[0];
    expect(tab.path).toBe('journal/a.md');
    // Basename is unchanged for a directory rename.
    expect(tab.name).toBe('a.md');
    useEditorStore.setState({ tabs: [], activeTabId: null });
  });

  it('moveFiles renames each source into the target dir', async () => {
    await useVaultStore.getState().moveFiles(['a/1.md', 'b/2.md'], 'dest');
    expect(manager.rename).toHaveBeenCalledWith('a/1.md', 'dest/1.md');
    expect(manager.rename).toHaveBeenCalledWith('b/2.md', 'dest/2.md');
  });

  it('moveFiles skips sources already inside the target dir', async () => {
    await useVaultStore.getState().moveFiles(['dest/1.md', 'a/2.md'], 'dest');
    expect(manager.rename).toHaveBeenCalledTimes(1);
    expect(manager.rename).toHaveBeenCalledWith('a/2.md', 'dest/2.md');
  });
});

describe('useVaultStore.copyPath', () => {
  /** Fake manager with path-aware listFiles so copyPath collision logic can be exercised. */
  function createCopyFakeManager() {
    const files = new Map<string, string>();
    const dirs = new Set<string>(); // normalized paths that exist as dirs
    const norm = (p: string) => p.replace(/\/+$/, '');
    const splitPath = (p: string) => {
      const n = norm(p);
      const idx = n.lastIndexOf('/');
      return { dir: idx >= 0 ? n.slice(0, idx) : '', base: idx >= 0 ? n.slice(idx + 1) : n };
    };
    return {
      files,
      dirs,
      listFiles: vi.fn(async (path: string) => {
        const target = norm(path);
        const out: VaultEntry[] = [];
        for (const [p] of files) {
          const { dir, base } = splitPath(p);
          if (dir === target) out.push({ path: p, name: base, type: 'file' });
        }
        for (const d of dirs) {
          if (d === target) continue;
          const { dir, base } = splitPath(d);
          if (dir === target) out.push({ path: d, name: base, type: 'dir' });
        }
        return out;
      }),
      createDir: vi.fn(async (path: string) => { dirs.add(norm(path)); }),
      readFile: vi.fn(async (path: string) => {
        if (!files.has(path)) throw new Error(`File not found: ${path}`);
        return files.get(path) as string;
      }),
      writeFile: vi.fn(async (path: string, content: string) => {
        files.set(path, content);
        const { dir } = splitPath(path);
        if (dir) dirs.add(dir); // parent dirs implicitly exist
      }),
    };
  }

  beforeEach(() => {
    useVaultStore.setState({
      manager: createCopyFakeManager() as never,
      currentVault: { id: 'v1', name: 'a', providerType: 'tauri', basePath: '/a' },
    } as never);
  });

  it('same-dir copy appends `副本` suffix', async () => {
    const m = useVaultStore.getState().manager as ReturnType<typeof createCopyFakeManager>;
    m.files.set('note.md', 'body');
    m.dirs.add('');

    await useVaultStore.getState().copyPath('note.md', 'file', '');

    expect(m.writeFile).toHaveBeenCalledWith('note 副本.md', 'body');
  });

  it('same-dir copy with collision appends `副本 2`', async () => {
    const m = useVaultStore.getState().manager as ReturnType<typeof createCopyFakeManager>;
    m.files.set('note.md', 'body');
    m.files.set('note 副本.md', 'existing');
    m.dirs.add('');

    await useVaultStore.getState().copyPath('note.md', 'file', '');

    expect(m.writeFile).toHaveBeenCalledWith('note 副本 2.md', 'body');
  });

  it('cross-dir copy uses the original name when no collision', async () => {
    const m = useVaultStore.getState().manager as ReturnType<typeof createCopyFakeManager>;
    m.files.set('src/note.md', 'body');
    m.dirs.add('src');
    m.dirs.add('dest');

    await useVaultStore.getState().copyPath('src/note.md', 'file', 'dest');

    expect(m.writeFile).toHaveBeenCalledWith('dest/note.md', 'body');
  });

  it('cross-dir copy falls back to `副本` when the target name exists', async () => {
    const m = useVaultStore.getState().manager as ReturnType<typeof createCopyFakeManager>;
    m.files.set('src/note.md', 'body');
    m.files.set('dest/note.md', 'existing');
    m.dirs.add('src');
    m.dirs.add('dest');

    await useVaultStore.getState().copyPath('src/note.md', 'file', 'dest');

    expect(m.writeFile).toHaveBeenCalledWith('dest/note 副本.md', 'body');
  });

  it('directory copy recurses into subdirs', async () => {
    const m = useVaultStore.getState().manager as ReturnType<typeof createCopyFakeManager>;
    m.dirs.add('');
    m.dirs.add('folder');
    m.dirs.add('folder/sub');
    m.files.set('folder/a.md', 'A');
    m.files.set('folder/sub/b.md', 'B');

    await useVaultStore.getState().copyPath('folder', 'dir', '');

    expect(m.createDir).toHaveBeenCalledWith('folder 副本');
    expect(m.createDir).toHaveBeenCalledWith('folder 副本/sub');
    expect(m.writeFile).toHaveBeenCalledWith('folder 副本/a.md', 'A');
    expect(m.writeFile).toHaveBeenCalledWith('folder 副本/sub/b.md', 'B');
  });
});

describe('useVaultStore.copyExternalFileToVault', () => {
  /** Fake manager — only listFiles + writeFile matter here; the external
   *  source is read via the mocked externalFileProvider, not the manager. */
  function createFakeManager() {
    const files = new Map<string, string>();
    const dirs = new Set<string>();
    const splitPath = (p: string) => {
      const idx = p.lastIndexOf('/');
      return idx >= 0 ? { dir: p.slice(0, idx), base: p.slice(idx + 1) } : { dir: '', base: p };
    };
    return {
      files,
      dirs,
      listFiles: vi.fn(async (path: string) => {
        const out: VaultEntry[] = [];
        for (const [p] of files) {
          const { dir, base } = splitPath(p);
          if (dir === path) out.push({ path: p, name: base, type: 'file' });
        }
        for (const d of dirs) {
          if (d === path) continue;
          const { dir, base } = splitPath(d);
          if (dir === path) out.push({ path: d, name: base, type: 'dir' });
        }
        return out;
      }),
      writeFile: vi.fn(async (path: string, content: string) => { files.set(path, content); }),
      writeFileBytes: vi.fn(async (path: string, bytes: Uint8Array) => { files.set(path, bytes); }),
      createDir: vi.fn(async () => {}),
      readFile: vi.fn(async () => { throw new Error('should not read via manager'); }),
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    useVaultStore.setState({
      manager: createFakeManager() as never,
      currentVault: { id: 'v1', name: 'a', providerType: 'tauri', basePath: '/a' },
      fileTree: [],
    } as never);
  });

  it('reads the external source and writes it to the target dir under its original name', async () => {
    const m = useVaultStore.getState().manager as ReturnType<typeof createFakeManager>;
    m.dirs.add('notes');

    const newPath = await useVaultStore.getState().copyExternalFileToVault('~/Desktop/report.md', 'notes');

    expect(externalFileProvider.readFileBytes).toHaveBeenCalledWith('~/Desktop/report.md');
    expect(m.writeFileBytes).toHaveBeenCalledWith('notes/report.md', new TextEncoder().encode('content-for:~/Desktop/report.md'));
    expect(newPath).toBe('notes/report.md');
  });

  it('falls back to ` 副本` when the target name already exists', async () => {
    const m = useVaultStore.getState().manager as ReturnType<typeof createFakeManager>;
    m.dirs.add('notes');
    m.files.set('notes/report.md', 'existing');

    const newPath = await useVaultStore.getState().copyExternalFileToVault('/abs/report.md', 'notes');

    expect(m.writeFileBytes).toHaveBeenCalledWith('notes/report 副本.md', new TextEncoder().encode('content-for:/abs/report.md'));
    expect(newPath).toBe('notes/report 副本.md');
  });

  it('appends ` 副本 2` on a second collision', async () => {
    const m = useVaultStore.getState().manager as ReturnType<typeof createFakeManager>;
    m.dirs.add('');
    m.files.set('report.md', 'one');
    m.files.set('report 副本.md', 'two');

    const newPath = await useVaultStore.getState().copyExternalFileToVault('/abs/report.md', '');

    expect(m.writeFileBytes).toHaveBeenCalledWith('report 副本 2.md', new TextEncoder().encode('content-for:/abs/report.md'));
    expect(newPath).toBe('report 副本 2.md');
  });

  it('never reads the source through the vault manager', async () => {
    const m = useVaultStore.getState().manager as ReturnType<typeof createFakeManager>;
    m.dirs.add('');

    await useVaultStore.getState().copyExternalFileToVault('~/x.md', '');

    expect(m.readFile).not.toHaveBeenCalled();
  });

  it('preserves bytes that are not valid UTF-8 (binary fidelity)', async () => {
    // Regression for the "Corrupted zip" bug: the copy must go through a
    // byte-preserving (binary) read→write path, not a UTF-8 text round-trip,
    // because non-text bytes (zip / xlsx / image payloads) are not valid
    // UTF-8 and get mangled by decode→encode.
    const m = useVaultStore.getState().manager as ReturnType<typeof createFakeManager>;
    m.dirs.add('bin');
    // Bytes that are NOT valid UTF-8: 0x80/0xff lone continuation, 0xc3 0x28
    // is an overlong/invalid sequence, 0x00 in the middle.
    const bytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x80, 0xff, 0x00, 0x7f, 0xc3, 0x28, 0xed, 0xa0, 0x80]);
    (externalFileProvider.readFileBytes as ReturnType<typeof vi.fn>).mockResolvedValueOnce(bytes);

    await useVaultStore.getState().copyExternalFileToVault('/abs/blob.xlsx', 'bin');

    expect(m.writeFileBytes).toHaveBeenCalledTimes(1);
    const [, written] = (m.writeFileBytes as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(written).toBeInstanceOf(Uint8Array);
    expect(Array.from(written as Uint8Array)).toEqual(Array.from(bytes));
  });
});

describe('useVaultStore.refreshFileTree', () => {
  let manager: FakeManager;

  beforeEach(() => {
    manager = createFakeManager();
    manager.tree.push(
      { path: 'a.md', name: 'a.md', type: 'file' },
      { path: 'notes', name: 'notes', type: 'dir', children: [{ path: 'notes/b.md', name: 'b.md', type: 'file' }] },
      { path: 'secret.md', name: 'secret.md', type: 'file' },
    );
    useVaultStore.setState({ manager: manager as never } as never);
  });

  it('loads entries from the manager into fileTree', async () => {
    await useVaultStore.getState().refreshFileTree();
    const names = useVaultStore.getState().fileTree.map((e) => e.name);
    expect(names).toContain('a.md');
    expect(names).toContain('notes');
    expect(useVaultStore.getState().error).toBeNull();
  });

  it('filters out entries matching excludePatterns', async () => {
    useAppearanceStore.setState({ excludePatterns: 'secret.md' });
    await useVaultStore.getState().refreshFileTree();
    const names = useVaultStore.getState().fileTree.map((e) => e.name);
    expect(names).not.toContain('secret.md');
    expect(names).toContain('a.md');
  });

  it('supports glob exclude patterns', async () => {
    useAppearanceStore.setState({ excludePatterns: '*.md' });
    await useVaultStore.getState().refreshFileTree();
    const files = useVaultStore.getState().fileTree.filter((e) => e.type === 'file');
    expect(files).toEqual([]);
  });

  it('records an error message when listFiles throws', async () => {
    manager.listFiles.mockRejectedValueOnce(new Error('boom'));
    await useVaultStore.getState().refreshFileTree();
    expect(useVaultStore.getState().error).toBe('boom');
  });
});

describe('useVaultStore.migrateSpecialDirs', () => {
  let manager: FakeManager;

  beforeEach(() => {
    manager = createFakeManager();
    useVaultStore.setState({ manager: manager as never } as never);
  });

  it('renames legacy built-in dirs to __name__ form', async () => {
    manager.tree.push(
      { path: 'folyn-wiki', name: 'folyn-wiki', type: 'dir' },
      { path: 'clips', name: 'clips', type: 'dir' },
      { path: 'reports', name: 'reports', type: 'dir' },
    );
    const renamed = await useVaultStore.getState().migrateSpecialDirs();
    const pairs = renamed.map((r) => r.from);
    expect(pairs).toEqual(['folyn-wiki', 'clips', 'reports']);
    expect(manager.rename).toHaveBeenCalledWith('folyn-wiki', '__wiki__');
    expect(manager.rename).toHaveBeenCalledWith('clips', '__clips__');
    expect(manager.rename).toHaveBeenCalledWith('reports', '__reports__');
  });

  it('skips a rename when the target already exists', async () => {
    manager.tree.push(
      { path: 'clips', name: 'clips', type: 'dir' },
      { path: '__clips__', name: '__clips__', type: 'dir' },
    );
    const renamed = await useVaultStore.getState().migrateSpecialDirs();
    expect(renamed.find((r) => r.from === 'clips')).toBeUndefined();
    expect(manager.rename).not.toHaveBeenCalled();
  });

  it('migrates the daily dir only when still on the old default', async () => {
    manager.tree.push({ path: 'daily', name: 'daily', type: 'dir' });
    usePrefsStore.setState({ dailyNotesDir: 'daily' });
    const renamed = await useVaultStore.getState().migrateSpecialDirs();
    expect(renamed.find((r) => r.from === 'daily')).toBeDefined();

    usePrefsStore.setState({ dailyNotesDir: '__daily__' });
    const renamed2 = await useVaultStore.getState().migrateSpecialDirs();
    expect(renamed2.find((r) => r.from === 'daily')).toBeUndefined();
  });
});

describe('useVaultStore.addVault', () => {
  let manager: FakeManager;

  beforeEach(() => {
    manager = createFakeManager();
    useVaultStore.setState({ manager: manager as never } as never);
  });

  it('connects, lists files, and registers the vault as active', async () => {
    await useVaultStore.getState().addVault({ name: 'mine', providerType: 'tauri', basePath: '/v' });

    const s = useVaultStore.getState();
    expect(manager.switchVault).toHaveBeenCalled();
    expect(manager.createDir).toHaveBeenCalledWith('');
    expect(s.vaults).toHaveLength(1);
    expect(s.currentVault?.name).toBe('mine');
    expect(s.activeVaultId).toBe(s.vaults[0].id);
    expect(s.isLoading).toBe(false);
    // syncToSettings updates the appearance store vault name.
    expect(useAppearanceStore.getState().vaultName).toBe('mine');
  });

  it('sets an error and re-throws when the manager fails to connect', async () => {
    manager.switchVault.mockRejectedValueOnce(new Error('cannot connect'));
    await expect(
      useVaultStore.getState().addVault({ name: 'bad', providerType: 'tauri', basePath: '/x' }),
    ).rejects.toThrow('cannot connect');
    expect(useVaultStore.getState().error).toBe('cannot connect');
    expect(useVaultStore.getState().vaults).toHaveLength(0);
    expect(useVaultStore.getState().isLoading).toBe(false);
  });
});

describe('useVaultStore.switchVault', () => {
  let manager: FakeManager;

  beforeEach(() => {
    manager = createFakeManager();
    useVaultStore.setState({ manager: manager as never } as never);
  });

  it('sets an error and returns when the vault id is unknown', async () => {
    await useVaultStore.getState().switchVault('nope');
    expect(useVaultStore.getState().error).toContain('Vault not found');
    expect(manager.switchVault).not.toHaveBeenCalled();
  });
});
