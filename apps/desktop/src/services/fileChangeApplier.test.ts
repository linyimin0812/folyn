import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { FileChange } from '@mochi/cli-adapter';

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

import {
  EditorFileChangeApplier,
  registerEditorFileChangeApplier,
} from './fileChangeApplier';
import {
  getFileChangeApplier,
  setFileChangeApplier,
  useAiStore,
} from '@/store/aiStore';

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

  it('routes non-useCodeMirror files to diffReviewStore.setContentExternal (version bump + updateTabContent)', () => {
    editorState.tabs = [{ id: 'vault-1:diagrams/x.drawio', fileType: 'drawio' }];
    getHandlerByIdMock.mockReturnValue({ id: 'drawio', useCodeMirror: false });
    new EditorFileChangeApplier().apply(change({ path: 'diagrams/x.drawio' }));

    expect(diffReviewState.setContentExternal).toHaveBeenCalledWith('vault-1:diagrams/x.drawio', 'new');
    // setContentExternal (real impl) delegates to updateTabContent; the mock
    // doesn't simulate that, so we assert only the routing entrypoint here.
    // No diff-review banner for custom editors.
    expect(diffReviewState.enterDiffReview).not.toHaveBeenCalled();
  });

  it('treats a handler without useCodeMirror as the non-CodeMirror branch', () => {
    editorState.tabs = [{ id: 'vault-1:p.webm', fileType: 'web' }];
    getHandlerByIdMock.mockReturnValue({ id: 'web' }); // no useCodeMirror
    new EditorFileChangeApplier().apply(change({ path: 'p.webm' }));

    expect(diffReviewState.setContentExternal).toHaveBeenCalledWith('vault-1:p.webm', 'new');
    expect(diffReviewState.enterDiffReview).not.toHaveBeenCalled();
  });

  it('is a no-op when the tab is not open', () => {
    editorState.tabs = [{ id: 'vault-1:other.md', fileType: 'markdown' }];
    getHandlerByIdMock.mockReturnValue({ useCodeMirror: true });
    new EditorFileChangeApplier().apply(change({ path: 'notes/absent.md' }));

    expect(diffReviewState.enterDiffReview).not.toHaveBeenCalled();
    expect(diffReviewState.setContentExternal).not.toHaveBeenCalled();
  });

  it('is a no-op for a non-pending change', () => {
    editorState.tabs = [{ id: 'vault-1:notes/a.md', fileType: 'markdown' }];
    getHandlerByIdMock.mockReturnValue({ useCodeMirror: true });
    new EditorFileChangeApplier().apply(change({ status: 'accepted' }));

    expect(diffReviewState.enterDiffReview).not.toHaveBeenCalled();
    expect(diffReviewState.setContentExternal).not.toHaveBeenCalled();
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

describe('EditorFileChangeApplier.acceptEditorChange', () => {
  it('calls diffReviewStore.setContentExternal(tabId, newContent) when the tab is open', () => {
    editorState.tabs = [{ id: 'vault-1:notes/a.md', fileType: 'markdown' }];
    new EditorFileChangeApplier().acceptEditorChange('notes/a.md', 'new');

    expect(diffReviewState.setContentExternal).toHaveBeenCalledWith('vault-1:notes/a.md', 'new');
    expect(editorState.updateTabContent).not.toHaveBeenCalled();
    expect(diffReviewState.enterDiffReview).not.toHaveBeenCalled();
  });

  it('is a no-op when the tab is not open', () => {
    editorState.tabs = [{ id: 'vault-1:other.md', fileType: 'markdown' }];
    new EditorFileChangeApplier().acceptEditorChange('notes/absent.md', 'new');

    expect(diffReviewState.setContentExternal).not.toHaveBeenCalled();
    expect(editorState.updateTabContent).not.toHaveBeenCalled();
  });

  it('resolves the tabId as `${vaultId}:${path}`', () => {
    editorState.tabs = [{ id: 'vault-1:deep/path.md', fileType: 'markdown' }];
    new EditorFileChangeApplier().acceptEditorChange('deep/path.md', 'X');

    expect(diffReviewState.setContentExternal).toHaveBeenCalledWith('vault-1:deep/path.md', 'X');
  });
});

describe('EditorFileChangeApplier.revertEditorTab', () => {
  it('calls editorStore.updateTabContent(tabId, oldContent) when the tab is open', () => {
    editorState.tabs = [{ id: 'vault-1:notes/a.md', fileType: 'markdown' }];
    new EditorFileChangeApplier().revertEditorTab('notes/a.md', 'old');

    expect(editorState.updateTabContent).toHaveBeenCalledWith('vault-1:notes/a.md', 'old');
    expect(diffReviewState.setContentExternal).not.toHaveBeenCalled();
    expect(diffReviewState.enterDiffReview).not.toHaveBeenCalled();
  });

  it('is a no-op when the tab is not open', () => {
    editorState.tabs = [{ id: 'vault-1:other.md', fileType: 'markdown' }];
    new EditorFileChangeApplier().revertEditorTab('notes/absent.md', 'old');

    expect(editorState.updateTabContent).not.toHaveBeenCalled();
    expect(diffReviewState.setContentExternal).not.toHaveBeenCalled();
  });

  it('resolves the tabId as `${vaultId}:${path}`', () => {
    editorState.tabs = [{ id: 'vault-1:deep/path.md', fileType: 'markdown' }];
    new EditorFileChangeApplier().revertEditorTab('deep/path.md', 'old');

    expect(editorState.updateTabContent).toHaveBeenCalledWith('vault-1:deep/path.md', 'old');
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

// ── End-to-end: aiStore.addFileChange → injected applier → editor/diff store ─
// Upgrades the routing tests above from calling applier.apply() directly to
// driving the full aiStore.addFileChange path. Asserts the same routing
// contract plus the no-op-when-unregistered guard, and that the change is
// still recorded on the session either way.
describe('aiStore.addFileChange end-to-end (via registered applier)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    editorState.tabs = [];
    getHandlerByIdMock.mockReset();
    // Seed an active session through the real store; addFileChange targets it.
    useAiStore.setState({ sessions: [], activeSessionId: null });
    useAiStore.getState().createSession();
    registerEditorFileChangeApplier();
  });

  it('routes a useCodeMirror file change to diffReviewStore.enterDiffReview (NOT updateTabContent)', () => {
    editorState.tabs = [{ id: 'vault-1:notes/a.md', fileType: 'markdown' }];
    getHandlerByIdMock.mockReturnValue({ id: 'markdown', useCodeMirror: true });

    useAiStore.getState().addFileChange(change());

    expect(diffReviewState.enterDiffReview).toHaveBeenCalledWith('notes/a.md', 'old', 'new');
    expect(editorState.updateTabContent).not.toHaveBeenCalled();
    expect(diffReviewState.setContentExternal).not.toHaveBeenCalled();
    // Change is still recorded on the session.
    const session = useAiStore.getState().getActiveSession();
    expect(session?.fileChanges).toHaveLength(1);
    expect(session?.fileChanges[0].path).toBe('notes/a.md');
  });

  it('routes a non-useCodeMirror file change to diffReviewStore.setContentExternal (version bump + updateTabContent)', () => {
    editorState.tabs = [{ id: 'vault-1:diagrams/x.drawio', fileType: 'drawio' }];
    getHandlerByIdMock.mockReturnValue({ id: 'drawio', useCodeMirror: false });

    useAiStore.getState().addFileChange(change({ path: 'diagrams/x.drawio' }));

    expect(diffReviewState.setContentExternal).toHaveBeenCalledWith('vault-1:diagrams/x.drawio', 'new');
    // setContentExternal (real impl) delegates tab mutation to updateTabContent;
    // the mock doesn't simulate that, so we only assert the routing entrypoint.
    // No diff-review banner for custom editors.
    expect(diffReviewState.enterDiffReview).not.toHaveBeenCalled();
  });

  it('is a no-op on the editor/diff side when no applier is registered (change still recorded)', () => {
    setFileChangeApplier(null);
    editorState.tabs = [{ id: 'vault-1:notes/a.md', fileType: 'markdown' }];
    getHandlerByIdMock.mockReturnValue({ id: 'markdown', useCodeMirror: true });

    useAiStore.getState().addFileChange(change());

    expect(diffReviewState.enterDiffReview).not.toHaveBeenCalled();
    expect(editorState.updateTabContent).not.toHaveBeenCalled();
    // Defensive against init ordering — the change is recorded, nothing throws.
    const session = useAiStore.getState().getActiveSession();
    expect(session?.fileChanges).toHaveLength(1);
  });
});
