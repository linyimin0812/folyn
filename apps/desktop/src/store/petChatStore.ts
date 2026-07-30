import { create } from 'zustand';
import { storageClient } from '@/utils/storageClient';
import { generateId } from '@/utils/idGenerator';
import { debounce } from '@/utils/debounce';
import {
  firstEnabledPair,
  resolvePairConfig,
  useAiConfigStore,
  type ResolvedPairConfig,
} from './aiConfigStore';

/**
 * PetChatStore — the pet-panel's independent, persisted AI chat sessions.
 *
 * Scope (PRD R6 / multi-session PR1): the pet-panel chat is a *vault-free*
 * mini chat. It owns its own per-session `CliAdapter` (see
 * `services/petChatService.ts`, wired in PR2), holds no vault grounding (no
 * file mentions, no wiki/clip toolbar), and persists only its session list
 * across app restarts. It does NOT touch `aiStore` or its per-vault session
 * persistence (`sessionStorage` / `aiSessionPersistence`). The pet session
 * model is intentionally a simpler, independent counterpart of AiPanel's —
 * same shape (sessions[] + activeSessionId + per-session cliSessionId), no
 * vault coupling.
 *
 * Persistence namespace: `pet-chat:sessions` in `storageClient` (the shared
 * Tauri-store-backed key/value cache used by `settingsPersistence`). The persisted
 * payload is `{ sessions, activeSessionId }`. The `streaming` flag is
 * runtime-only and is NOT persisted — if the app quits mid-stream, the
 * partial assistant message is retained as-is and the user can resend /
 * continue in the next session.
 *
 * Migration: on first load, if `pet-chat:sessions` is absent/empty but the
 * legacy `pet-chat:messages` key holds a non-empty `PetChatMessage[]`, that
 * flat list is wrapped into a single default session (title '默认会话') and
 * the legacy key is deleted. Existing history is never lost.
 *
 * Follows `.trellis/spec/desktop/frontend/state-management.md` (Zustand 5,
 * granular selectors, `getState()` for imperative contexts).
 */

// ── Types ──

export interface PetChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  ts: number;
  /** Reasoning / thinking text streamed from Claude / OpenAI reasoning
   *  models. Optional — absent on user messages and on assistant turns
   *  that produced no reasoning. Not round-tripped through the rig
   *  history on disk (chat.rs persists only `{role, content}`); this
   *  field is re-hydrated from `storageClient` only if previously
   *  persisted by the panel store. */
  thinking?: string;
  /** Provider id (e.g. 'anthropic', 'aliyun') stamped on assistant turns
   *  so ChatMessageList can render a pair tag like AiPanel. `string` not
   *  `ChatProvider` — petChatStore can't depend on the desktop provider
   *  catalog (same convention as cli-adapter's CliMessage). Optional —
   *  ask/agent mode (CLI adapter) leaves it unset and the tag is omitted.
   *  See .trellis/spec/desktop/frontend/type-safety.md "Cross-package type
   *  boundaries". */
  provider?: string;
  /** Model id stamped alongside `provider` for the pair tag. */
  model?: string;
}

export interface PetChatSession {
  id: string;
  title: string;
  messages: PetChatMessage[];
  /** CLI-assigned session id for resume (`resumeSessionId`). Undefined until
   *  the first `session_id` stream event lands for this session (PR2 writes
   *  it via `setCliSessionId`). Persisted so resume survives restarts. */
  cliSessionId?: string;
  /** The (provider, model) pair this session uses for sends. `string` not
   *  `ChatProvider` — petChatStore stays catalog-free (same convention as
   *  CliMessage / PetChatMessage.provider). Optional on legacy persisted
   *  sessions; createEmptySession seeds from the most-recent session's pair
   *  or firstEnabledPair. Set via setSessionPair. */
  provider?: string;
  /** Model id alongside `provider`. See `provider` doc above. */
  model?: string;
  createdAt: number;
}

interface PersistedPetChat {
  sessions: PetChatSession[];
  activeSessionId: string | null;
}

