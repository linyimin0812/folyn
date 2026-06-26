import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useVaultStore } from './vaultStore';
import { useSettingsStore } from './settingsStore';
import { storageClient } from '@/utils/storageClient';
import type { VaultEntry } from '@quill/vault-provider';

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
  useSettingsStore.setState({
    showHiddenFiles: false,
    excludePatterns: '',
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
    useSettingsStore.setState({ excludePatterns: 'secret.md' });
    await useVaultStore.getState().refreshFileTree();
    const names = useVaultStore.getState().fileTree.map((e) => e.name);
    expect(names).not.toContain('secret.md');
    expect(names).toContain('a.md');
  });

  it('supports glob exclude patterns', async () => {
    useSettingsStore.setState({ excludePatterns: '*.md' });
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
      { path: 'quill-wiki', name: 'quill-wiki', type: 'dir' },
      { path: 'clips', name: 'clips', type: 'dir' },
      { path: 'reports', name: 'reports', type: 'dir' },
    );
    const renamed = await useVaultStore.getState().migrateSpecialDirs();
    const pairs = renamed.map((r) => r.from);
    expect(pairs).toEqual(['quill-wiki', 'clips', 'reports']);
    expect(manager.rename).toHaveBeenCalledWith('quill-wiki', '__wiki__');
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
    useSettingsStore.setState({ dailyNotesDir: 'daily' });
    const renamed = await useVaultStore.getState().migrateSpecialDirs();
    expect(renamed.find((r) => r.from === 'daily')).toBeDefined();

    useSettingsStore.setState({ dailyNotesDir: '__daily__' });
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
    // syncToSettings updates the settings store vault name.
    expect(useSettingsStore.getState().vaultName).toBe('mine');
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
