import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock the editor-layer dependencies the service routes through. The service
// reads/writes editorStore via getState/setState and chains out to vaultStore,
// watcher, persistence — stub them all so we can assert routing
// without touching real Tauri FS.

const { editorState, setStateMock } = vi.hoisted(() => {
  const editorState = {
    tabs: [] as Array<{ id: string; name: string; path: string; content: string; isDirty: boolean; fileType: string; activity: string; cursorLine?: number; cursorCol?: number; viewMode?: string }>,
    activeTabId: null as string | null,
    viewMode: 'split' as string,
    isFileLoading: false,
    externalContentVersion: 0,
    diffReviewMode: false,
    enterDiffReview: vi.fn(),
    updateTabContent: vi.fn(),
    setContentExternal: vi.fn(),
    saveFile: vi.fn(),
    openFile: vi.fn(),
  };
  return { editorState, setStateMock: vi.fn() };
});

vi.mock('@/store/editorStore', () => ({
  useEditorStore: {
    getState: () => editorState,
    setState: setStateMock,
  },
  detectFileType: vi.fn((p: string) => (p.endsWith('.md') ? 'markdown' : 'code')),
  detectActivity: vi.fn(() => 'files'),
}));

vi.mock('@/store/vaultStore', () => ({
  useVaultStore: { getState: () => ({ activeVaultId: 'v1', readFile: vi.fn(), writeFile: vi.fn(), createDir: vi.fn(), refreshFileTree: vi.fn(), currentVault: null }) },
}));
vi.mock('@/components/file-types/registry', () => ({
  getHandlerById: vi.fn(() => ({ id: 'markdown', needsFileContent: true, deserialize: (r: string) => r, serialize: (c: string) => c })),
  getDefaultMode: () => undefined,
  usesShellEditor: () => false,
  getSupportedModes: () => [],
}));
vi.mock('@/utils/fileWatcher', () => ({ suppressWatcherFor: vi.fn() }));
vi.mock('@/store/editorAutoSave', () => ({ scheduleAutoSave: vi.fn(), flushAllAutoSaves: vi.fn() }));
vi.mock('@/store/editorPersistence', () => ({ persistOpenTabs: vi.fn(), flushPersistOpenTabs: vi.fn(), loadPersistedOpenTabs: vi.fn(async () => null), persistExternalOpenTabs: vi.fn(), flushPersistExternalOpenTabs: vi.fn(), loadExternalOpenTabs: vi.fn(async () => null) }));
vi.mock('@/utils/platform', () => ({ isTauri: () => true }));
vi.mock('@tauri-apps/plugin-fs', () => ({
  // stat used by the folder branch of openExternalPaths; tests flip
  // the mock's return value per case.
  stat: vi.fn(async () => ({ isDirectory: false, isFile: true, isSymlink: false })),
}));
const addFolderMock = vi.fn(async () => false);
// Mutable folder list read at call time by the duplicate-toast branch —
// tests push a path to simulate "already registered".
const foldersList: Array<{ path: string }> = [];
vi.mock('@/store/externalFolderStore', () => ({
  useExternalFolderStore: { getState: () => ({ addFolder: addFolderMock, folders: foldersList }) },
}));
const toastPushes: string[] = [];
vi.mock('@/store/toastStore', () => ({
  useToastStore: { getState: () => ({ push: (m: string) => toastPushes.push(m) }) },
}));
vi.mock('@/i18n', () => ({
  // t passthrough: assertions read the pushed key, not the translated text.
  default: { t: (k: string) => k },
}));
const invokeMock = vi.fn(async () => null);
vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...a: unknown[]) => invokeMock(...(a as [string])),
}));
vi.mock('@/services/externalFileProvider', () => ({
  externalFileProvider: {
    readFile: vi.fn(),
    writeFile: vi.fn(async () => {}),
    writeFileBytes: vi.fn(async () => {}),
    exists: vi.fn(async () => false),
  },
}));

import {
  openFile,
  saveFile,
  saveOpenTabs,
  restoreOpenTabs,
  checkDiskChanges,
  flushAutoSaves,
  openExternalPaths,
  openExternalFile,
} from './editorIoService';
import { flushAllAutoSaves } from '@/store/editorAutoSave';

beforeEach(() => {
  vi.clearAllMocks();
  editorState.tabs = [];
  editorState.activeTabId = null;
  editorState.viewMode = 'split';
  editorState.isFileLoading = false;
  editorState.externalContentVersion = 0;
  editorState.diffReviewMode = false;
  foldersList.length = 0;
  toastPushes.length = 0;
});