interface PetChatState {
  sessions: PetChatSession[];
  activeSessionId: string | null;
  /** True while a streamed assistant response is in flight for the active
   *  session. Runtime-only — NOT persisted. */
  streaming: boolean;
  /** Active AI mode for the pet panel ('agent' | 'ask' | 'chat'). Runtime-only
   *  (NOT persisted) — defaults to 'agent' to preserve the pre-chat behavior
   *  (bare bypassPermissions). 'chat' routes to the rig backend; the other two
   *  stay on the claude CLI adapter. Set by the PetChat mode dropdown. */
  inputMode: string;

  // ── Session actions ──
  /** Create a new empty session, switch active to it, return its id.
   *  Returns '' (no-op) when `sessions.length >= MAX_SESSIONS` — the UI
   *  checks length / the empty return to surface the cap. */
  createSession: () => string;
  switchSession: (id: string) => void;
  /** Remove a session. If it is the last one, auto-create an empty session
   *  and switch to it. Stopping the adapter is the SERVICE's job (PR2); the
   *  store only mutates state. */
  deleteSession: (id: string) => void;
  renameSession: (id: string, title: string) => void;

  // ── Message actions (target a specific session by id, NOT "active") ──
  /** Add a message to a session. `provider`+`model` are stamped on
   *  assistant turns (chat/rig mode only — ask/agent leave them unset)
   *  so ChatMessageList can render the pair tag. Optional — persisted
   *  on the message, optional on legacy blobs (type guard in rehydrate
   *  keeps old messages valid). */
  addMessage: (
    sessionId: string,
    role: 'user' | 'assistant',
    content: string,
    provider?: string,
    model?: string,
  ) => void;
  appendToLastMessage: (sessionId: string, chunk: string) => void;
  /** Append a thinking/reasoning chunk to the last message's `thinking`
   *  field (NOT `content`). Used for streaming Reasoning /
   *  ReasoningDelta events from rig. Same no-op guards as
   *  `appendToLastMessage` (no messages / last message isn't assistant). */
  appendToLastMessageThinking: (sessionId: string, chunk: string) => void;
  /** Clear the active session's messages. */
  clearActive: () => void;

  // ── Runtime / resume state ──
  setStreaming: (streaming: boolean) => void;
  /** Switch the pet panel's active AI mode. */
  setInputMode: (mode: string) => void;
  /** Write the CLI-assigned session id onto a session (PR2 calls this on the
   *  `session_id` stream event). Attributed by the sessionId that triggered
   *  the send — not "current active" — to avoid a late `session_id` polluting
   *  the wrong session after a switch. */
  setCliSessionId: (sessionId: string, cliSessionId: string) => void;

  /** Set the (provider, model) pair on a specific pet session. Writes only
   *  the session + persists. No-op if the session id is unknown. Mirrors
   *  aiStore.setSessionPair's shape (Phase 1 dropped the global dual-write). */
  setSessionPair: (sessionId: string, pair: { provider: string; model: string }) => void;
}

// ── Constants ──

const PET_CHAT_SESSIONS_KEY = 'pet-chat:sessions';
const PET_CHAT_LEGACY_KEY = 'pet-chat:messages';

/** Hard cap on the number of sessions the panel keeps. Reaching it disables
 *  `createSession` (no-op returning ''). */
export const MAX_SESSIONS = 50;

/** Title given to a freshly created (empty) session. */
const DEFAULT_NEW_TITLE = '新对话';
/** Title given to the session created by legacy-flat-list migration. */
const MIGRATED_TITLE = '默认会话';
/** Truncation length for auto-title from the first user message. */
const AUTO_TITLE_MAX = 20;

// ── Helpers ──

function createEmptySession(): PetChatSession {
  // Seed the pair from the most-recent session (sessions[0] — new sessions
  // are unshifted to the front), else fall back to firstEnabledPair. No
  // global "last used pair" role post-Phase 2 — petPair global is gone.
  const existing = usePetChatStore.getState().sessions;
  const recent = existing.length > 0 ? existing[0] : undefined;
  const fallback = firstEnabledPair(useAiConfigStore.getState());
  return {
    id: generateId(),
    title: DEFAULT_NEW_TITLE,
    messages: [],
    createdAt: Date.now(),
    provider: recent?.provider ?? fallback?.provider,
    model: recent?.model ?? fallback?.model,
  };
}

