import { create } from 'zustand';
import type { CliMessage, FileChange, MessageAttachment } from '@quill/cli-adapter';
import type { FileChangeApplier } from '@/services/fileChangeApplier';
import { useAiConfigStore, firstEnabledPair, type ChatProvider } from './aiConfigStore';
import { useVaultStore } from './vaultStore';
import { sessionStorage } from '@/utils/sessionStorage';
import { suppressWatcherFor } from '@/utils/fileWatcher';
import { generateId } from '@/utils/idGenerator';
import { applyAcceptChange, applyRejectChange } from './aiFileChangeActions';
import { persistAiState, saveAllSessions, loadSessionsFromDisk, setSuppressPersist, setupPersistSubscription } from './aiSessionPersistence';

export { loadAiSessionsForVault } from './aiSessionPersistence';

// ── FileChangeApplier injection slot ───────────────────────────────────────
// addFileChange delegates editor mutation to the registered applier
// (EditorFileChangeApplier, registered at App init via
// registerEditorFileChangeApplier). The applier owns the useCodeMirror routing
// (diffReviewStore.enterDiffReview vs editorStore.updateTabContent) and the
// tabId format — aiStore does not import editorStore/diffReviewStore at
// runtime. If the applier is null (init not yet run), addFileChange still
// records the change but applies nothing — defensive against init ordering;
// the normal flow registers the applier before any user/AI action.
let fileChangeApplier: FileChangeApplier | null = null;

/** Editor layer registers its FileChangeApplier here (see services/fileChangeApplier.ts). */
export function setFileChangeApplier(applier: FileChangeApplier | null): void {
  fileChangeApplier = applier;
}

/** Read the registered applier. Returns null until the editor layer registers one. */
export function getFileChangeApplier(): FileChangeApplier | null {
  return fileChangeApplier;
}

/** 会话类型：普通聊天会话 vs 专用 study agent 会话（PR9）。
 * study 会话由 runFeatureAgent('study') 自动驱动，输入框不可手动编辑。 */
export type AiSessionKind = 'chat' | 'study';

export interface AiSession {
  id: string;
  title: string;
  messages: CliMessage[];
  fileChanges: FileChange[];
  cliSessionId: string | null;
  isStreaming: boolean;
  createdAt: number;
  updatedAt: number;
  /** 会话类型，缺省 'chat'。study 会话复用同一 cliSessionId 支持多轮 resume。 */
  kind?: AiSessionKind;
  // ponytail: provider/model optional so legacy persisted sessions hydrate
  // without migration. Render-time falls back to pairs[0] from
  // useEnabledPairs in AiPanel when undefined. New sessions inherit a pair
  // via createEmptySession (recent session's pair, else firstEnabledPair).
  provider?: ChatProvider;
  model?: string;
}

interface AiState {
  sessions: AiSession[];
  activeSessionId: string | null;
  /** 专用 study agent 会话 id（PR9）。复用同一会话以支持多轮 resume。 */
  studySessionId: string | null;

  getActiveSession: () => AiSession | undefined;
  /** 按 id 取会话（study 捕获/diff 横幅按 studySessionId 定位，不依赖 active）。 */
  getSession: (id: string | null | undefined) => AiSession | undefined;
  createSession: () => string;
  /** 创建或复用专用 study agent 会话，设为 active，返回其 id。 */
  getOrCreateStudySession: () => string;
  switchSession: (id: string) => void;
  deleteSession: (id: string) => void;

  // Session-scoped message actions (target specific session, not just active)
  addMessage: (
    role: 'user' | 'assistant',
    content: string,
    sessionId?: string,
    attachments?: MessageAttachment[],
    provider?: ChatProvider,
    model?: string,
  ) => void;
  appendToLastMessage: (token: string, sessionId?: string) => void;
  appendThinking: (token: string, sessionId?: string) => void;
  addToolCall: (id: string, name: string, input?: Record<string, unknown>, sessionId?: string) => void;
  completeToolCall: (id: string, output?: string, sessionId?: string) => void;
  addFileChange: (change: FileChange, sessionId?: string) => void;
  acceptChange: (path: string) => void;
  rejectChange: (path: string) => Promise<void>;
  acceptAll: () => void;
  rejectAll: () => Promise<void>;
  setSessionStreaming: (sessionId: string, streaming: boolean) => void;
  setCliSessionId: (sessionId: string, targetSessionId?: string) => void;
  clearMessages: () => void;

