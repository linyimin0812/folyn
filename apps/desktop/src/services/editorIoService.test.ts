import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock the editor-layer dependencies the service routes through. The service
// reads/writes editorStore via getState/setState and chains out to vaultStore,
// watcher, wikiProvider, persistence — stub them all so we can assert routing
// without touching real Tauri FS / wiki ingestion.

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
vi.mock('@/store/prefsStore', () => ({ usePrefsStore: { getState: () => ({ dailyNotesDir: '__daily__', dailyNoteDateFormat: 'YYYY-MM-DD' }) } }));
vi.mock('@/components/file-types/registry', () => ({ getHandlerById: vi.fn(() => ({ id: 'markdown', needsFileContent: true, deserialize: (r: string) => r, serialize: (c: string) => c })) }));
vi.mock('@/utils/fileWatcher', () => ({ suppressWatcherFor: vi.fn() }));
vi.mock('@/services/wikiProvider', () => ({ wikiProvider: { readFile: vi.fn(), writeFile: vi.fn() } }));
vi.mock('@/types/wiki', () => ({ WIKI_PREFIX: 'wiki://' }));
vi.mock('@/store/editorAutoSave', () => ({ scheduleAutoSave: vi.fn(), flushAllAutoSaves: vi.fn() }));
vi.mock('@/store/editorPersistence', () => ({ persistOpenTabs: vi.fn(), flushPersistOpenTabs: vi.fn(), loadPersistedOpenTabs: vi.fn(async () => null), persistExternalOpenTabs: vi.fn(), flushPersistExternalOpenTabs: vi.fn(), loadExternalOpenTabs: vi.fn(async () => null) }));
vi.mock('@/utils/platform', () => ({ isTauri: () => true }));
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
  openDailyNote,
  saveFile,
  saveOpenTabs,
  restoreOpenTabs,
  checkDiskChanges,
  flushAutoSaves,
  openDroppedFiles,
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
});

describe('editorIoService — signatures exist', () => {
  it('exports the 7 IO functions', () => {
    expect(typeof openFile).toBe('function');
    expect(typeof openDailyNote).toBe('function');
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
    // suppression, wiki ingestion, persistence round-trip) can't be exercised
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

describe('editorIoService.openDroppedFiles', () => {
  it('opens a macOS file by its real path (no staging write)', async () => {
    const { externalFileProvider } = await import('@/services/externalFileProvider');
    (externalFileProvider.readFile as ReturnType<typeof vi.fn>).mockResolvedValue('# hi');
    const f = new File(['# hi'], 'note.md', { type: 'text/markdown' });
    // WebKit exposes .path on the dropped File (non-standard). Simulate it.
    Object.defineProperty(f, 'path', { value: '/Users/x/note.md' });
    const n = await openDroppedFiles([f]);
    expect(n).toBe(1);
    expect(externalFileProvider.readFile).toHaveBeenCalledWith('/Users/x/note.md');
    expect(externalFileProvider.writeFile).not.toHaveBeenCalled();
  });

  it('stages a Windows file (no path) into ~/.folyn/drops then opens it', async () => {
    const { externalFileProvider } = await import('@/services/externalFileProvider');
    (externalFileProvider.readFile as ReturnType<typeof vi.fn>).mockResolvedValue('# win');
    (externalFileProvider.writeFileBytes as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    // jsdom File lacks arrayBuffer(); use a plain object shaped like a dropped
    // File (name + arrayBuffer()) — the real WebView2 File has both.
    const enc = new TextEncoder().encode('# win');
    const f = { name: 'win.md', arrayBuffer: async () => enc.buffer } as unknown as File;
    const n = await openDroppedFiles([f]);
    expect(n).toBe(1);
    const writeCall = (externalFileProvider.writeFileBytes as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(writeCall[0]).toBe('~/.folyn/drops/win.md');
    expect(Array.from(writeCall[1] as Uint8Array)).toEqual(Array.from(enc));
    expect(externalFileProvider.readFile).toHaveBeenCalledWith('~/.folyn/drops/win.md');
  });

  it('skips file types Folyn has no handler for', async () => {
    const { getHandlerById } = await import('@/components/file-types/registry');
    (getHandlerById as ReturnType<typeof vi.fn>).mockReturnValue(undefined);
    const f = { name: 'pic.png' } as unknown as File;
    const n = await openDroppedFiles([f]);
    expect(n).toBe(0);
  });
});
