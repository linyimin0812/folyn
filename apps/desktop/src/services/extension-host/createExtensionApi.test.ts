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

vi.mock('@/store/vaultStore', () => ({
  useVaultStore: { getState: () => vaultState },
}));

vi.mock('@/store/appearanceStore', () => ({
  useAppearanceStore: { getState: () => ({ excludePatterns: '# comment\n__reports__\n*.tmp' }), subscribe: () => () => {} },
}));

vi.mock('@tauri-apps/plugin-fs', () => ({ exists: fileExists }));

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

  it('vault.listFiles flattens the tree and applies exclude patterns', async () => {
    vaultState.manager.listFiles.mockResolvedValue([
      { path: 'docs', name: 'docs', type: 'dir', children: [
        { path: 'docs/a.md', name: 'a.md', type: 'file' },
        { path: 'docs/b.tmp', name: 'b.tmp', type: 'file' },
      ] },
      { path: 'c.md', name: 'c.md', type: 'file' },
    ]);
    expect(await makeApi().vault.listFiles()).toEqual([
      { path: 'docs/a.md', name: 'a.md' },
      { path: 'c.md', name: 'c.md' },
    ]);
    expect(vaultState.manager.listFiles).toHaveBeenCalledWith('', true, false, ['__reports__', '*.tmp']);
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