  /** Set the (provider, model) pair on a specific session. Writes only the
   *  session — the global chatProvider/chatModel "last used pair" role was
   *  dropped; new sessions seed from the most recent session's pair (or
   *  firstEnabledPair) in createEmptySession, not from a global. */
  setSessionPair: (sessionId: string, pair: { provider: ChatProvider; model: string }) => void;

  /** AI panel 输入模式（ask/agent/…），全局共享，默认 'agent' 保持现状行为。
   * 决定单次发送的 permission-mode/system-prompt 等。 */
  inputMode: string;
  setInputMode: (mode: string) => void;

  pendingFileAttachments: { name: string; path: string }[];
  addFileToChat: (name: string, path: string) => void;
  consumePendingFiles: () => { name: string; path: string }[];
  /** 预填到 ChatInput 输入框的提示词（学习工作台 AI 动作用，无新调用链）。 */
  pendingPrompt: string;
  setPendingPrompt: (prompt: string) => void;
  consumePendingPrompt: () => string;

  /** Save current sessions and load sessions for a different vault */
  switchVaultSessions: (newVaultId: string) => Promise<void>;
}

export function createEmptySession(): AiSession {
  const now = Date.now();
  // Seed the session's pair from the most recent session's pair if any (new
  // sessions are unshifted to the front, so sessions[0] is the last one the
  // user touched); else fall back to firstEnabledPair from the catalog. No
  // global "last used pair" role — chatProvider/chatModel now only track the
  // settings UI selection.
  const existing = useAiStore.getState().sessions;
  const recent = existing.length > 0 ? existing[0] : undefined;
  const fallback = firstEnabledPair(useAiConfigStore.getState());
  return {
    id: generateId(),
    title: '新会话',
    messages: [],
    fileChanges: [],
    cliSessionId: null,
    isStreaming: false,
    createdAt: now,
    updatedAt: now,
    provider: recent?.provider ?? fallback?.provider,
    model: recent?.model ?? fallback?.model,
  };
}

function updateSession(sessions: AiSession[], id: string, updater: (s: AiSession) => AiSession): AiSession[] {
  return sessions.map((s) => (s.id === id ? updater(s) : s));
}

