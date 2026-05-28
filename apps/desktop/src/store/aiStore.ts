import { create } from 'zustand';
import type { CliMessage, FileChange, ToolCallInfo, MessageAttachment } from '@quill/cli-adapter';
import { writeTextFile } from '@tauri-apps/plugin-fs';
import { useVaultStore } from './vaultStore';
import { useEditorStore } from './editorStore';
import { storageClient } from '@/utils/storageClient';
import { sessionStorage } from '@/utils/sessionStorage';

export type { CliMessage, FileChange, ToolCallInfo, MessageAttachment };

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

  pendingFileAttachments: { name: string; path: string }[];
  addFileToChat: (name: string, path: string) => void;
  consumePendingFiles: () => { name: string; path: string }[];

  /** Save current sessions and load sessions for a different vault */
  switchVaultSessions: (newVaultId: string) => Promise<void>;
}

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function createEmptySession(): AiSession {
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
  },

  acceptChange: (path) => {
    const session = get().getActiveSession();
    if (!session) return;
    const change = session.fileChanges.find((c) => c.path === path && c.status === 'pending');
    if (!change) return;

    set((state) => ({
      sessions: updateSession(state.sessions, session.id, (s) => ({
        ...s,
        fileChanges: s.fileChanges.map((c) =>
          c.path === path && c.status === 'pending' ? { ...c, status: 'accepted' as const } : c,
        ),
        updatedAt: Date.now(),
      })),
    }));

    const vaultId = useVaultStore.getState().activeVaultId || '';
    const tabId = `${vaultId}:${path}`;
    const tab = useEditorStore.getState().tabs.find((t) => t.id === tabId);
    if (tab) {
      useEditorStore.getState().setContentExternal(tabId, change.newContent);
    }
  },

  rejectChange: async (path) => {
    const session = get().getActiveSession();
    if (!session) return;
    const change = session.fileChanges.find((c) => c.path === path && c.status === 'pending');
    if (!change) return;

    const vaultRoot = useVaultStore.getState().currentVault?.basePath ?? '';
    if (vaultRoot) {
      let resolvedRoot = vaultRoot;
      if (resolvedRoot.startsWith('~')) {
        const { homeDir } = await import('@tauri-apps/api/path');
        const home = (await homeDir()).replace(/\/+$/, '');
        resolvedRoot = home + resolvedRoot.slice(1);
      }
      const fullPath = resolvedRoot + '/' + path;
      await writeTextFile(fullPath, change.oldContent);
    }

    set((state) => ({
      sessions: updateSession(state.sessions, session.id, (s) => ({
        ...s,
        fileChanges: s.fileChanges.map((c) =>
          c.path === path && c.status === 'pending' ? { ...c, status: 'rejected' as const } : c,
        ),
        updatedAt: Date.now(),
      })),
    }));

    const vaultId = useVaultStore.getState().activeVaultId || '';
    const tabId = `${vaultId}:${path}`;
    const tab = useEditorStore.getState().tabs.find((t) => t.id === tabId);
    if (tab) {
      useEditorStore.getState().updateTabContent(tabId, change.oldContent);
    }
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

  switchVaultSessions: async (newVaultId: string) => {
    // Save current vault's sessions
    const currentVaultId = useVaultStore.getState().activeVaultId;
    if (currentVaultId) {
      await saveAllSessions(currentVaultId);
    }

    // Suppress auto-persist while loading new vault's sessions
    suppressPersist = true;
    await loadSessionsFromDisk(newVaultId);
    suppressPersist = false;
  },
}));

// ── Persistence ──

const AI_LEGACY_KEY = 'ai:session';

interface PersistedAiState {
  sessions: AiSession[];
  activeSessionId: string | null;
}

interface LegacyPersistedState {
  messages?: CliMessage[];
  fileChanges?: FileChange[];
}

/** Save all sessions for a vault to individual files */
async function saveAllSessions(vaultId: string) {
  const { sessions, activeSessionId } = useAiStore.getState();
  await sessionStorage.saveMeta(vaultId, { activeSessionId });
  for (const session of sessions) {
    const { isStreaming: _, ...data } = session;
    await sessionStorage.saveSession(vaultId, session.id, data);
  }
}

