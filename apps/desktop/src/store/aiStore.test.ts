import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useAiStore, type AiSession } from './aiStore';
import { useAiConfigStore } from './aiConfigStore';
import { useVaultStore } from './vaultStore';
import type { FileChange } from '@quill/cli-adapter';

// Stub persistence so store actions don't touch the Tauri FS session store.
vi.mock('./aiSessionPersistence', () => ({
  persistAiState: vi.fn(),
  saveAllSessions: vi.fn(async () => {}),
  loadSessionsFromDisk: vi.fn(async () => {}),
  setSuppressPersist: vi.fn(),
  setupPersistSubscription: vi.fn(),
  debouncedPersist: vi.fn(),
}));

// Stub file watcher suppression (called from addFileChange).
vi.mock('@/utils/fileWatcher', () => ({
  suppressWatcherFor: vi.fn(),
  startVaultWatcher: vi.fn(async () => {}),
  stopVaultWatcher: vi.fn(async () => {}),
  pauseWatcher: vi.fn(),
  resumeWatcher: vi.fn(),
}));

// Stub file-change appliers so we can assert the store wires their results.
vi.mock('./aiFileChangeActions', () => ({
  applyAcceptChange: vi.fn(),
  applyRejectChange: vi.fn(),
}));

// Stub on-disk provider config writes — setSessionPair calls setChatProvider
// which fire-and-forgets a providerConfigStorage write that would otherwise
// hit Tauri's homeDir() (ReferenceError in node test env).
vi.mock('@/services/providers/providerConfigStorage', () => ({
  providerConfigStorage: {
    setCustomerProvider: vi.fn(async () => {}),
    setProviderSettings: vi.fn(async () => {}),
    removeCustomerProvider: vi.fn(async () => {}),
    removeProviderSettings: vi.fn(async () => {}),
    getCustomerProviders: vi.fn(async () => ({})),
    getProviderSettings: vi.fn(async () => ({})),
    patchProviderSettings: vi.fn(async () => {}),
  },
}));

import { applyAcceptChange, applyRejectChange } from './aiFileChangeActions';

function makeFileChange(path: string): FileChange {
  return { path, oldContent: 'old', newContent: 'new', status: 'pending', createdAt: Date.now() };
}