export const useAiStore = create<AiState>((set, get) => ({
  sessions: [],
  activeSessionId: null,
  studySessionId: null,

  getActiveSession: () => {
    const { sessions, activeSessionId } = get();
    return sessions.find((s) => s.id === activeSessionId);
  },

  getSession: (id) => (id ? get().sessions.find((s) => s.id === id) : undefined),

  createSession: () => {
    const session = createEmptySession();
    set((state) => ({
      sessions: [session, ...state.sessions],
      activeSessionId: session.id,
    }));
    return session.id;
  },

  getOrCreateStudySession: () => {
    const state = get();
    // 先按记录的 studySessionId 定位；命中失败（如重启后 studySessionId 未持久化、
    // 或会话被外部清空）则回退扫描 sessions 里任意 kind='study' 会话，避免创建重复
    // study 会话导致旧的孤立。
    const existing = state.studySessionId
      ? state.sessions.find((s) => s.id === state.studySessionId && s.kind === 'study')
      : undefined;
    if (existing) {
      if (state.activeSessionId !== existing.id) {
        set({ activeSessionId: existing.id });
      }
      return existing.id;
    }
    const orphan = state.sessions.find((s) => s.kind === 'study');
    if (orphan) {
      set({ studySessionId: orphan.id, activeSessionId: orphan.id });
      return orphan.id;
    }
    const session = createEmptySession();
    session.title = '学习 agent';
    session.kind = 'study';
    set((s) => ({
      sessions: [session, ...s.sessions],
      activeSessionId: session.id,
      studySessionId: session.id,
    }));
    return session.id;
  },

  switchSession: (id) => set({ activeSessionId: id }),

  deleteSession: (id) => {
    const state = get();
    const target = state.sessions.find((s) => s.id === id);
    if (target?.isStreaming) return;
    const remaining = state.sessions.filter((s) => s.id !== id);
    let nextActiveId = state.activeSessionId;
    if (state.activeSessionId === id) {
      nextActiveId = remaining.length > 0 ? remaining[0].id : null;
    }
    const nextStudyId = state.studySessionId === id ? null : state.studySessionId;
    set({ sessions: remaining, activeSessionId: nextActiveId, studySessionId: nextStudyId });
    const vaultId = useVaultStore.getState().activeVaultId;
    if (vaultId) sessionStorage.deleteSession(vaultId, id);
    persistAiState();
  },

  addMessage: (role, content, sessionId?, attachments?, provider?, model?) => {
    const targetId = sessionId || get().activeSessionId;
    if (!targetId) return;
    // ponytail: tag at creation time — provider/model are spread onto the
    // CliMessage only when explicitly passed (PR4: AiPanel forwards the
    // session's pair when appending the assistant bubble). The
    // appendToLastMessage/appendThinking/etc. mutators below spread `...last`
    // so the tag survives streaming chunk appends. Legacy messages
    // (provider undefined) render without the tag — see ChatMessageList.
    const msg: CliMessage = {
      id: generateId(),
      role,
      content,
      timestamp: Date.now(),
      ...(attachments?.length ? { attachments } : {}),
      ...(provider ? { provider } : {}),
      ...(model ? { model } : {}),
    };
    set((state) => ({
      sessions: updateSession(state.sessions, targetId, (s) => {
        const updated = { ...s, messages: [...s.messages, msg], updatedAt: Date.now() };
        if (role === 'user' && s.messages.length === 0) {
          updated.title = content.slice(0, 20) || '新会话';
        }
        return updated;
      }),
    }));
  },

  appendToLastMessage: (token, sessionId?) => {
    const targetId = sessionId || get().activeSessionId;
    if (!targetId) return;
    set((state) => ({
      sessions: updateSession(state.sessions, targetId, (s) => {
        const msgs = [...s.messages];
        if (msgs.length > 0) {
          const last = msgs[msgs.length - 1];
          msgs[msgs.length - 1] = { ...last, content: last.content + token };
        }
        return { ...s, messages: msgs, updatedAt: Date.now() };
      }),
    }));
  },

  appendThinking: (token, sessionId?) => {
    const targetId = sessionId || get().activeSessionId;
    if (!targetId) return;
    set((state) => ({
      sessions: updateSession(state.sessions, targetId, (s) => {
        const msgs = [...s.messages];
        if (msgs.length > 0) {
          const last = msgs[msgs.length - 1];
          msgs[msgs.length - 1] = { ...last, thinking: (last.thinking || '') + token };
        }
        return { ...s, messages: msgs, updatedAt: Date.now() };
      }),
    }));
  },

  addToolCall: (id, name, input, sessionId?) => {
    const targetId = sessionId || get().activeSessionId;
    if (!targetId) return;
    set((state) => ({
      sessions: updateSession(state.sessions, targetId, (s) => {
        const msgs = [...s.messages];
        if (msgs.length > 0) {
          const last = msgs[msgs.length - 1];
          msgs[msgs.length - 1] = {
            ...last,
            toolCalls: [...(last.toolCalls || []), { id, name, status: 'running' as const, input }],
          };
        }
        return { ...s, messages: msgs, updatedAt: Date.now() };
      }),
    }));
  },

  completeToolCall: (id, output, sessionId?) => {
    const targetId = sessionId || get().activeSessionId;
    if (!targetId) return;
    const safeOutput = output && output.length > 5000 ? output.slice(0, 5000) + '\n...(输出已截断)' : output;
    set((state) => ({
      sessions: updateSession(state.sessions, targetId, (s) => {
        const msgs = [...s.messages];
        if (msgs.length > 0) {
          const last = msgs[msgs.length - 1];
          msgs[msgs.length - 1] = {
            ...last,
            toolCalls: (last.toolCalls || []).map((tc) =>
              tc.id === id ? { ...tc, status: 'done' as const, output: safeOutput } : tc,
            ),
          };
        }
        return { ...s, messages: msgs, updatedAt: Date.now() };
      }),
    }));
  },

  addFileChange: (change, sessionId?) => {
    const targetId = sessionId || get().activeSessionId;
    if (!targetId) return;
    set((state) => ({
      sessions: updateSession(state.sessions, targetId, (s) => ({
        ...s,
        fileChanges: [...s.fileChanges, change],
        updatedAt: Date.now(),
      })),
    }));

    suppressWatcherFor(change.path);

    // Delegate editor mutation to the injected FileChangeApplier
    // (EditorFileChangeApplier). It routes by useCodeMirror (enterDiffReview vs
    // updateTabContent) and owns the tabId format.
    fileChangeApplier?.apply(change);
  },

  acceptChange: (path) => {
    const session = get().getActiveSession();
    if (!session) return;
    const { updatedFileChanges } = applyAcceptChange(session, path);
    if (updatedFileChanges !== session.fileChanges) {
      set((state) => ({
        sessions: updateSession(state.sessions, session.id, (s) => ({
          ...s,
          fileChanges: updatedFileChanges,
          updatedAt: Date.now(),
        })),
      }));
    }
  },

  rejectChange: async (path) => {
    const session = get().getActiveSession();
    if (!session) return;
    const updatedFileChanges = await applyRejectChange(session, path);
    set((state) => ({
      sessions: updateSession(state.sessions, session.id, (s) => ({
        ...s,
        fileChanges: updatedFileChanges,
        updatedAt: Date.now(),
      })),
    }));
  },

  acceptAll: () => {
    const session = get().getActiveSession();
    if (!session) return;
    const pending = session.fileChanges.filter((c) => c.status === 'pending');
    for (const change of pending) {
      get().acceptChange(change.path);
    }
  },

  rejectAll: async () => {
    const session = get().getActiveSession();
    if (!session) return;
    const pending = session.fileChanges.filter((c) => c.status === 'pending');
    for (const change of pending) {
      await get().rejectChange(change.path);
    }
  },

  setSessionStreaming: (sessionId, streaming) => {
    set((state) => ({
      sessions: updateSession(state.sessions, sessionId, (s) => ({
        ...s,
        isStreaming: streaming,
      })),
    }));
  },

  setCliSessionId: (cliId, targetSessionId?) => {
    const sessionId = targetSessionId || get().activeSessionId;
    if (!sessionId) return;
    set((state) => ({
      sessions: updateSession(state.sessions, sessionId, (s) => ({
        ...s,
        cliSessionId: cliId,
      })),
    }));
  },

  clearMessages: () => {
    const { activeSessionId } = get();
    if (!activeSessionId) return;
    set((state) => ({
      sessions: updateSession(state.sessions, activeSessionId, (s) => ({
        ...s,
        messages: [],
        fileChanges: [],
        cliSessionId: null,
        updatedAt: Date.now(),
      })),
    }));
    persistAiState();
  },

  setSessionPair: (sessionId, pair) => {
    if (!get().sessions.some((s) => s.id === sessionId)) return;
    set((state) => ({
      sessions: updateSession(state.sessions, sessionId, (s) => ({
        ...s,
        provider: pair.provider,
        model: pair.model,
        updatedAt: Date.now(),
      })),
    }));
    persistAiState();
  },

  inputMode: 'agent',
  setInputMode: (mode) => set({ inputMode: mode }),

  pendingFileAttachments: [],
  addFileToChat: (name, path) => {
    set((state) => ({
      pendingFileAttachments: [...state.pendingFileAttachments, { name, path }],
    }));
  },
  consumePendingFiles: () => {
    const files = get().pendingFileAttachments;
    if (files.length > 0) set({ pendingFileAttachments: [] });
    return files;
  },

  pendingPrompt: '',
  setPendingPrompt: (prompt) => set({ pendingPrompt: prompt }),
  consumePendingPrompt: () => {
    const p = get().pendingPrompt;
    if (p) set({ pendingPrompt: '' });
    return p;
  },

  switchVaultSessions: async (newVaultId: string) => {
    // Save current vault's sessions
    const currentVaultId = useVaultStore.getState().activeVaultId;
    if (currentVaultId) {
      await saveAllSessions(currentVaultId);
    }

    // Suppress auto-persist while loading new vault's sessions
    setSuppressPersist(true);
    await loadSessionsFromDisk(newVaultId);
    setSuppressPersist(false);
  },
}));

// ── Persistence (see ./aiSessionPersistence.ts) ──
setupPersistSubscription();
