import { create } from 'zustand';
import type { CliMessage, FileChange, ToolCallInfo, MessageAttachment } from '@quill/cli-adapter';
import { useVaultStore } from './vaultStore';
import { useEditorStore } from './editorStore';
import { sessionStorage } from '@/utils/sessionStorage';
import { suppressWatcherFor } from '@/utils/fileWatcher';
import { generateId } from '@/utils/idGenerator';
import { applyAcceptChange, applyRejectChange } from './aiFileChangeActions';
import { persistAiState, saveAllSessions, loadSessionsFromDisk, setSuppressPersist, setupPersistSubscription } from './aiSessionPersistence';

export { loadAiSessionsForVault } from './aiSessionPersistence';

export type { CliMessage, FileChange, ToolCallInfo, MessageAttachment };

export type AiChatMode = 'chat' | 'wiki' | 'clip';

export interface AiSession {
  id: string;
  title: string;
  messages: CliMessage[];
  fileChanges: FileChange[];
  cliSessionId: string | null;
  isStreaming: boolean;
  createdAt: number;
  updatedAt: number;
}

interface AiState {
  sessions: AiSession[];
  activeSessionId: string | null;

  getActiveSession: () => AiSession | undefined;
  createSession: () => string;
  switchSession: (id: string) => void;
  deleteSession: (id: string) => void;

  // Session-scoped message actions (target specific session, not just active)
  addMessage: (role: 'user' | 'assistant', content: string, sessionId?: string, attachments?: MessageAttachment[]) => void;
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

  /** @deprecated use setSessionStreaming */
  setStreaming: (streaming: boolean) => void;
  /** Check if the active session is streaming */
  isStreaming: boolean;

  chatMode: AiChatMode;
  setChatMode: (mode: AiChatMode) => void;

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
  return {
    id: generateId(),
    title: '新会话',
    messages: [],
    fileChanges: [],
    cliSessionId: null,
    isStreaming: false,
    createdAt: now,
    updatedAt: now,
  };
}

function updateSession(sessions: AiSession[], id: string, updater: (s: AiSession) => AiSession): AiSession[] {
  return sessions.map((s) => (s.id === id ? updater(s) : s));
}

export const useAiStore = create<AiState>((set, get) => ({
  sessions: [],
  activeSessionId: null,
  isStreaming: false,

  getActiveSession: () => {
    const { sessions, activeSessionId } = get();
    return sessions.find((s) => s.id === activeSessionId);
  },

  createSession: () => {
    const session = createEmptySession();
    set((state) => ({
      sessions: [session, ...state.sessions],
      activeSessionId: session.id,
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
    set({ sessions: remaining, activeSessionId: nextActiveId });
    const vaultId = useVaultStore.getState().activeVaultId;
    if (vaultId) sessionStorage.deleteSession(vaultId, id);
    persistAiState();
  },

  addMessage: (role, content, sessionId?, attachments?) => {
    const targetId = sessionId || get().activeSessionId;
    if (!targetId) return;
    const msg: CliMessage = { id: generateId(), role, content, timestamp: Date.now(), ...(attachments?.length ? { attachments } : {}) };
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

    const vaultId = useVaultStore.getState().activeVaultId || '';
    const tabId = `${vaultId}:${change.path}`;
    const tab = useEditorStore.getState().tabs.find((t) => t.id === tabId);
    if (tab && change.status === 'pending') {
      useEditorStore.getState().enterDiffReview(change.path, change.oldContent, change.newContent);
    }
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

  setStreaming: (streaming) => {
    const { activeSessionId } = get();
    if (!activeSessionId) return;
    get().setSessionStreaming(activeSessionId, streaming);
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

  chatMode: 'chat' as AiChatMode,
  setChatMode: (mode) => set({ chatMode: mode }),

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