describe('editorIoService — signatures exist', () => {
  it('exports the IO functions', () => {
    expect(typeof openFile).toBe('function');
    expect(typeof saveFile).toBe('function');
    expect(typeof saveOpenTabs).toBe('function');
    expect(typeof restoreOpenTabs).toBe('function');
    expect(typeof checkDiskChanges).toBe('function');
    expect(typeof flushAutoSaves).toBe('function');
  });
});

describe('editorIoService.saveOpenTabs', () => {
  it('is a no-op when there is no active vault id', async () => {
    // ponytail: ceiling — full IO path (read/write file via Tauri FS, watcher
    // suppression, persistence round-trip) can't be exercised
    // in jsdom. We assert the early-return guard and the flushAutoSaves
    // delegation to flushAllAutoSaves; the on-disk behavior is covered by the
    // existing editorStore integration surface and will be re-asserted in PR2
    // after the consumer migration.
    const { useVaultStore } = await import('@/store/vaultStore');
    const flushPersistOpenTabs = (await import('@/store/editorPersistence')).flushPersistOpenTabs;
    vi.spyOn(useVaultStore, 'getState').mockReturnValue({ activeVaultId: null } as never);
    saveOpenTabs();
    expect(flushPersistOpenTabs).not.toHaveBeenCalled();
  });
});

describe('editorIoService.flushAutoSaves', () => {
  it('delegates to flushAllAutoSaves with saveFile as the per-tab sink', async () => {
    await flushAutoSaves();
    expect(flushAllAutoSaves).toHaveBeenCalledOnce();
    const sink = (flushAllAutoSaves as unknown as { mock: { calls: unknown[][] } }).mock.calls[0][0];
    expect(typeof sink).toBe('function');
  });
});

describe('editorIoService.saveFile', () => {
  it('is a no-op when the tab is absent', async () => {
    await saveFile('missing');
    expect(setStateMock).not.toHaveBeenCalled();
  });
});

describe('editorIoService.openExternalPaths', () => {
  it('opens a file by its real path (native drag-drop / "Open With" routing)', async () => {
    const { externalFileProvider } = await import('@/services/externalFileProvider');
    (externalFileProvider.readFile as ReturnType<typeof vi.fn>).mockResolvedValue('# hi');
    const n = await openExternalPaths(['/Users/x/note.md']);
    expect(n).toBe(1);
    expect(externalFileProvider.readFile).toHaveBeenCalledWith('/Users/x/note.md');
  });

  it('registers a FOLDER as an external folder instead of a tab', async () => {
    const { stat } = await import('@tauri-apps/plugin-fs');
    (stat as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ isDirectory: true, isFile: false, isSymlink: false });
    addFolderMock.mockResolvedValueOnce(true);
    const n = await openExternalPaths(['/Users/x/proj']);
    expect(n).toBe(1);
    expect(addFolderMock).toHaveBeenCalledWith('/Users/x/proj');
    const { externalFileProvider } = await import('@/services/externalFileProvider');
    expect(externalFileProvider.readFile).not.toHaveBeenCalled();
    expect(toastPushes).toEqual([]);
  });

  it('duplicate folder failure → folderAlreadyAdded toast, never silent', async () => {
    const { stat } = await import('@tauri-apps/plugin-fs');
    (stat as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ isDirectory: true, isFile: false, isSymlink: false });
    foldersList.push({ path: '/Users/x/proj' });
    const n = await openExternalPaths(['/Users/x/proj']);
    expect(n).toBe(0);
    expect(toastPushes).toEqual(['editor:filePaste.folderAlreadyAdded']);
  });

  it('non-duplicate folder failure (outside $HOME) → folderOutsideHome toast', async () => {
    const { stat } = await import('@tauri-apps/plugin-fs');
    (stat as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ isDirectory: true, isFile: false, isSymlink: false });
    const n = await openExternalPaths(['/etc/perm']);
    expect(n).toBe(0);
    expect(toastPushes).toEqual(['editor:filePaste.folderOutsideHome']);
  });

  it('routes a mixed list: folders → addFolder, files → tabs (order preserved)', async () => {
    const { externalFileProvider } = await import('@/services/externalFileProvider');
    (externalFileProvider.readFile as ReturnType<typeof vi.fn>).mockResolvedValue('# m');
    const { stat } = await import('@tauri-apps/plugin-fs');
    (stat as ReturnType<typeof vi.fn>).mockImplementation(async (p: string) =>
      p === '/Users/x/proj' ? { isDirectory: true, isFile: false, isSymlink: false } : { isDirectory: false, isFile: true, isSymlink: false });
    addFolderMock.mockResolvedValueOnce(true);
    const n = await openExternalPaths(['/Users/x/proj', '/Users/x/note.md']);
    expect(n).toBe(2);
    expect(addFolderMock).toHaveBeenCalledWith('/Users/x/proj');
    expect(externalFileProvider.readFile).toHaveBeenCalledWith('/Users/x/note.md');
  });
});

