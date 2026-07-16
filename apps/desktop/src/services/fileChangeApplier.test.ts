import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { FileChange } from '@quill/cli-adapter';

// ── Mocks for the editor-layer dependencies ─────────────────────────────────
const { editorState, diffReviewState, getHandlerByIdMock } = vi.hoisted(() => ({
  editorState: {
    tabs: [] as Array<{ id: string; fileType: string }>,
    updateTabContent: vi.fn(),
  },
  diffReviewState: {
    enterDiffReview: vi.fn(),
    setContentExternal: vi.fn(),
  },
  getHandlerByIdMock: vi.fn(),
}));

vi.mock('@/store/vaultStore', () => ({
  useVaultStore: { getState: () => ({ activeVaultId: 'vault-1' }) },
}));
vi.mock('@/store/editorStore', () => ({
  useEditorStore: { getState: () => editorState },
}));
vi.mock('@/store/diffReviewStore', () => ({
  useDiffReviewStore: { getState: () => diffReviewState },
}));

vi.mock('@/components/file-types/registry', () => ({ getHandlerById: getHandlerByIdMock }));

// ── aiStore injection slot — drive registration through the real setter ────
// We mock only the persistence/watcher surface so aiStore loads for real,
// letting setFileChangeApplier / getFileChangeApplier round-trip.
vi.mock('@/utils/fileWatcher', () => ({
  suppressWatcherFor: vi.fn(),
  startVaultWatcher: vi.fn(),
  stopVaultWatcher: vi.fn(),
  pauseWatcher: vi.fn(),
  resumeWatcher: vi.fn(),
}));
vi.mock('@/store/aiSessionPersistence', () => ({
  persistAiState: vi.fn(),
  saveAllSessions: vi.fn(),
  loadSessionsFromDisk: vi.fn(),
  setSuppressPersist: vi.fn(),
  setupPersistSubscription: vi.fn(),
  debouncedPersist: vi.fn(),
}));
vi.mock('@/store/aiFileChangeActions', () => ({
  applyAcceptChange: vi.fn(),
  applyRejectChange: vi.fn(),
}));

import { EditorFileChangeApplier, registerEditorFileChangeApplier } from './fileChangeApplier';
import { getFileChangeApplier, setFileChangeApplier } from '@/store/aiStore';

function change(overrides: Partial<FileChange> = {}): FileChange {
  return {
    path: 'notes/a.md',
    oldContent: 'old',
    newContent: 'new',
    status: 'pending',
    createdAt: 1,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  editorState.tabs = [];
  getHandlerByIdMock.mockReset();
  setFileChangeApplier(null);
});

describe('EditorFileChangeApplier routing', () => {
  it('routes useCodeMirror files to diffReviewStore.enterDiffReview', () => {
    editorState.tabs = [{ id: 'vault-1:notes/a.md', fileType: 'markdown' }];
    getHandlerByIdMock.mockReturnValue({ id: 'markdown', useCodeMirror: true });
    new EditorFileChangeApplier().apply(change());

    expect(diffReviewState.enterDiffReview).toHaveBeenCalledWith('notes/a.md', 'old', 'new');
    expect(editorState.updateTabContent).not.toHaveBeenCalled();
    expect(diffReviewState.setContentExternal).not.toHaveBeenCalled();
  });

  it('routes non-useCodeMirror files to editorStore.updateTabContent only (NOT setContentExternal)', () => {
    editorState.tabs = [{ id: 'vault-1:diagrams/x.drawio', fileType: 'drawio' }];
    getHandlerByIdMock.mockReturnValue({ id: 'drawio', useCodeMirror: false });
    new EditorFileChangeApplier().apply(change({ path: 'diagrams/x.drawio' }));

    expect(editorState.updateTabContent).toHaveBeenCalledWith('vault-1:diagrams/x.drawio', 'new');
    // The PRD prose listed setContentExternal here, but the old aiStore branch
    // intentionally omits it (iframe remount). Zero-regression = no call.
    expect(diffReviewState.setContentExternal).not.toHaveBeenCalled();
    expect(diffReviewState.enterDiffReview).not.toHaveBeenCalled();
  });

  it('treats a handler without useCodeMirror as the non-CodeMirror branch', () => {
    editorState.tabs = [{ id: 'vault-1:p.webm', fileType: 'web' }];
    getHandlerByIdMock.mockReturnValue({ id: 'web' }); // no useCodeMirror
    new EditorFileChangeApplier().apply(change({ path: 'p.webm' }));

    expect(editorState.updateTabContent).toHaveBeenCalledWith('vault-1:p.webm', 'new');
    expect(diffReviewState.enterDiffReview).not.toHaveBeenCalled();
  });

  it('is a no-op when the tab is not open', () => {
    editorState.tabs = [{ id: 'vault-1:other.md', fileType: 'markdown' }];
    getHandlerByIdMock.mockReturnValue({ useCodeMirror: true });
    new EditorFileChangeApplier().apply(change({ path: 'notes/absent.md' }));

    expect(diffReviewState.enterDiffReview).not.toHaveBeenCalled();
    expect(editorState.updateTabContent).not.toHaveBeenCalled();
  });

  it('is a no-op for a non-pending change', () => {
    editorState.tabs = [{ id: 'vault-1:notes/a.md', fileType: 'markdown' }];
    getHandlerByIdMock.mockReturnValue({ useCodeMirror: true });
    new EditorFileChangeApplier().apply(change({ status: 'accepted' }));

    expect(diffReviewState.enterDiffReview).not.toHaveBeenCalled();
    expect(editorState.updateTabContent).not.toHaveBeenCalled();
  });

  it('parses the tabId as `${vaultId}:${path}` (vault id leak from aiStore removed)', () => {
    editorState.tabs = [{ id: 'vault-1:notes/a.md', fileType: 'markdown' }];
    getHandlerByIdMock.mockReturnValue({ useCodeMirror: true });
    new EditorFileChangeApplier().apply(change());
    // The first call arg tuple is (path, oldContent, newContent); tabId format
    // lived in aiStore before — it now lives here. Asserting enterDiffReview
    // fires confirms the tabId resolution matched the open tab.
    expect(diffReviewState.enterDiffReview).toHaveBeenCalledTimes(1);
  });
});

describe('registerEditorFileChangeApplier', () => {
  it('registers an EditorFileChangeApplier in the aiStore slot', () => {
    expect(getFileChangeApplier()).toBeNull();
    registerEditorFileChangeApplier();
    const registered = getFileChangeApplier();
    expect(registered).toBeInstanceOf(EditorFileChangeApplier);
  });
});