/** Load all sessions for a vault from disk */
async function loadSessionsFromDisk(vaultId: string) {
  let ids = await sessionStorage.listSessionIds(vaultId);

  // Migrate from storageClient if no files on disk yet
  if (ids.length === 0) {
    const intermediate = await storageClient.get<PersistedAiState>(`ai:sessions:${vaultId}`);
    if (intermediate?.sessions && intermediate.sessions.length > 0) {
      for (const s of intermediate.sessions) {
        const { isStreaming: _, ...data } = s as AiSession & { isStreaming?: boolean };
        await sessionStorage.saveSession(vaultId, s.id, data);
      }
      await sessionStorage.saveMeta(vaultId, { activeSessionId: intermediate.activeSessionId ?? intermediate.sessions[0].id });
      await storageClient.remove(`ai:sessions:${vaultId}`);
      ids = await sessionStorage.listSessionIds(vaultId);
    }
  }

  if (ids.length === 0) {
    const session = createEmptySession();
    useAiStore.setState({ sessions: [session], activeSessionId: session.id });
    return;
  }

  const sessions: AiSession[] = [];
  for (const id of ids) {
    const data = await sessionStorage.loadSession<Omit<AiSession, 'isStreaming'>>(vaultId, id);
    if (data) {
      sessions.push({ ...data, isStreaming: false });
    }
  }

  if (sessions.length === 0) {
    const session = createEmptySession();
    useAiStore.setState({ sessions: [session], activeSessionId: session.id });
    return;
  }

  sessions.sort((a, b) => b.createdAt - a.createdAt);

  const meta = await sessionStorage.loadMeta(vaultId);
  const activeId = meta?.activeSessionId && sessions.some((s) => s.id === meta.activeSessionId)
    ? meta.activeSessionId
    : sessions[0].id;
  useAiStore.setState({ sessions, activeSessionId: activeId });
}

let suppressPersist = false;

function persistAiState() {
  if (suppressPersist) return;
  const vaultId = useVaultStore.getState().activeVaultId;
  if (!vaultId) return;
  saveAllSessions(vaultId);
}

let persistTimer: ReturnType<typeof setTimeout> | null = null;
function debouncedPersist() {
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(persistAiState, 500);
}

useAiStore.subscribe((state, prev) => {
  if (state.sessions !== prev.sessions) {
    const anyStreaming = state.sessions.some((s) => s.isStreaming);
    if (!anyStreaming) {
      debouncedPersist();
    } else {
      const prevStreaming = prev.sessions.some((s) => s.isStreaming);
      if (prevStreaming && !anyStreaming) {
        debouncedPersist();
      }
    }
  }
});

/** Load AI sessions for the current vault (called after vault init) */
export async function loadAiSessionsForVault() {
  const vaultId = useVaultStore.getState().activeVaultId;
  if (!vaultId) {
    const session = createEmptySession();
    useAiStore.setState({ sessions: [session], activeSessionId: session.id });
    return;
  }

  // Check if vault dir has sessions already
  const ids = await sessionStorage.listSessionIds(vaultId);
  if (ids.length > 0) {
    await loadSessionsFromDisk(vaultId);
    return;
  }

  // Fallback: migrate from legacy storageClient key
  const legacy = await storageClient.get<PersistedAiState & LegacyPersistedState>(AI_LEGACY_KEY);
  if (legacy?.sessions && legacy.sessions.length > 0) {
    for (const s of legacy.sessions) {
      const { isStreaming: _, ...data } = s as AiSession & { isStreaming?: boolean };
      await sessionStorage.saveSession(vaultId, s.id, data);
    }
    await sessionStorage.saveMeta(vaultId, { activeSessionId: legacy.activeSessionId ?? legacy.sessions[0].id });
    await storageClient.remove(AI_LEGACY_KEY);
    await loadSessionsFromDisk(vaultId);
  } else if (legacy?.messages) {
    const session: AiSession = {
      ...createEmptySession(),
      messages: legacy.messages,
      fileChanges: legacy.fileChanges || [],
    };
    const { isStreaming: _, ...data } = session;
    await sessionStorage.saveSession(vaultId, session.id, data);
    await sessionStorage.saveMeta(vaultId, { activeSessionId: session.id });
    await storageClient.remove(AI_LEGACY_KEY);
    await loadSessionsFromDisk(vaultId);
  } else {
    // Also try the intermediate vault-scoped storageClient key
    const intermediate = await storageClient.get<PersistedAiState>(`ai:sessions:${vaultId}`);
    if (intermediate?.sessions && intermediate.sessions.length > 0) {
      for (const s of intermediate.sessions) {
        const { isStreaming: _, ...data } = s as AiSession & { isStreaming?: boolean };
        await sessionStorage.saveSession(vaultId, s.id, data);
      }
      await sessionStorage.saveMeta(vaultId, { activeSessionId: intermediate.activeSessionId ?? intermediate.sessions[0].id });
      await storageClient.remove(`ai:sessions:${vaultId}`);
      await loadSessionsFromDisk(vaultId);
    } else {
      const session = createEmptySession();
      useAiStore.setState({ sessions: [session], activeSessionId: session.id });
    }
  }
}
