import { create } from 'zustand';
import { storageClient } from '@/utils/storageClient';
import { generateId } from '@/utils/idGenerator';

/**
 * PetChatStore — the pet-panel's independent, persisted AI chat session.
 *
 * Scope (PRD R6 / PR3): the pet-panel chat is a *vault-free* mini chat. It
 * owns its own `CliAdapter` (see `services/petChatService.ts`), holds no
 * vault grounding (no file mentions, no wiki/clip toolbar), and persists
 * only its message list across app restarts. It does NOT touch `aiStore`
 * or its per-vault session persistence (`sessionStorage` / `aiSessionPersistence`).
 *
 * Persistence namespace: `pet-chat:messages` in `storageClient` (the shared
 * Tauri-store-backed key/value cache used by `settingsStore`). The
 * `streaming` flag is runtime-only and is NOT persisted — if the app quits
 * mid-stream, the partial assistant message is retained as-is and the user
 * can resend / continue in the next session.
 *
 * Follows `.trellis/spec/desktop/frontend/state-management.md` (Zustand 5,
 * granular selectors, `getState()` for imperative contexts).
 */

export interface PetChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  ts: number;
}

interface PetChatState {
  messages: PetChatMessage[];
  /** True while a streamed assistant response is in flight. Runtime-only —
   *  not persisted (a quit mid-stream leaves the partial message as-is). */
  streaming: boolean;

  addMessage: (role: 'user' | 'assistant', content: string) => void;
  appendToLastMessage: (token: string) => void;
  clear: () => void;
  setStreaming: (streaming: boolean) => void;
}

const PET_CHAT_STORAGE_KEY = 'pet-chat:messages';

/** Debounced persist of the message list. Debounce avoids one disk write
 *  per streamed token; `appendToLastMessage` fires per-chunk. */
let persistTimer: ReturnType<typeof setTimeout> | null = null;
const PERSIST_DELAY = 300;
function schedulePersist(messages: PetChatMessage[]): void {
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    void storageClient.set(PET_CHAT_STORAGE_KEY, messages);
  }, PERSIST_DELAY);
}

export const usePetChatStore = create<PetChatState>((set) => ({
  messages: [],
  streaming: false,

  addMessage: (role, content) => {
    const msg: PetChatMessage = { id: generateId(), role, content, ts: Date.now() };
    set((state) => {
      const messages = [...state.messages, msg];
      schedulePersist(messages);
      return { messages };
    });
  },

  appendToLastMessage: (token) => {
    set((state) => {
      if (state.messages.length === 0) return state;
      const msgs = [...state.messages];
      const last = msgs[msgs.length - 1];
      msgs[msgs.length - 1] = { ...last, content: last.content + token };
      schedulePersist(msgs);
      return { messages: msgs };
    });
  },

  clear: () => {
    set({ messages: [] });
    void storageClient.remove(PET_CHAT_STORAGE_KEY);
  },

  setStreaming: (streaming) => set({ streaming }),
}));

/** Rehydrate the pet chat message list from `storageClient` on launch.
 *  Streaming state is NOT restored (runtime-only). Failures are logged and
 *  swallowed — a corrupt cache must not crash the panel. */
storageClient
  .get<PetChatMessage[]>(PET_CHAT_STORAGE_KEY)
  .then((saved) => {
    if (Array.isArray(saved) && saved.length > 0) {
      usePetChatStore.setState({ messages: saved });
    }
  })
  .catch((err) => {
    console.warn('[petChatStore] rehydrate failed:', err);
  });