function seedSession(overrides: Partial<AiSession> = {}): AiSession {
  const base: AiSession = {
    id: 's1',
    title: '新会话',
    messages: [],
    fileChanges: [],
    cliSessionId: null,
    isStreaming: false,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
  useAiStore.setState({ sessions: [base], activeSessionId: base.id });
  return base;
}

beforeEach(() => {
  useAiStore.setState({ sessions: [], activeSessionId: null, studySessionId: null, inputMode: 'agent', pendingFileAttachments: [] });
  useVaultStore.setState({ activeVaultId: null, currentVault: null } as never);
  vi.clearAllMocks();
});

describe('useAiStore.createSession / switchSession / getActiveSession', () => {
  it('creates a session, makes it active, and returns its id', () => {
    const id = useAiStore.getState().createSession();
    const sessions = useAiStore.getState().sessions;
    expect(sessions).toHaveLength(1);
    expect(sessions[0].id).toBe(id);
    expect(useAiStore.getState().activeSessionId).toBe(id);
    expect(useAiStore.getState().getActiveSession()?.id).toBe(id);
  });

  it('switchSession changes the active session', () => {
    useAiStore.setState({
      sessions: [
        { id: 'a', title: 'a', messages: [], fileChanges: [], cliSessionId: null, isStreaming: false, createdAt: 1, updatedAt: 1 },
        { id: 'b', title: 'b', messages: [], fileChanges: [], cliSessionId: null, isStreaming: false, createdAt: 2, updatedAt: 2 },
      ],
      activeSessionId: 'a',
    });
    useAiStore.getState().switchSession('b');
    expect(useAiStore.getState().activeSessionId).toBe('b');
  });

  it('getActiveSession returns undefined when none is active', () => {
    expect(useAiStore.getState().getActiveSession()).toBeUndefined();
  });
});

describe('useAiStore.deleteSession', () => {
  it('removes the session and falls back to the first remaining one', () => {
    useAiStore.setState({
      sessions: [
        { id: 'a', title: 'a', messages: [], fileChanges: [], cliSessionId: null, isStreaming: false, createdAt: 1, updatedAt: 1 },
        { id: 'b', title: 'b', messages: [], fileChanges: [], cliSessionId: null, isStreaming: false, createdAt: 2, updatedAt: 2 },
      ],
      activeSessionId: 'a',
    });
    useAiStore.getState().deleteSession('a');
    const s = useAiStore.getState();
    expect(s.sessions.map((x) => x.id)).toEqual(['b']);
    expect(s.activeSessionId).toBe('b');
  });

  it('clears activeSessionId when deleting the last session', () => {
    seedSession();
    useAiStore.getState().deleteSession('s1');
    expect(useAiStore.getState().sessions).toEqual([]);
    expect(useAiStore.getState().activeSessionId).toBeNull();
  });

  it('refuses to delete a streaming session', () => {
    seedSession({ isStreaming: true });
    useAiStore.getState().deleteSession('s1');
    expect(useAiStore.getState().sessions).toHaveLength(1);
  });
});

describe('useAiStore message actions', () => {
  it('addMessage appends a message and derives the title from the first user message', () => {
    seedSession();
    useAiStore.getState().addMessage('user', 'How do I center a div?');
    const s = useAiStore.getState().getActiveSession()!;
    expect(s.messages).toHaveLength(1);
    expect(s.messages[0].role).toBe('user');
    expect(s.title).toBe('How do I center a di');
  });

  it('addMessage is a no-op without an active session', () => {
    useAiStore.getState().addMessage('user', 'x');
    expect(useAiStore.getState().sessions).toEqual([]);
  });

  it('addMessage forwards attachments onto the message', () => {
    seedSession();
    useAiStore.getState().addMessage('user', 'see this', undefined, [{ name: 'f', path: 'p', type: 'file' }]);
    const msg = useAiStore.getState().getActiveSession()!.messages[0];
    expect(msg.attachments).toHaveLength(1);
  });

  it('setUserMessageAttachments patches the most recent user message with real paths', () => {
    seedSession();
    const sid = useAiStore.getState().getActiveSession()!.id;
    useAiStore.getState().addMessage('user', 'see this', sid, [
      { name: 'pic.png', path: '', type: 'image', previewUrl: 'blob:dead' },
    ]);
    useAiStore.getState().addMessage('assistant', 'ok', sid);
    // AiPanel calls this after saveBlobs so the persisted message carries the
    // on-disk path (blob preview URLs die with the page).
    useAiStore.getState().setUserMessageAttachments(sid, [
      { name: 'pic.png', path: '/work/.quill-tmp/pic.png', type: 'image' },
    ]);
    const session = useAiStore.getState().getActiveSession()!;
    const userMsgs = session.messages.filter((m) => m.role === 'user');
    expect(userMsgs[userMsgs.length - 1].attachments).toEqual([
      { name: 'pic.png', path: '/work/.quill-tmp/pic.png', type: 'image' },
    ]);
  });

  // PR4 of the chatModel refactor: addMessage tags assistant messages with
  // the (provider, model) pair at creation time. The tag survives subsequent
  // appendToLastMessage/appendThinking/addToolCall/completeToolCall calls
  // because those spread `...last` — verified by the streaming-tag test below.
  it('addMessage tags an assistant message with provider+model when passed', () => {
    seedSession();
    useAiStore.getState().addMessage('assistant', 'hi', undefined, undefined, 'openai', 'gpt-4o');
    const msg = useAiStore.getState().getActiveSession()!.messages[0];
    expect(msg.provider).toBe('openai');
    expect(msg.model).toBe('gpt-4o');
  });

  it('addMessage leaves provider/model undefined when no pair is passed (legacy path)', () => {
    seedSession();
    useAiStore.getState().addMessage('assistant', 'hi');
    const msg = useAiStore.getState().getActiveSession()!.messages[0];
    expect(msg.provider).toBeUndefined();
    expect(msg.model).toBeUndefined();
  });

  it('addMessage tags a message with mode when passed (persists across restart)', () => {
    seedSession();
    useAiStore.getState().addMessage('user', 'in agent mode', undefined, undefined, undefined, undefined, 'agent');
    const msg = useAiStore.getState().getActiveSession()!.messages[0];
    expect(msg.mode).toBe('agent');
  });

  it('appendToLastMessage preserves the provider/model tag on the last message', () => {
    seedSession();
    useAiStore.getState().addMessage('assistant', 'Hello', undefined, undefined, 'anthropic', 'claude-sonnet-4-6');
    useAiStore.getState().appendToLastMessage(' world');
    const msg = useAiStore.getState().getActiveSession()!.messages[0];
    expect(msg.content).toBe('Hello world');
    expect(msg.provider).toBe('anthropic');
    expect(msg.model).toBe('claude-sonnet-4-6');
  });

  it('appendToLastMessage concatenates onto the last message content', () => {
    seedSession();
    useAiStore.getState().addMessage('assistant', 'Hello');
    useAiStore.getState().appendToLastMessage(' world');
    expect(useAiStore.getState().getActiveSession()!.messages[0].content).toBe('Hello world');
  });

  it('appendThinking concatenates onto the last message thinking field', () => {
    seedSession();
    useAiStore.getState().addMessage('assistant', 'x');
    useAiStore.getState().appendThinking('reasoning');
    expect(useAiStore.getState().getActiveSession()!.messages[0].thinking).toBe('reasoning');
  });

  it('addToolCall / completeToolCall track a tool call lifecycle', () => {
    seedSession();
    useAiStore.getState().addMessage('assistant', 'running');
    useAiStore.getState().addToolCall('tc1', 'search', { q: 'x' });
    const tc = useAiStore.getState().getActiveSession()!.messages[0].toolCalls![0];
    expect(tc.status).toBe('running');
    expect(tc.name).toBe('search');

    useAiStore.getState().completeToolCall('tc1', 'result');
    const done = useAiStore.getState().getActiveSession()!.messages[0].toolCalls![0];
    expect(done.status).toBe('done');
    expect(done.output).toBe('result');
  });

  it('addToolCall dedupes by id when the same tool_start fires twice', () => {
    seedSession();
    useAiStore.getState().addMessage('assistant', 'running');
    useAiStore.getState().addToolCall('tc1', 'search', { q: 'x' });
    useAiStore.getState().addToolCall('tc1', 'search', { q: 'x' });
    const calls = useAiStore.getState().getActiveSession()!.messages[0].toolCalls!;
    expect(calls).toHaveLength(1);
    expect(calls[0].status).toBe('running');
  });

  it('completeToolCall truncates output longer than 5000 chars', () => {
    seedSession();
    useAiStore.getState().addMessage('assistant', 'x');
    useAiStore.getState().addToolCall('tc1', 't');
    const long = 'a'.repeat(6000);
    useAiStore.getState().completeToolCall('tc1', long);
    const out = useAiStore.getState().getActiveSession()!.messages[0].toolCalls![0].output!;
    expect(out.length).toBeLessThan(6000);
    expect(out).toContain('输出已截断');
  });
});

describe('useAiStore file-change actions', () => {
  it('addFileChange appends a pending change to the active session', () => {
    seedSession();
    useAiStore.getState().addFileChange(makeFileChange('a.md'));
    const changes = useAiStore.getState().getActiveSession()!.fileChanges;
    expect(changes).toHaveLength(1);
    expect(changes[0].status).toBe('pending');
  });

  it('acceptChange applies the accept result to the active session', () => {
    const session = seedSession({ fileChanges: [makeFileChange('a.md')] });
    const accepted = [{ ...session.fileChanges[0], status: 'accepted' as const }];
    vi.mocked(applyAcceptChange).mockReturnValueOnce({ updatedFileChanges: accepted, newContent: 'new' });

    useAiStore.getState().acceptChange('a.md');

    expect(useAiStore.getState().getActiveSession()!.fileChanges[0].status).toBe('accepted');
  });

  it('acceptChange does not call set when the applier returns the same array', () => {
    const session = seedSession({ fileChanges: [makeFileChange('a.md')] });
    vi.mocked(applyAcceptChange).mockReturnValueOnce({ updatedFileChanges: session.fileChanges, newContent: null });
    const before = useAiStore.getState().getActiveSession()!;
    useAiStore.getState().acceptChange('a.md');
    // Identity unchanged → no state update needed.
    expect(useAiStore.getState().getActiveSession()).toBe(before);
  });

  it('rejectChange applies the reject result to the active session', async () => {
    const session = seedSession({ fileChanges: [makeFileChange('a.md')] });
    const rejected = [{ ...session.fileChanges[0], status: 'rejected' as const }];
    vi.mocked(applyRejectChange).mockResolvedValueOnce(rejected);

    await useAiStore.getState().rejectChange('a.md');

    expect(useAiStore.getState().getActiveSession()!.fileChanges[0].status).toBe('rejected');
  });

  it('acceptAll / rejectAll iterate over pending changes', async () => {
    const session = seedSession({ fileChanges: [makeFileChange('a.md'), makeFileChange('b.md')] });
    vi.mocked(applyAcceptChange).mockImplementation((s, path) => ({
      updatedFileChanges: s.fileChanges.map((c) => (c.path === path ? { ...c, status: 'accepted' as const } : c)),
      newContent: 'new',
    }));
    useAiStore.getState().acceptAll();
    expect(useAiStore.getState().getActiveSession()!.fileChanges.every((c) => c.status === 'accepted')).toBe(true);

    seedSession({ id: 's2', fileChanges: [makeFileChange('c.md')] });
    vi.mocked(applyRejectChange).mockImplementation(async (s, path) =>
      s.fileChanges.map((c) => (c.path === path ? { ...c, status: 'rejected' as const } : c)),
    );
    await useAiStore.getState().rejectAll();
    expect(useAiStore.getState().getActiveSession()!.fileChanges.every((c) => c.status === 'rejected')).toBe(true);
    void session;
  });

  it('acceptChange/rejectChange are no-ops without an active session', async () => {
    useAiStore.getState().acceptChange('a.md');
    await useAiStore.getState().rejectChange('a.md');
    expect(vi.mocked(applyAcceptChange)).not.toHaveBeenCalled();
    expect(vi.mocked(applyRejectChange)).not.toHaveBeenCalled();
  });
});

describe('useAiStore streaming + cli session + chat mode', () => {
  it('setSessionStreaming toggles per-session streaming', () => {
    seedSession();
    useAiStore.getState().setSessionStreaming('s1', true);
    expect(useAiStore.getState().sessions[0].isStreaming).toBe(true);
  });

  it('setCliSessionId records the CLI session id', () => {
    seedSession();
    useAiStore.getState().setCliSessionId('cli-1');
    expect(useAiStore.getState().sessions[0].cliSessionId).toBe('cli-1');
  });

  it('setInputMode updates the input mode', () => {
    useAiStore.getState().setInputMode('ask');
    expect(useAiStore.getState().inputMode).toBe('ask');
  });
});

describe('useAiStore.clearMessages + pending attachments', () => {
  it('clearMessages wipes messages, fileChanges, and cliSessionId for the active session', () => {
    seedSession({ messages: [{ id: 'm', role: 'user', content: 'x', timestamp: 1 }], fileChanges: [makeFileChange('a.md')], cliSessionId: 'cli' });
    useAiStore.getState().clearMessages();
    const s = useAiStore.getState().getActiveSession()!;
    expect(s.messages).toEqual([]);
    expect(s.fileChanges).toEqual([]);
    expect(s.cliSessionId).toBeNull();
  });

  it('clearContext drops cliSessionId + fileChanges but keeps messages', () => {
    seedSession({ messages: [{ id: 'm', role: 'user', content: 'x', timestamp: 1 }], fileChanges: [makeFileChange('a.md')], cliSessionId: 'cli' });
    useAiStore.getState().clearContext();
    const s = useAiStore.getState().getActiveSession()!;
    expect(s.messages).toHaveLength(1);
    expect(s.fileChanges).toEqual([]);
    expect(s.cliSessionId).toBeNull();
  });

  it('addFileToChat / consumePendingFiles buffer and drain attachments', () => {
    useAiStore.getState().addFileToChat('a.md', 'notes/a.md');
    useAiStore.getState().addFileToChat('b.md', 'notes/b.md');
    expect(useAiStore.getState().pendingFileAttachments).toHaveLength(2);

    const consumed = useAiStore.getState().consumePendingFiles();
    expect(consumed).toHaveLength(2);
    expect(useAiStore.getState().pendingFileAttachments).toEqual([]);

    // Second consume returns empty.
    expect(useAiStore.getState().consumePendingFiles()).toEqual([]);
  });
});

describe('useAiStore study session (PR9)', () => {
  it('getSession retrieves by id, undefined for null/missing', () => {
    expect(useAiStore.getState().getSession(null)).toBeUndefined();
    expect(useAiStore.getState().getSession('nope')).toBeUndefined();
    const id = useAiStore.getState().createSession();
    expect(useAiStore.getState().getSession(id)?.id).toBe(id);
  });

  it('getOrCreateStudySession creates a kind=study session and records studySessionId', () => {
    const id = useAiStore.getState().getOrCreateStudySession();
    const s = useAiStore.getState().sessions.find((x) => x.id === id)!;
    expect(s.kind).toBe('study');
    expect(s.title).toBe('学习 agent');
    expect(useAiStore.getState().studySessionId).toBe(id);
    expect(useAiStore.getState().activeSessionId).toBe(id);
  });

  it('getOrCreateStudySession reuses the existing study session (multi-turn resume)', () => {
    const first = useAiStore.getState().getOrCreateStudySession();
    // Simulate a prior run recording a cli session id.
    useAiStore.getState().setCliSessionId('cli-1', first);
    const second = useAiStore.getState().getOrCreateStudySession();
    expect(second).toBe(first);
    expect(useAiStore.getState().sessions).toHaveLength(1);
    // cliSessionId preserved for resume.
    expect(useAiStore.getState().getSession(second)?.cliSessionId).toBe('cli-1');
  });

  it('getOrCreateStudySession re-activates the existing study session without creating a new one', () => {
    const studyId = useAiStore.getState().getOrCreateStudySession();
    // User switches to a different chat session.
    const chatId = useAiStore.getState().createSession();
    expect(useAiStore.getState().activeSessionId).toBe(chatId);
    const reused = useAiStore.getState().getOrCreateStudySession();
    expect(reused).toBe(studyId);
    expect(useAiStore.getState().activeSessionId).toBe(studyId);
    expect(useAiStore.getState().sessions).toHaveLength(2);
  });

  it('deleteSession clears studySessionId when the study session is removed', () => {
    const studyId = useAiStore.getState().getOrCreateStudySession();
    useAiStore.getState().deleteSession(studyId);
    expect(useAiStore.getState().studySessionId).toBeNull();
    expect(useAiStore.getState().sessions).toEqual([]);
  });

  it('deleteSession leaves studySessionId intact when removing a different session', () => {
    const studyId = useAiStore.getState().getOrCreateStudySession();
    const chatId = useAiStore.getState().createSession();
    useAiStore.getState().deleteSession(chatId);
    expect(useAiStore.getState().studySessionId).toBe(studyId);
  });

  it('重启后 studySessionId 丢失时，回退扫描复用已持久化的 study 会话而非新建', () => {
    const studyId = useAiStore.getState().getOrCreateStudySession();
    useAiStore.getState().setCliSessionId('cli-9', studyId);
    // 模拟重启：sessions 从磁盘恢复（kind 保留），但 studySessionId 未持久化 → null。
    useAiStore.setState({
      sessions: useAiStore.getState().sessions,
      activeSessionId: null,
      studySessionId: null,
    });
    const reused = useAiStore.getState().getOrCreateStudySession();
    expect(reused).toBe(studyId);
    expect(useAiStore.getState().studySessionId).toBe(studyId);
    // 不应新建会话
    expect(useAiStore.getState().sessions.filter((s) => s.kind === 'study')).toHaveLength(1);
    // cliSessionId 仍保留供 resume
    expect(useAiStore.getState().getSession(reused)?.cliSessionId).toBe('cli-9');
  });
});

// Phase 1: createEmptySession seeds from the most-recent session's pair,
// else firstEnabledPair, else undefined (no global "last used pair" role).
describe('createEmptySession seeds pair (Phase 1)', () => {
  it('copies the most-recent session pair when sessions is non-empty', () => {
    useAiStore.setState({
      sessions: [
        {
          id: 'recent',
          title: 'recent',
          messages: [],
          fileChanges: [],
          cliSessionId: null,
          isStreaming: false,
          createdAt: 2,
          updatedAt: 2,
          provider: 'openai',
          model: 'gpt-4o',
        },
      ],
      activeSessionId: 'recent',
    });
    useAiStore.getState().createSession();
    const sess = useAiStore.getState().getActiveSession();
    expect(sess?.provider).toBe('openai');
    expect(sess?.model).toBe('gpt-4o');
  });

  it('falls back to firstEnabledPair when sessions is empty', () => {
    useAiConfigStore.setState({
      providerSettings: {
        openai: {
          id: 'openai',
          baseUrl: '',
          apiKey: 'sk-x',
          selectedModelIds: ['gpt-4o'],
          enabled: true,
          extra: {},
        },
      },
    });
    useAiStore.getState().createSession();
    const sess = useAiStore.getState().getActiveSession();
    expect(sess?.provider).toBe('openai');
    expect(sess?.model).toBe('gpt-4o');
  });

  it('leaves provider/model undefined when sessions is empty and no provider enabled', () => {
    useAiConfigStore.setState({ providerSettings: {} });
    useAiStore.getState().createSession();
    const sess = useAiStore.getState().getActiveSession();
    expect(sess?.provider).toBeUndefined();
    expect(sess?.model).toBeUndefined();
  });
});

// Phase 1: setSessionPair writes only the session — no global dual-write.
describe('setSessionPair (Phase 1)', () => {
  it('writes session.provider/model without syncing global chatProvider/chatModel', () => {
    useAiConfigStore.setState({ chatProvider: 'anthropic', chatModel: 'claude-sonnet-4-6' });
    const id = useAiStore.getState().createSession();
    useAiStore.getState().setSessionPair(id, { provider: 'openai', model: 'gpt-4o' });
    const sess = useAiStore.getState().getSession(id)!;
    expect(sess.provider).toBe('openai');
    expect(sess.model).toBe('gpt-4o');
    // Global "last used pair" role dropped — chatProvider/chatModel now only
    // track the settings UI selection and stay untouched on session-pair write.
    expect(useAiConfigStore.getState().chatProvider).toBe('anthropic');
    expect(useAiConfigStore.getState().chatModel).toBe('claude-sonnet-4-6');
  });

  it('is a no-op for an unknown session id', () => {
    useAiConfigStore.setState({ chatProvider: 'anthropic', chatModel: 'claude-sonnet-4-6' });
    useAiStore.getState().setSessionPair('nope', { provider: 'openai', model: 'gpt-4o' });
    expect(useAiConfigStore.getState().chatProvider).toBe('anthropic');
    expect(useAiConfigStore.getState().chatModel).toBe('claude-sonnet-4-6');
    expect(useAiStore.getState().sessions).toEqual([]);
  });
});

describe('setSessionMode', () => {
  it('writes mode onto the session (persists across restart via existing saveAllSessions)', () => {
    const id = useAiStore.getState().createSession();
    useAiStore.getState().setSessionMode(id, 'agent');
    const sess = useAiStore.getState().getSession(id)!;
    expect(sess.mode).toBe('agent');
  });

  it('is a no-op for an unknown session id', () => {
    useAiStore.getState().setSessionMode('nope', 'agent');
    expect(useAiStore.getState().sessions).toEqual([]);
  });

  it('createEmptySession seeds mode from the most recent session', () => {
    const first = useAiStore.getState().createSession();
    useAiStore.getState().setSessionMode(first, 'ask');
    const second = useAiStore.getState().createSession();
    expect(useAiStore.getState().getSession(second)?.mode).toBe('ask');
  });
});
