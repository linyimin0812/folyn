import { describe, it, expect, vi, beforeEach } from 'vitest';

// ponytail: jsdom runtime is non-Tauri, so the new VaultApi methods
// (toAssetUrl/resolvePath) hit their non-Tauri branch — the smallest
// check that the branching doesn't throw and returns the input.
// A real-browser check would exercise the Tauri branch (convertFileSrc →
// asset://, resolveBasePath → home dir). Ceiling: Tauri path is untested
// here. Upgrade: a Tauri-runtime vitest env or a Playwright smoke.

const vaultState = vi.hoisted(() => ({
  currentVault: { id: 'v1', name: 'Work', basePath: '/vault' } as { id: string; name: string; basePath: string } | null,
  isLoading: false,
  manager: { listFiles: vi.fn() },
}));
const openFile = vi.hoisted(() => vi.fn(async () => {}));
const fileExists = vi.hoisted(() => vi.fn(async () => true));
/** Bytes `open()` serves, handed out at most `chunk` per `read()` like a real file handle. */
const openFile_ = vi.hoisted(() => ({ bytes: new Uint8Array(), chunk: 3, closed: 0, reads: 0 }));
const fsOpen = vi.hoisted(() => vi.fn(async () => {
  let pos = 0;
  return {
    async read(buf: Uint8Array) {
      openFile_.reads++;
      if (pos >= openFile_.bytes.length) return null;
      const n = Math.min(buf.length, openFile_.chunk, openFile_.bytes.length - pos);
      buf.set(openFile_.bytes.subarray(pos, pos + n));
      pos += n;
      return n;
    },
    async close() { openFile_.closed++; },
  };
}));
const readTextFile = vi.hoisted(() => vi.fn(async () => 'whole file'));

vi.mock('@/store/vaultStore', () => ({
  useVaultStore: { getState: () => vaultState, subscribe: () => () => {} },
}));
vi.mock('@tauri-apps/api/event', () => ({ listen: async () => () => {} }));

vi.mock('@/store/appearanceStore', () => ({
  useAppearanceStore: { getState: () => ({ excludePatterns: '# comment\n__reports__\n*.tmp' }), subscribe: () => () => {} },
}));

vi.mock('@tauri-apps/plugin-fs', () => ({ exists: fileExists, open: fsOpen, readTextFile }));

vi.mock('@/store/vaultConfigStore', () => ({
  useVaultConfigStore: {
    getState: () => ({ imagePath: 'assets/images/' }),
  },
}));

vi.mock('@/store/terminalStore', () => ({
  useTerminalStore: { getState: () => ({ sessions: [], addSession: () => 's1' }) },
}));

vi.mock('@/store/editorViewState', () => ({
  useEditorViewStateStore: { getState: () => ({ openTerminalDock() {}, closeTerminalPanel() {} }), subscribe: () => () => {} },
}));

vi.mock('@/utils/storageClient', () => ({
  storageClient: { get: async () => undefined, set: async () => {} },
}));

vi.mock('@/services/editorIoService', () => ({ openFile }));

vi.mock('@/services/editorHandleRegistry', () => ({
  getActiveEditorHandle: () => null,
}));

vi.mock('@/components/file-types/registry', () => ({
  registerFileTypeHandler: () => ({ dispose() {} }),
  resolveDefault: () => undefined,
}));

vi.mock('@/components/file-types/previewPath', () => ({
  resolvePreviewPath: async (p: string, _root: string) => p,
}));

vi.mock('@/utils/pathResolver', () => ({
  resolveBasePath: async (p: string) => p,
}));

vi.mock('@/utils/platform', () => ({ isTauri: () => false }));

const { createExtensionApi } = await import('./createExtensionApi');
const { useNavStore } = await import('@/store/navStore');

function makeApi() {
  return createExtensionApi({ id: 'test', name: 'test', version: '0.0.1', main: 'x.js', tier: 'trusted', permissions: {} } as never).api;
}

describe('ExtensionApi / vault + vaultConfig (Phase 1 additions)', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('vault.toAssetUrl returns the path unchanged in non-Tauri runtime', () => {
    const api = makeApi();
    expect(api.vault.toAssetUrl('/vault/foo.png')).toBe('/vault/foo.png');
  });

  it('vault.resolvePath returns the path unchanged in non-Tauri runtime', async () => {
    const api = makeApi();
    expect(await api.vault.resolvePath('~/vault')).toBe('~/vault');
  });

  it('vaultConfig.getImagePath returns the configured path (trailing slash trimmed)', () => {
    const api = makeApi();
    expect(api.vaultConfig.getImagePath()).toBe('assets/images');
  });

  it('vaultConfig.getExcludePatterns lists the file-panel filters, comments dropped', () => {
    const api = makeApi();
    expect(api.vaultConfig.getExcludePatterns()).toEqual(['__reports__', '*.tmp']);
  });

  it('vaultConfig.getImagePath falls back to default when unset', async () => {
    vi.doMock('@/store/vaultConfigStore', () => ({
      useVaultConfigStore: { getState: () => ({ imagePath: '' }) },
    }));
    const { createExtensionApi: fresh } = await import('./createExtensionApi');
    const api = fresh({ id: 't', name: 't', version: '0', main: 'x', tier: 'trusted', permissions: {} } as never).api;
    expect(api.vaultConfig.getImagePath()).toBe('assets/images/');
  });
});