describe('editorIoService.openExternalFile', () => {
  it('routes a mixed pick: folders → addFolder, files → tabs', async () => {
    const { externalFileProvider } = await import('@/services/externalFileProvider');
    (externalFileProvider.readFile as ReturnType<typeof vi.fn>).mockResolvedValue('# ext');
    // vi.clearAllMocks() does NOT restore mockReturnValue — a prior test in
    // this file sets getHandlerById to undefined; re-stub it here.
    const { getHandlerById } = await import('@/components/file-types/registry');
    (getHandlerById as ReturnType<typeof vi.fn>).mockReturnValue({ id: 'markdown', needsFileContent: true, deserialize: (r: string) => r, serialize: (c: string) => c });
    invokeMock.mockResolvedValue(['/Users/x/proj', '/Users/x/note.md']);
    const { stat } = await import('@tauri-apps/plugin-fs');
    (stat as ReturnType<typeof vi.fn>).mockImplementation(async (p: string) =>
      p === '/Users/x/proj' ? { isDirectory: true, isFile: false, isSymlink: false } : { isDirectory: false, isFile: true, isSymlink: false });
    addFolderMock.mockResolvedValueOnce(true);

    const n = await openExternalFile();

    expect(invokeMock).toHaveBeenCalledWith('pick_external_paths');
    expect(n).toBe(2);
    expect(addFolderMock).toHaveBeenCalledWith('/Users/x/proj');
    expect(externalFileProvider.readFile).toHaveBeenCalledWith('/Users/x/note.md');
  });

  it('cancelled dialog (null) returns 0 without touching anything', async () => {
    invokeMock.mockResolvedValue(null);
    const n = await openExternalFile();
    expect(n).toBe(0);
    expect(addFolderMock).not.toHaveBeenCalled();
  });

  it('falls back to the files-only plugin dialog when the command is unsupported', async () => {
    invokeMock.mockRejectedValue(new Error('unknown command'));
    const { externalFileProvider } = await import('@/services/externalFileProvider');
    (externalFileProvider.readFile as ReturnType<typeof vi.fn>).mockResolvedValue('# f');
    const { getHandlerById } = await import('@/components/file-types/registry');
    (getHandlerById as ReturnType<typeof vi.fn>).mockReturnValue({ id: 'markdown', needsFileContent: true, deserialize: (r: string) => r, serialize: (c: string) => c });
    const dialogOpenMock = vi.fn(async () => ['/Users/x/a.md', '/Users/x/b.md']);
    vi.doMock('@tauri-apps/plugin-dialog', () => ({ open: dialogOpenMock }));
    try {
      const n = await openExternalFile();
      expect(n).toBe(2);
      expect(dialogOpenMock).toHaveBeenCalled();
      expect(externalFileProvider.readFile).toHaveBeenCalledWith('/Users/x/a.md');
      expect(externalFileProvider.readFile).toHaveBeenCalledWith('/Users/x/b.md');
    } finally {
      vi.doUnmock('@tauri-apps/plugin-dialog');
    }
  });
});

describe('editorIoService dirty empty note', () => {
  it('does not reload disk content after the user intentionally clears an open note', async () => {
    editorState.tabs = [{ id: 'v1:empty.md', name: 'empty.md', path: 'empty.md', content: '', isDirty: true, fileType: 'markdown', activity: 'files' }];
    editorState.activeTabId = 'v1:empty.md';
    const readText = vi.fn(async () => 'old disk text');
    // Earlier tests may spy the vault getter; restore the actual module mock.
    const { useVaultStore } = await import('@/store/vaultStore');
    vi.spyOn(useVaultStore, 'getState').mockReturnValue({ activeVaultId: 'v1', isLoading: false } as never);
    await openFile('empty.md', 'empty.md', { expectedVaultId: 'v1', readText });
    expect(readText).not.toHaveBeenCalled();
    expect(editorState.tabs[0].content).toBe('');
    expect(editorState.tabs[0].isDirty).toBe(true);
  });
});
