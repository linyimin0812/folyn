import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { FileChange } from '@folyn/cli-adapter';
import type { AiSession } from './aiStore';

// ── Mocks ───────────────────────────────────────────────────────────────────
// aiFileChangeActions depends (editor slice) on the injected FileChangeApplier
// (read via getFileChangeApplier from aiStore), and (orchestration) on
// useVaultStore + resolveBasePath + writeTextFile. We stub each so the real
// module runs and we can assert the delegation + orchestration wiring.

const { applierMock, vaultState } = vi.hoisted(() => ({
  applierMock: {
    acceptEditorChange: vi.fn(),
    revertEditorTab: vi.fn(),
  },
  vaultState: {
    activeVaultId: 'vault-1',
    currentVault: { basePath: '/vault/root' },
  },
}));

vi.mock('./aiStore', () => ({
  getFileChangeApplier: () => applierMock,
}));
vi.mock('./vaultStore', () => ({
  useVaultStore: { getState: () => vaultState },
}));
vi.mock('@/utils/pathResolver', () => ({
  // Echo the basePath back so the assertion can pin the joined fullPath.
  resolveBasePath: vi.fn(async (p: string) => p),
}));
vi.mock('@tauri-apps/plugin-fs', () => ({
  writeTextFile: vi.fn(async () => {}),
}));

import { applyAcceptChange, applyRejectChange } from './aiFileChangeActions';
import { writeTextFile } from '@tauri-apps/plugin-fs';
import { resolveBasePath } from '@/utils/pathResolver';

function makeChange(path: string, status: FileChange['status'] = 'pending'): FileChange {
  return { path, oldContent: 'old', newContent: 'new', status, createdAt: 1 };
}

function makeSession(fileChanges: FileChange[]): AiSession {
  return {
    id: 's1',
    title: 't',
    messages: [],
    fileChanges,
    cliSessionId: null,
    isStreaming: false,
    createdAt: 1,
    updatedAt: 1,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('applyAcceptChange', () => {
  it('delegates the editor slice to the injected applier and returns newContent', () => {
    const session = makeSession([makeChange('a.md')]);
    const res = applyAcceptChange(session, 'a.md');

    expect(applierMock.acceptEditorChange).toHaveBeenCalledWith('a.md', 'new');
    expect(res.newContent).toBe('new');
    expect(res.updatedFileChanges[0].status).toBe('accepted');
  });

  it('does NOT call the reject editor method', () => {
    const session = makeSession([makeChange('a.md')]);
    applyAcceptChange(session, 'a.md');
    expect(applierMock.revertEditorTab).not.toHaveBeenCalled();
  });

  it('returns null newContent and no applier call for a missing pending change', () => {
    const session = makeSession([makeChange('a.md', 'accepted')]);
    const res = applyAcceptChange(session, 'absent.md');

    expect(res.newContent).toBeNull();
    expect(applierMock.acceptEditorChange).not.toHaveBeenCalled();
  });
});

describe('applyRejectChange', () => {
  it('writes oldContent to disk (vaultRoot joined with path) and delegates editor revert', async () => {
    const session = makeSession([makeChange('a.md')]);
    await applyRejectChange(session, 'a.md');

    expect(resolveBasePath).toHaveBeenCalledWith('/vault/root');
    expect(writeTextFile).toHaveBeenCalledWith('/vault/root/a.md', 'old');
    expect(applierMock.revertEditorTab).toHaveBeenCalledWith('a.md', 'old');
    expect(applierMock.acceptEditorChange).not.toHaveBeenCalled();
  });

  it('marks the change rejected in the returned fileChanges', async () => {
    const session = makeSession([makeChange('a.md')]);
    const out = await applyRejectChange(session, 'a.md');
    expect(out[0].status).toBe('rejected');
  });

  it('skips disk IO when vaultRoot is empty but still delegates editor revert', async () => {
    vaultState.currentVault = { basePath: '' };
    const session = makeSession([makeChange('a.md')]);
    await applyRejectChange(session, 'a.md');

    expect(writeTextFile).not.toHaveBeenCalled();
    expect(applierMock.revertEditorTab).toHaveBeenCalledWith('a.md', 'old');
    vaultState.currentVault = { basePath: '/vault/root' };
  });

  it('returns the unchanged list when no pending change matches', async () => {
    const session = makeSession([makeChange('a.md', 'accepted')]);
    const out = await applyRejectChange(session, 'absent.md');
    expect(out).toBe(session.fileChanges);
    expect(applierMock.revertEditorTab).not.toHaveBeenCalled();
  });
});