describe('ExtensionApi / vault identity and file listing', () => {
  beforeEach(() => {
    vaultState.currentVault = { id: 'v1', name: 'Work', basePath: '/vault' };
    vaultState.isLoading = false;
  });

  it('vault.current exposes only the id and name of a ready vault', () => {
    expect(makeApi().vault.current()).toEqual({ id: 'v1', name: 'Work' });
    vaultState.isLoading = true;
    expect(makeApi().vault.current()).toBeNull();
    vaultState.isLoading = false;
    vaultState.currentVault = null;
    expect(makeApi().vault.current()).toBeNull();
  });

  it('vault.listFiles flattens the tree, applies the file-panel filters, and reports size + mtime', async () => {
    vaultState.manager.listFiles.mockResolvedValue([
      { path: 'docs', name: 'docs', type: 'dir', children: [
        { path: 'docs/a.md', name: 'a.md', type: 'file', size: 12, lastModified: new Date(1000) },
        { path: 'docs/b.tmp', name: 'b.tmp', type: 'file', size: 1, lastModified: new Date(1) },
      ] },
      { path: 'c.md', name: 'c.md', type: 'file' },
    ]);
    expect(await makeApi().vault.listFiles()).toEqual([
      { path: 'docs/a.md', name: 'a.md', size: 12, mtimeMs: 1000 },
      { path: 'c.md', name: 'c.md', size: 0, mtimeMs: 0 },
    ]);
    expect(vaultState.manager.listFiles).toHaveBeenCalledWith('', true, false, ['__reports__', '*.tmp', '.git']);
  });

  it('vault.listFiles with exclude replaces the file-panel filters; includeHidden lists dotfiles; .git never', async () => {
    vaultState.manager.listFiles.mockResolvedValue([
      { path: '.obsidian', name: '.obsidian', type: 'dir', children: [{ path: '.obsidian/app.json', name: 'app.json', type: 'file', size: 2 }] },
      { path: 'b.tmp', name: 'b.tmp', type: 'file', size: 3 },
      { path: 'a.log', name: 'a.log', type: 'file', size: 4 },
    ]);
    const files = await makeApi().vault.listFiles({ exclude: ['*.log'], includeHidden: true });
    // `*.tmp` is a file-panel filter, which `exclude` replaces.
    expect(files.map((f) => f.path)).toEqual(['.obsidian/app.json', 'b.tmp']);
    expect(vaultState.manager.listFiles).toHaveBeenLastCalledWith('', true, true, ['*.log', '.git']);
  });
});

describe('ExtensionApi / vault.readText', () => {
  beforeEach(() => {
    Object.assign(openFile_, { closed: 0, reads: 0, chunk: 3 });
    fsOpen.mockClear();
    readTextFile.mockClear();
  });

  it('reads the whole file without maxBytes', async () => {
    await expect(makeApi().vault.readText('a.md')).resolves.toBe('whole file');
    expect(fsOpen).not.toHaveBeenCalled();
  });

  it('with maxBytes reads at most that many bytes, across short reads, and closes the file', async () => {
    openFile_.bytes = new TextEncoder().encode('hello world');
    await expect(makeApi().vault.readText('a.md', { maxBytes: 8 })).resolves.toBe('hello wo');
    expect(readTextFile).not.toHaveBeenCalled();
    expect(openFile_.closed).toBe(1);
  });

  it('with maxBytes returns the whole text of a shorter file', async () => {
    openFile_.bytes = new TextEncoder().encode('hi');
    await expect(makeApi().vault.readText('a.md', { maxBytes: 100 })).resolves.toBe('hi');
  });

  it('drops a multi-byte character cut off at the limit', async () => {
    openFile_.bytes = new TextEncoder().encode('ab日'); // 日 is 3 bytes
    await expect(makeApi().vault.readText('a.md', { maxBytes: 4 })).resolves.toBe('ab');
  });

  it('is null for binary content: a NUL byte, or bytes that are not UTF-8', async () => {
    openFile_.bytes = Uint8Array.from([0x50, 0x4e, 0x47, 0x00, 0x01]);
    await expect(makeApi().vault.readText('a.png', { maxBytes: 8 })).resolves.toBeNull();
    openFile_.bytes = Uint8Array.from([0xff, 0xfe, 0x41]);
    await expect(makeApi().vault.readText('a.bin', { maxBytes: 8 })).resolves.toBeNull();
    expect(openFile_.closed).toBe(2);
  });

  it('still rejects a path that leaves the vault', async () => {
    await expect(makeApi().vault.readText('../etc/hosts', { maxBytes: 8 })).rejects.toThrow(/escapes the vault/);
    expect(fsOpen).not.toHaveBeenCalled();
  });
});

describe('ExtensionApi / files.open', () => {
  beforeEach(() => {
    openFile.mockClear();
    fileExists.mockResolvedValue(true);
    useNavStore.setState({ currentPage: 'ext:x.page' });
  });

  it('opens the file and shows the editor page', async () => {
    await makeApi().files.open('docs/a.md');
    expect(openFile).toHaveBeenCalledWith('docs/a.md', 'a.md');
    expect(useNavStore.getState().currentPage).toBe('editor');
  });

  it('rejects a missing file and stays on the page', async () => {
    fileExists.mockResolvedValue(false);
    await expect(makeApi().files.open('gone.md')).rejects.toThrow('file not found');
    expect(openFile).not.toHaveBeenCalled();
    expect(useNavStore.getState().currentPage).toBe('ext:x.page');
  });
});
