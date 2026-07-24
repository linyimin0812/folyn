import { create } from 'zustand';
import { storageClient } from '@/utils/storageClient';
import { generateId } from '@/utils/idGenerator';
import { debounce } from '@/utils/debounce';
import type { CliMessage } from '@quill/cli-adapter';

/**
 * BubbleTemplateChatStore — sessions for the AI Bubble-Template generator
 * modal. Mirrors the petChatStore pattern (file-backed via storageClient,
 * debounced persist, auto-title from first user message), minus the CLI /
 * vault coupling — the modal is a settings sub-feature that runs rig chat
 * directly with the UI session id as the rig session id.
 *
 * Persistence namespace: `btai:sessions` in storageClient (single
 * `storage.json` file in appDataDir). Persisted payload is
 * `{ sessions, activeSessionId }`; `streaming` is runtime-only.
 *
 * Rehydrate is lazy (called from the modal on open) — unlike petChatStore
 * which rehydrates at module load. The modal is a settings sub-page that
 * opens rarely, so paying the rehydrate cost only on open is fine.
 */

// ── Types ──

export interface BtSession {
  id: string;
  title: string;
  messages: CliMessage[];
  createdAt: number;
}

interface PersistedBt {
  sessions: BtSession[];
  activeSessionId: string | null;
}

interface BtState {
  sessions: BtSession[];
  activeSessionId: string | null;
  /** True while a streamed assistant response is in flight for the active
   *  session. Runtime-only — NOT persisted. */
  streaming: boolean;
  /** Flipped true after the first rehydrate. The modal uses this to render
   *  a loading state until the store has its sessions populated. */
  loaded: boolean;

  // ── Session actions ──
  createSession: () => string;
  switchSession: (id: string) => void;
  /** Remove a session. If it is the last one, auto-create an empty session
   *  and switch to it. */
  deleteSession: (id: string) => void;
  renameSession: (id: string, title: string) => void;

  // ── Message actions (target a specific session by id) ──
  addMessage: (sessionId: string, msg: CliMessage) => void;
  appendToLastMessage: (sessionId: string, chunk: string) => void;
  /** Append a thinking/reasoning chunk to the last message's `thinking`
   *  field (NOT `content`). Same no-op guards as `appendToLastMessage`. */
  appendToLastMessageThinking: (sessionId: string, chunk: string) => void;

  setStreaming: (streaming: boolean) => void;
  rehydrate: () => Promise<void>;
}

// ── Constants ──

const BT_SESSIONS_KEY = 'btai:sessions';

/** Hard cap on the number of sessions. Reaching it disables createSession. */
export const MAX_SESSIONS = 50;

const DEFAULT_NEW_TITLE = '新会话';
const AUTO_TITLE_MAX = 40;

// ── Helpers ──

function createEmptySession(): BtSession {
  return { id: generateId(), title: DEFAULT_NEW_TITLE, messages: [], createdAt: Date.now() };
}

/** Auto-title: when the first user message lands in a session still titled
 *  `DEFAULT_NEW_TITLE`, set the title to a truncated slice of the message. */
function maybeAutoTitle(session: BtSession, content: string): string {
  if (session.title !== DEFAULT_NEW_TITLE) return session.title;
  const trimmed = content.trim();
  if (!trimmed) return session.title;
  return trimmed.length > AUTO_TITLE_MAX ? `${trimmed.slice(0, AUTO_TITLE_MAX)}…` : trimmed;
}

function updateSession(
  sessions: BtSession[],
  id: string,
  updater: (s: BtSession) => BtSession,
): BtSession[] {
  return sessions.map((s) => (s.id === id ? updater(s) : s));
}

// ── Persistence (debounced) ──

const PERSIST_DELAY = 300;
const schedulePersist = debounce(
  (payload: PersistedBt) => { void storageClient.set(BT_SESSIONS_KEY, payload); },
  PERSIST_DELAY,
);

// ── Store ──

