import { describe, it, expect, vi, beforeEach } from 'vitest';

// ponytail: jsdom runtime is non-Tauri, so the new VaultApi methods
// (toAssetUrl/resolvePath) hit their non-Tauri branch — the smallest
// check that the branching doesn't throw and returns the input.
// A real-browser check would exercise the Tauri branch (convertFileSrc →
// asset://, resolveBasePath → home dir). Ceiling: Tauri path is untested
// here. Upgrade: a Tauri-runtime vitest env or a Playwright smoke.

vi.mock('@/store/vaultStore', () => ({
  useVaultStore: { getState: () => ({ currentVault: { basePath: '/vault' } }) },
}));

vi.mock('@/store/vaultConfigStore', () => ({
  useVaultConfigStore: {
    getState: () => ({ imagePath: 'assets/images/' }),
  },
}));

vi.mock('@/store/terminalStore', () => ({
  useTerminalStore: { getState: () => ({ sessions: [], addSession: () => 's1' }) },
}));

vi.mock('@/store/editorViewState', () => ({
  useEditorViewStateStore: { getState: () => ({ openTerminalDock() {}, closeTerminalPanel() {} }) },
}));

vi.mock('@/utils/storageClient', () => ({
  storageClient: { get: async () => undefined, set: async () => {} },
}));

vi.mock('@/services/editorIoService', () => ({
  openFile: async () => {},
}));

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