/** Auto-title: when the first user message lands in a session still titled
 *  `DEFAULT_NEW_TITLE`, set the title to a truncated slice of the message. */
function maybeAutoTitle(session: PetChatSession, content: string): string {
  if (session.title !== DEFAULT_NEW_TITLE) return session.title;
  if (!content) return session.title;
  const trimmed = content.trim();
  if (!trimmed) return session.title;
  return trimmed.length > AUTO_TITLE_MAX
    ? `${trimmed.slice(0, AUTO_TITLE_MAX)}…`
    : trimmed;
}

/** Pure migration: wrap a legacy flat message list into a single default
 *  session. Exported for unit testing. */
export function migrateFromLegacy(
  messages: PetChatMessage[],
): PersistedPetChat {
  const now = Date.now();
  const session: PetChatSession = {
    id: generateId(),
    title: MIGRATED_TITLE,
    messages: messages.slice(),
    createdAt: messages.length > 0 ? messages[0].ts : now,
  };
  return { sessions: [session], activeSessionId: session.id };
}

function updateSession(
  sessions: PetChatSession[],
  id: string,
  updater: (s: PetChatSession) => PetChatSession,
): PetChatSession[] {
  return sessions.map((s) => (s.id === id ? updater(s) : s));
}

// ── Persistence (debounced) ──

const PERSIST_DELAY = 300;
const schedulePersist = debounce(
  (payload: PersistedPetChat) => { void storageClient.set(PET_CHAT_SESSIONS_KEY, payload); },
  PERSIST_DELAY,
);

// ── Store ──

export const usePetChatStore = create<PetChatState>((set, get) => ({
  sessions: [],
  activeSessionId: null,
  streaming: false,
  inputMode: 'agent',

  createSession: () => {
    const state = get();
    if (state.sessions.length >= MAX_SESSIONS) {
      // Cap reached: no-op. Return '' so the caller can detect refusal.
      return '';
    }
    const session = createEmptySession();
    const sessions = [session, ...state.sessions];
    const payload: PersistedPetChat = { sessions, activeSessionId: session.id };
    set({ sessions, activeSessionId: session.id });
    schedulePersist(payload);
    return session.id;
  },

  switchSession: (id) => {
    const state = get();
    if (!state.sessions.some((s) => s.id === id)) return;
    const payload: PersistedPetChat = { sessions: state.sessions, activeSessionId: id };
    set({ activeSessionId: id });
    schedulePersist(payload);
  },

  deleteSession: (id) => {
    const state = get();
    const remaining = state.sessions.filter((s) => s.id !== id);
    let nextActiveId = state.activeSessionId;
    let sessions = remaining;
    if (remaining.length === 0) {
      // Deleted the last session → auto-create an empty one and switch to it.
      const fresh = createEmptySession();
      sessions = [fresh];
      nextActiveId = fresh.id;
    } else if (state.activeSessionId === id) {
      nextActiveId = remaining[0].id;
    }
    const payload: PersistedPetChat = { sessions, activeSessionId: nextActiveId };
    set({ sessions, activeSessionId: nextActiveId });
    schedulePersist(payload);
  },

  renameSession: (id, title) => {
    const state = get();
    const trimmed = title.trim();
    const sessions = updateSession(state.sessions, id, (s) => ({ ...s, title: trimmed }));
    const payload: PersistedPetChat = { sessions, activeSessionId: state.activeSessionId };
    set({ sessions });
    schedulePersist(payload);
  },

  addMessage: (sessionId, role, content, provider, model) => {
    const state = get();
    const msg: PetChatMessage = {
      id: generateId(),
      role,
      content,
      ts: Date.now(),
      ...(provider !== undefined ? { provider } : {}),
      ...(model !== undefined ? { model } : {}),
    };
    const sessions = updateSession(state.sessions, sessionId, (s) => {
      const messages = [...s.messages, msg];
      // Auto-title only on the first user message in an untitled session.
      const title =
        role === 'user' && s.messages.length === 0 ? maybeAutoTitle(s, content) : s.title;
      return { ...s, messages, title };
    });
    const payload: PersistedPetChat = { sessions, activeSessionId: state.activeSessionId };
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
    const payload: PersistedPetChat = { sessions, activeSessionId: state.activeSessionId };
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
    const payload: PersistedPetChat = { sessions, activeSessionId: state.activeSessionId };
    set({ sessions });
    schedulePersist(payload);
  },

  clearActive: () => {
    const state = get();
    if (!state.activeSessionId) return;
    const sessions = updateSession(state.sessions, state.activeSessionId, (s) => ({
      ...s,
      messages: [],
    }));
    const payload: PersistedPetChat = { sessions, activeSessionId: state.activeSessionId };
    set({ sessions });
    schedulePersist(payload);
  },

  setStreaming: (streaming) => set({ streaming }),
  setInputMode: (mode) => set({ inputMode: mode }),

  setCliSessionId: (sessionId, cliSessionId) => {
    const state = get();
    const sessions = updateSession(state.sessions, sessionId, (s) => ({
      ...s,
      cliSessionId,
    }));
    const payload: PersistedPetChat = { sessions, activeSessionId: state.activeSessionId };
    set({ sessions });
    schedulePersist(payload);
  },

  setSessionPair: (sessionId, pair) => {
    const state = get();
    if (!state.sessions.some((s) => s.id === sessionId)) return;
    const sessions = updateSession(state.sessions, sessionId, (s) => ({
      ...s,
      provider: pair.provider,
      model: pair.model,
    }));
    const payload: PersistedPetChat = { sessions, activeSessionId: state.activeSessionId };
    set({ sessions });
    schedulePersist(payload);
  },
}));

