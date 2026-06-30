import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── Mocks (must be declared before importing the SUT) ──

const fakeAdapter = {
  id: 'claude',
  start: vi.fn(async () => {}),
  send: vi.fn(async () => {}),
  stop: vi.fn(async () => {}),
  isRunning: () => false,
  onEvent: vi.fn(),
  offEvent: vi.fn(),
  // test helper: emit events to registered handlers
  __emit: (e: unknown) => {
    for (const h of fakeAdapter.__handlers) (h as (x: unknown) => void)(e);
  },
  __handlers: [] as Array<(e: unknown) => void>,
};
fakeAdapter.onEvent.mockImplementation((h: (e: unknown) => void) => {
  fakeAdapter.__handlers.push(h);
});
fakeAdapter.offEvent.mockImplementation((h: (e: unknown) => void) => {
  fakeAdapter.__handlers = fakeAdapter.__handlers.filter((x) => x !== h);
});

vi.mock('@/components/ai/adapterManager', () => ({
  getAdapterForSession: () => fakeAdapter,
  sessionAdapters: new Map(),
}));

vi.mock('@/utils/fileWatcher', () => ({
  pauseWatcher: vi.fn(),
  resumeWatcher: vi.fn(),
  suppressWatcherFor: vi.fn(),
}));

vi.mock('./studyAgent', async () => {
  const actual = await vi.importActual<typeof import('./studyAgent')>('./studyAgent');
  return {
    ...actual,
    // keep canonical parser but ensure deterministic agent name
    STUDY_AGENT_NAME: 'study',
    getStudyAgentDefinition: () => ({ study: { prompt: 'BE_STUDY', description: 'd' } }),
  };
});

// Stub persistence so aiStore actions don't touch Tauri FS.
vi.mock('@/store/aiSessionPersistence', () => ({
  persistAiState: vi.fn(),
  saveAllSessions: vi.fn(async () => {}),
  loadSessionsFromDisk: vi.fn(async () => {}),
  setSuppressPersist: vi.fn(),
  setupPersistSubscription: vi.fn(),
  debouncedPersist: vi.fn(),
}));

vi.mock('@/store/aiFileChangeActions', () => ({
  applyAcceptChange: vi.fn(),
  applyRejectChange: vi.fn(),
}));

import { useAiStore } from '@/store/aiStore';
import { useVaultStore } from '@/store/vaultStore';
import { useEditorStore } from '@/store/editorStore';
import { useSettingsStore } from '@/store/settingsStore';
import { runStudyAgent } from './studyAgentRunner';

beforeEach(() => {
  useAiStore.setState({
    sessions: [],
    activeSessionId: null,
    studySessionId: null,
    isStreaming: false,
    chatMode: 'chat',
    pendingFileAttachments: [],
  });
  useVaultStore.setState({ activeVaultId: 'v1', currentVault: { basePath: '/vault' } as never });
  useSettingsStore.setState({ cliPath: 'claude' } as never);
  useEditorStore.setState({
    flushAutoSaves: vi.fn(async () => {}),
    checkDiskChanges: vi.fn(async () => {}),
  } as never);
  fakeAdapter.__handlers = [];
  fakeAdapter.start.mockClear();
  fakeAdapter.send.mockClear();
  vi.clearAllMocks();
});

describe('runStudyAgent (PR9)', () => {
  it('创建 study 会话并以 --agent study + 内联 agents 调 adapter.send', async () => {
    // Make send emit a text event + done so the run resolves.
    fakeAdapter.send.mockImplementation(async () => {
      fakeAdapter.__emit({ type: 'text', content: 'hi' });
      fakeAdapter.__emit({ type: 'done' });
    });

    await runStudyAgent('do research');

    const state = useAiStore.getState();
    expect(state.studySessionId).not.toBeNull();
    const sess = state.sessions.find((s) => s.id === state.studySessionId)!;
    expect(sess.kind).toBe('study');
    // user + assistant messages recorded
    expect(sess.messages.map((m) => m.role)).toEqual(['user', 'assistant']);
    expect(sess.messages[1].content).toBe('hi');
    // send called with agent + agents + the instruction prompt
    expect(fakeAdapter.send).toHaveBeenCalledTimes(1);
    const [, opts] = fakeAdapter.send.mock.calls[0];
    expect(opts.agent).toBe('study');
    expect(opts.agents).toEqual({ study: { prompt: 'BE_STUDY', description: 'd' } });
    // streaming flag cleared on done
    expect(sess.isStreaming).toBe(false);
  });

  it('复用同一 study 会话并传 resumeSessionId（多轮）', async () => {
    fakeAdapter.send.mockImplementation(async () => {
      // first run: CLI reports a session id
      fakeAdapter.__emit({ type: 'session_id', sessionId: 'cli-42' });
      fakeAdapter.__emit({ type: 'done' });
    });
    await runStudyAgent('turn 1');
    const firstOpts = fakeAdapter.send.mock.calls[0][1];
    expect(firstOpts.resumeSessionId).toBeUndefined();

    // second run should resume cli-42
    fakeAdapter.send.mockClear();
    fakeAdapter.send.mockImplementation(async () => {
      fakeAdapter.__emit({ type: 'done' });
    });
    await runStudyAgent('turn 2');
    const secondOpts = fakeAdapter.send.mock.calls[0][1];
    expect(secondOpts.resumeSessionId).toBe('cli-42');
    // still one study session
    const studySessions = useAiStore.getState().sessions.filter((s) => s.kind === 'study');
    expect(studySessions).toHaveLength(1);
  });

  it('file_change 事件写入 study 会话（接上 diff 链路）', async () => {
    fakeAdapter.send.mockImplementation(async () => {
      fakeAdapter.__emit({
        type: 'file_change',
        fileChange: { path: '学习/x.md', oldContent: 'a', newContent: 'b', status: 'pending', createdAt: 1 },
      });
      fakeAdapter.__emit({ type: 'done' });
    });
    await runStudyAgent('edit notes');
    const sess = useAiStore.getState().sessions.find((s) => s.kind === 'study')!;
    expect(sess.fileChanges).toHaveLength(1);
    expect(sess.fileChanges[0].path).toBe('学习/x.md');
  });

  it('send 抛错时写入错误并清 streaming', async () => {
    fakeAdapter.send.mockRejectedValueOnce(new Error('boom'));
    await runStudyAgent('explode');
    const sess = useAiStore.getState().sessions.find((s) => s.kind === 'study')!;
    expect(sess.isStreaming).toBe(false);
    expect(sess.messages[1].content).toContain('[错误]');
  });
});
