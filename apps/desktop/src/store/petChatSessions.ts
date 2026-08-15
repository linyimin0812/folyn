import { readTextFile, writeTextFile, mkdir, exists, readDir, remove } from '@tauri-apps/plugin-fs';
import { homeDir, join } from '@tauri-apps/api/path';
import { useAiStore } from './aiStore';
import type { AiSession } from './aiStore';
import { useAiConfigStore, firstEnabledPair } from './aiConfigStore';
import { generateId } from '@/utils/idGenerator';

// ── Pet chat session storage (SEPARATE from the main AI panel) ──
// The main window's AI panel persists its sessions to ~/.quill/vaults/<vaultId>/
// (vault-scoped, via aiSessionPersistence.ts). The pet-panel chat is its OWN
// conversation surface, so it persists to ~/.quill/pet-chat/ instead — the two
// never read or write the same session files. The MAIN window is the single
// writer (it owns the $HOME fs ACL); the pet-panel mirrors these sessions over
// events and forwards its own mutations back (host + mirror below).

let basePath = '';

async function getBasePath(): Promise<string> {
  if (basePath) return basePath;
  const home = await homeDir();
  basePath = await join(home, '.quill', 'pet-chat');
  return basePath;
}

async function ensureDir(): Promise<void> {
  const dir = await getBasePath();
  if (!(await exists(dir))) {
    await mkdir(dir, { recursive: true });
  }
}

/** Minimal file-backed store mirroring sessionStorage's shape, but rooted at
 *  ~/.quill/pet-chat/ with NO vault subdirectory (pet chat is vault-free). */
const petChatStorage = {
  async saveSession(sessionId: string, data: unknown): Promise<void> {
    await ensureDir();
    const filePath = await join(await getBasePath(), `${sessionId}.json`);
    await writeTextFile(filePath, JSON.stringify(data));
  },

  async loadSession<T>(sessionId: string): Promise<T | null> {
    const filePath = await join(await getBasePath(), `${sessionId}.json`);
    try {
      if (!(await exists(filePath))) return null;
      return JSON.parse(await readTextFile(filePath)) as T;
    } catch {
      return null;
    }
  },

  async deleteSession(sessionId: string): Promise<void> {
    const filePath = await join(await getBasePath(), `${sessionId}.json`);
    try {
      if (await exists(filePath)) await remove(filePath);
    } catch {
      // Missing file is the target state.
    }
  },

  async listSessionIds(): Promise<string[]> {
    try {
      if (!(await exists(await getBasePath()))) return [];
      const entries = await readDir(await getBasePath());
      return entries
        .filter((e) => e.name?.endsWith('.json') && e.name !== '_meta.json')
        .map((e) => e.name!.replace('.json', ''));
    } catch {
      return [];
    }
  },

  async saveMeta(meta: { activeSessionId: string | null }): Promise<void> {
    await ensureDir();
    const filePath = await join(await getBasePath(), '_meta.json');
    await writeTextFile(filePath, JSON.stringify(meta));
  },

  async loadMeta(): Promise<{ activeSessionId: string | null } | null> {
    const filePath = await join(await getBasePath(), '_meta.json');
    try {
      if (!(await exists(filePath))) return null;
      return JSON.parse(await readTextFile(filePath)) as { activeSessionId: string | null };
    } catch {
      return null;
    }
  },
};

// Authoritative in-memory pet-chat state (MAIN window only). The pet-panel
// keeps its own copy inside its own `useAiStore` instance and forwards its
// mutations here via `pet://pet-chat-sessions-sync`.
let petSessions: AiSession[] = [];
let petActiveId: string | null = null;

function stripStreaming(s: AiSession): Omit<AiSession, 'isStreaming'> {
  const { isStreaming: _, ...data } = s;
  return data;
}

/** Seed a fresh pet-chat session from the provider CONFIG only — never from
 *  the main AI panel's sessions. Pet chat is a decoupled surface: it starts
 *  with the first enabled pair and defaults to 'chat' mode (mode omitted →
 *  'chat' at the read site) regardless of what the main AI panel last used. */
function createEmptyPetSession(): AiSession {
  const now = Date.now();
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
    provider: fallback?.provider,
    model: fallback?.model,
  };
}

async function persistPetChatSessions(): Promise<void> {
  await petChatStorage.saveMeta({ activeSessionId: petActiveId });
  for (const session of petSessions) {
    await petChatStorage.saveSession(session.id, stripStreaming(session));
  }
  // Prune on-disk files for sessions the pet-panel deleted.
  const ids = await petChatStorage.listSessionIds();
  for (const id of ids) {
    if (!petSessions.some((s) => s.id === id)) {
      await petChatStorage.deleteSession(id);
    }
  }
}

/** Load persisted pet-chat sessions (or seed a single empty one). MAIN-window
 *  only — called by startPetChatSessionsHost before the first broadcast. */