export const useBubbleTemplateChatStore = create<BtState>((set, get) => ({
  sessions: [],
  activeSessionId: null,
  streaming: false,
  loaded: false,

  createSession: () => {
    const state = get();
    if (state.sessions.length >= MAX_SESSIONS) return '';
    const session = createEmptySession();
    const sessions = [session, ...state.sessions];
    const payload: PersistedBt = { sessions, activeSessionId: session.id };
    set({ sessions, activeSessionId: session.id });
    schedulePersist(payload);
    return session.id;
  },

  switchSession: (id) => {
    const state = get();
    if (!state.sessions.some((s) => s.id === id)) return;
    const payload: PersistedBt = { sessions: state.sessions, activeSessionId: id };
    set({ activeSessionId: id });
    schedulePersist(payload);
  },

  deleteSession: (id) => {
    const state = get();
    const remaining = state.sessions.filter((s) => s.id !== id);
    let nextActiveId = state.activeSessionId;
    let sessions = remaining;
    if (remaining.length === 0) {
      const fresh = createEmptySession();
      sessions = [fresh];
      nextActiveId = fresh.id;
    } else if (state.activeSessionId === id) {
      nextActiveId = remaining[0].id;
    }
    const payload: PersistedBt = { sessions, activeSessionId: nextActiveId };
    set({ sessions, activeSessionId: nextActiveId });
    schedulePersist(payload);
  },

  renameSession: (id, title) => {
    const state = get();
    const trimmed = title.trim();
    const sessions = updateSession(state.sessions, id, (s) => ({ ...s, title: trimmed }));
    const payload: PersistedBt = { sessions, activeSessionId: state.activeSessionId };
    set({ sessions });
    schedulePersist(payload);
  },

  addMessage: (sessionId, msg) => {
    const state = get();
    const sessions = updateSession(state.sessions, sessionId, (s) => {
      const messages = [...s.messages, msg];
      const title =
        msg.role === 'user' && s.messages.length === 0 ? maybeAutoTitle(s, msg.content) : s.title;
      return { ...s, messages, title };
    });
    const payload: PersistedBt = { sessions, activeSessionId: state.activeSessionId };
    set({ sessions });
    schedulePersist(payload);
  },

  appendToLastMessage: (sessionId, chunk) => {
    const state = get();
    const sessions = updateSession(state.sessions, sessionId, (s) => {
      if (s.messages.length === 0) return s; // no-op guard
      const messages = [...s.messages];
      const last = messages[messages.length - 1];
      messages[messages.length - 1] = { ...last, content: last.content + chunk };
      return { ...s, messages };
    });
    const payload: PersistedBt = { sessions, activeSessionId: state.activeSessionId };
    set({ sessions });
    schedulePersist(payload);
  },

  appendToLastMessageThinking: (sessionId, chunk) => {
    const state = get();
    const sessions = updateSession(state.sessions, sessionId, (s) => {
      if (s.messages.length === 0) return s; // no-op guard
      const messages = [...s.messages];
      const last = messages[messages.length - 1];
      if (last.role !== 'assistant') return s; // thinking only on assistant
      const prev = last.thinking ?? '';
      messages[messages.length - 1] = { ...last, thinking: prev + chunk };
      return { ...s, messages };
    });
    const payload: PersistedBt = { sessions, activeSessionId: state.activeSessionId };
    set({ sessions });
    schedulePersist(payload);
  },

  setStreaming: (streaming) => set({ streaming }),

  rehydrate: async () => {
    if (get().loaded) return;
    try {
      const saved = await storageClient.get<PersistedBt>(BT_SESSIONS_KEY);
      if (saved && Array.isArray(saved.sessions) && saved.sessions.length > 0) {
        set({
          sessions: saved.sessions,
          activeSessionId:
            saved.activeSessionId && saved.sessions.some((s) => s.id === saved.activeSessionId)
              ? saved.activeSessionId
              : saved.sessions[0].id,
          loaded: true,
        });
        return;
      }
      const session = createEmptySession();
      set({ sessions: [session], activeSessionId: session.id, loaded: true });
    } catch (err) {
      console.warn('[bubbleTemplateChatStore] rehydrate failed:', err);
      set({ loaded: true });
    }
  },
}));