/** Resolve a pet session's pair into the connection params a caller needs
 *  to invoke runRigChat. Reads the session from petChatStore, then delegates
 *  to resolvePairConfig. Returns null when the session has no pair, the
 *  provider slot is missing, or a key-required provider has no apiKey.
 *  Mirrors aiConfigStore.resolvePairForSession — keeps the deep-pair
 *  interface symmetric across the three session-based callers. */
export function resolvePairForPetSession(
  sessionId: string,
): ResolvedPairConfig | null {
  const session = usePetChatStore.getState().sessions.find((s) => s.id === sessionId);
  if (!session || !session.provider || !session.model) return null;
  return resolvePairConfig(
    { provider: session.provider, model: session.model },
  );
}

// ── Rehydrate / migrate on launch ──

/** Load persisted sessions (or migrate from the legacy flat list). Failures
 *  are logged and swallowed — a corrupt cache must not crash the panel. On
 *  the absent-everything path, a single empty default session is created. */
async function rehydrate(): Promise<void> {
  try {
    const saved = await storageClient.get<PersistedPetChat>(PET_CHAT_SESSIONS_KEY);
    if (saved && Array.isArray(saved.sessions) && saved.sessions.length > 0) {
      usePetChatStore.setState({
        sessions: saved.sessions,
        activeSessionId:
          saved.activeSessionId && saved.sessions.some((s) => s.id === saved.activeSessionId)
            ? saved.activeSessionId
            : saved.sessions[0].id,
        // streaming is runtime-only — always false on rehydrate.
      });
      return;
    }

    // Legacy migration: wrap the old flat `pet-chat:messages` list.
    const legacy = await storageClient.get<PetChatMessage[]>(PET_CHAT_LEGACY_KEY);
    if (Array.isArray(legacy) && legacy.length > 0) {
      const migrated = migrateFromLegacy(legacy);
      usePetChatStore.setState({
        sessions: migrated.sessions,
        activeSessionId: migrated.activeSessionId,
      });
      // Persist immediately (storageClient.set is itself debounced at the
      // flush layer) so the migrated state is durable even if the app quits
      // within the action-level debounce window. Then clean up the legacy
      // key now that history has been wrapped.
      void storageClient.set(PET_CHAT_SESSIONS_KEY, migrated);
      void storageClient.remove(PET_CHAT_LEGACY_KEY);
      return;
    }

    // Nothing persisted yet → seed one empty default session.
    const session = createEmptySession();
    usePetChatStore.setState({ sessions: [session], activeSessionId: session.id });
  } catch (err) {
    console.warn('[petChatStore] rehydrate failed:', err);
  }
}

void rehydrate();