export async function loadPetChatSessions(): Promise<void> {
  let ids = await petChatStorage.listSessionIds();

  if (ids.length === 0) {
    const session = createEmptyPetSession();
    petSessions = [session];
    petActiveId = session.id;
    await petChatStorage.saveSession(session.id, stripStreaming(session));
    await petChatStorage.saveMeta({ activeSessionId: session.id });
    return;
  }

  const sessions: AiSession[] = [];
  for (const id of ids) {
    const data = await petChatStorage.loadSession<Omit<AiSession, 'isStreaming'>>(id);
    if (data) sessions.push({ ...data, isStreaming: false });
  }

  if (sessions.length === 0) {
    const session = createEmptyPetSession();
    petSessions = [session];
    petActiveId = session.id;
    await petChatStorage.saveSession(session.id, stripStreaming(session));
    await petChatStorage.saveMeta({ activeSessionId: session.id });
    return;
  }

  sessions.sort((a, b) => b.createdAt - a.createdAt);
  const meta = await petChatStorage.loadMeta();
  petActiveId = meta?.activeSessionId && sessions.some((s) => s.id === meta.activeSessionId)
    ? meta.activeSessionId
    : sessions[0].id;
  petSessions = sessions;
}

interface PetChatPayload {
  sessions: AiSession[];
  activeSessionId: string | null;
}

function isPetChatPayload(p: unknown): p is PetChatPayload {
  return (
    !!p &&
    typeof p === 'object' &&
    Array.isArray((p as { sessions?: unknown }).sessions)
  );
}

/** MAIN-window only. Host the pet chat's authoritative sessions: load them,
 *  push snapshots to the pet-panel on `pet://pet-chat-sessions-request`, and
 *  apply + persist `pet://pet-chat-sessions-sync` mutations forwarded by the
 *  panel. Mirrors the file-tree/providers broadcast pattern. */
export function startPetChatSessionsHost(): () => void {
  let stopped = false;

  const emit = async () => {
    if (stopped) return;
    try {
      const { emit } = await import('@tauri-apps/api/event');
      await emit('pet://pet-chat-sessions-updated', { sessions: petSessions, activeSessionId: petActiveId });
    } catch {
      // Non-tauri (tests) or emit failed — non-fatal.
    }
  };

  // Load persisted sessions, then push the first snapshot. The pet-panel
  // opens on user click (long after startup), so this load has finished well
  // before its first `pet://pet-chat-sessions-request`.
  void loadPetChatSessions().then(() => {
    void emit();
  });

  let reqUnlisten: (() => void) | undefined;
  let syncUnlisten: (() => void) | undefined;
  (async () => {
    if (stopped) return;
    try {
      const { listen } = await import('@tauri-apps/api/event');
      reqUnlisten = await listen('pet://pet-chat-sessions-request', () => {
        void emit();
      });
      syncUnlisten = await listen('pet://pet-chat-sessions-sync', (event) => {
        if (!isPetChatPayload(event.payload)) return;
        petSessions = event.payload.sessions;
        petActiveId = event.payload.activeSessionId ?? null;
        void persistPetChatSessions();
        void emit();
      });
    } catch {
      // Non-tauri (tests) or listen failed — non-fatal.
    }
  })();

  return () => {
    stopped = true;
    reqUnlisten?.();
    syncUnlisten?.();
  };
}

/** PET-PANEL only. Mirror the main window's pet-chat sessions into this
 *  window's `useAiStore`, and forward LOCAL mutations back to the main window
 *  (which persists them). The `synced` gate stops the empty local store from
 *  clobbering the host before the first snapshot; `applyingRemote` stops a
 *  received snapshot from echoing straight back. */
export function startPetChatMirror(): () => void {
  let stopped = false;
  let synced = false;
  let applyingRemote = false;

  const forward = async () => {
    if (stopped) return;
    try {
      const { emit } = await import('@tauri-apps/api/event');
      const { sessions, activeSessionId } = useAiStore.getState();
      await emit('pet://pet-chat-sessions-sync', { sessions, activeSessionId });
    } catch {
      // Non-tauri (tests) or emit failed — non-fatal.
    }
  };

  let timer: ReturnType<typeof setTimeout> | null = null;
  const unsub = useAiStore.subscribe((state, prev) => {
    if (applyingRemote || !synced) return;
    if (state.sessions !== prev.sessions || state.activeSessionId !== prev.activeSessionId) {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        void forward();
      }, 300);
    }
  });

  let unlisten: (() => void) | undefined;
  (async () => {
    if (stopped) return;
    try {
      const { listen, emit } = await import('@tauri-apps/api/event');
      unlisten = await listen('pet://pet-chat-sessions-updated', (event) => {
        if (!isPetChatPayload(event.payload)) return;
        applyingRemote = true;
        useAiStore.setState({
          sessions: event.payload.sessions,
          activeSessionId: event.payload.activeSessionId ?? null,
        });
        applyingRemote = false;
        synced = true;
      });
      // The host's initial emit may have fired before this panel's listener
      // registered — ask for the current snapshot.
      await emit('pet://pet-chat-sessions-request', {});
    } catch {
      // Non-tauri (tests) or listen failed — non-fatal.
    }
  })();

  return () => {
    stopped = true;
    unsub();
    unlisten?.();
    if (timer) clearTimeout(timer);
  };
}
