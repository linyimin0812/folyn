import { CliAdapterRegistry } from '@quill/cli-adapter';
import type { CliAdapter, CliStreamEvent } from '@quill/cli-adapter';
import { useSettingsStore } from '@/store/settingsStore';
import { usePetChatStore } from '@/store/petChatStore';
import { isTauri } from '@/utils/platform';
import { appDataDir, join } from '@tauri-apps/api/path';

/**
 * PetChatService — the pet-panel's self-hosted AI chat pipeline.
 *
 * The pet-panel chat is vault-free (PRD R6): it does NOT use `aiStore`,
 * `adapterManager`, or any vault-grounded send options. Instead it creates
 * its own `CliAdapter` instances via `CliAdapterRegistry.getInstance()
 * .create(...)`, starts them in a neutral temp dir (NOT the vault), and
 * streams plain text in/out. This mirrors the adapter-creation pattern in
 * `clipService` / `planMyDayService` / `wikiIngestService` but with no vault
 * dependency. It does NOT import `ai/adapterManager` — the per-session Map
 * is replicated locally to preserve pet-panel window isolation.
 *
 * Multi-session (PR2): the service owns a **per-session adapter Map**
 * (`Map<sessionId, CliAdapter>`), mirroring `adapterManager`'s shape. Each
 * session gets its own adapter so the `claudeAdapter`'s internal
 * `this.sessionId` resume-fallback never leaks across sessions (a shared
 * adapter would let a new session's first send fall back to the previous
 * session's id — "串台"). Each session's `cliSessionId` is persisted on the
 * session record by `petChatStore.setCliSessionId` and fed back as
 * `resumeSessionId` on the next send, giving true cross-turn memory within a
 * session. `bare: true` is preserved (it controls system-prompt / agent
 * discovery only; memory comes from `resumeSessionId` — the two are
 * orthogonal).
 *
 * Race prevention: the `onEvent` handler registered for a send is **closed
 * over the sessionId that triggered the send** — NOT "current active". So if
 * the user switches sessions mid-stream, a late `session_id` event still
 * attributes to the session that sent the prompt, never polluting the
 * now-active session. See `sendPetChatMessage`.
 *
 * Lifecycle: adapters are created lazily on first send for a session and
 * cached in the Map. `stopPetChat(sessionId)` stops one;
 * `resetPetChatAdapter(sessionId?)` stops + drops one (delete) or all
 * (window unmount). The adapter id follows `settings.cliAdapter`; if the
 * user switches adapter type, the next `getAdapterForSession` call stops the
 * stale adapter and creates a fresh one.
 */

/** Per-session adapter cache. Keyed by pet session id (NOT cli session id).
 *  The adapter instances are non-serializable, so they live in this module
 *  (NOT on the store). Mirrors `adapterManager.sessionAdapters`. */
const sessionAdapters = new Map<string, CliAdapter>();

/** Get or create the adapter for a session. If a cached adapter exists AND
 *  its `id` matches `settings.cliAdapter`, reuse it; otherwise stop the
 *  stale adapter (so no orphan process lingers) and create a fresh one.
 *
 *  The id check mirrors `adapterManager.getAdapterForSession`'s
 *  `existing.id === settings.cliAdapter` guard. */
function getAdapterForSession(sessionId: string): CliAdapter {
  const settings = useSettingsStore.getState();
  const id = settings.cliAdapter || 'claude';
  const existing = sessionAdapters.get(sessionId);
  if (existing && existing.id === id) return existing;

  // Adapter type changed (or first creation): stop the stale one before
  // replacing so we don't leave an orphaned child process.
  if (existing) {
    void existing.stop().catch((err) => {
      console.warn('[petChat] stale adapter stop failed:', err);
    });
  }
  const registry = CliAdapterRegistry.getInstance();
  const adapter = registry.create(id);
  sessionAdapters.set(sessionId, adapter);
  return adapter;
}

/** Resolve a neutral working directory that is NOT the vault. Uses the
 *  app-data dir + `pet-chat-tmp` so the CLI has a stable cwd with no
 *  project CLAUDE.md / `.claude/agents/` discovery (the send options use
 *  `bare: true` to enforce isolation). The dir is shared across sessions —
 *  resume is by `cliSessionId`, not by cwd.
 *
 *  The directory is created (recursive) before it is handed to
 *  `adapter.start()` — the claude adapter spawns `/bin/sh -c 'cd <dir> && …'`
 *  and `cd` fails if the dir does not exist (symptom:
 *  `cd: …/pet-chat-tmp: No such file or directory`). `fs:allow-mkdir` +
 *  `fs:create-app-specific-dirs` + `fs:scope-appdata-recursive` are granted
 *  in `capabilities/pet-panel.json`.
 *
 *  Fallback chain (never throws — a missing workingDir must not break the
 *  chat, the adapter can run with `cd` skipped):
 *    1. mkdir(<appData>/pet-chat-tmp, { recursive: true }) → return that path.
 *    2. mkdir failed → return <appData> itself (always exists; Tauri creates
 *       it on startup).
 *    3. appDataDir() failed → return '' (empty string → adapter skips `cd`
 *       and just `exec`s the CLI in the process cwd).
 */
async function resolveWorkingDir(): Promise<string> {
  if (!isTauri()) return '';
  let appData: string;
  try {
    appData = await appDataDir();
  } catch (err) {
    console.warn('[petChat] appDataDir failed; proceeding without workingDir:', err);
    return '';
  }
  let dir: string;
  try {
    dir = await join(appData, 'pet-chat-tmp');
  } catch (err) {
    console.warn('[petChat] join failed; falling back to appDataDir:', err);
    return appData;
  }
  try {
    const { mkdir } = await import('@tauri-apps/plugin-fs');
    await mkdir(dir, { recursive: true });
    return dir;
  } catch (err) {
    console.warn(
      '[petChat] mkdir pet-chat-tmp failed; falling back to appDataDir:',
      err,
    );
    return appData;
  }
}

export interface PetChatSendHandlers {
  onToken?: (text: string) => void;
  onDone?: () => void;
  onError?: (msg: string) => void;
}

/** Read the persisted CLI session id for a pet session (for resume). Returns
 *  `undefined` until the first `session_id` stream event has landed for that
 *  session. Reads from the store (NOT a module-local cache) so it reflects
 *  the latest `setCliSessionId` write. */
function getCliSessionIdFor(sessionId: string): string | undefined {
  const session = usePetChatStore.getState().sessions.find((s) => s.id === sessionId);
  return session?.cliSessionId;
}

/** Send a plain-text prompt and stream the assistant reply for a specific
 *  session. The caller supplies `onToken` (append to the assistant message)
 *  and `onDone` / `onError` lifecycle hooks.
 *
 *  Send options: `bare: true` (no cwd agent discovery, no vault system
 *  prompt) + `resumeSessionId` (the session's persisted `cliSessionId`, if
 *  any) so the CLI resumes the same conversation within the session. The
 *  CLI's default system prompt applies; memory comes from resume, NOT from
 *  a vault-grounded system prompt.
 *
 *  Event attribution: the `onEvent` handler is **closed over `sessionId`**
 *  (the send's session) — `session_id` writes via `setCliSessionId(sessionId,
 *  …)` always target the send's session, never "current active". This
 *  prevents a late `session_id` from polluting another session after a
 *  mid-stream switch.
 *
 *  Returns when the stream completes (`done` event) or throws on `error`
 *  (the handler is deregistered in both terminal cases). */
export async function sendPetChatMessage(
  sessionId: string,
  prompt: string,
  handlers: PetChatSendHandlers,
): Promise<void> {
  const settings = useSettingsStore.getState();
  const adapter = getAdapterForSession(sessionId);
  const workingDir = await resolveWorkingDir();
  const resumeSessionId = getCliSessionIdFor(sessionId);

  // Closed over `sessionId` — NOT re-read from the store at event time.
  // This is the race-prevention contract: even if the user switches the
  // active session before a `session_id` event fires, the event attributes
  // to the session that sent the prompt.
  const handler = (event: CliStreamEvent) => {
    if (event.type === 'text' && event.content) {
      handlers.onToken?.(event.content);
    } else if (event.type === 'session_id' && event.sessionId) {
      usePetChatStore.getState().setCliSessionId(sessionId, event.sessionId);
    } else if (event.type === 'error') {
      adapter.offEvent(handler);
      handlers.onError?.(event.content || 'LLM error');
    } else if (event.type === 'done') {
      adapter.offEvent(handler);
      handlers.onDone?.();
    }
    // thinking / tool_start / tool_end / file_change → ignored (pet is
    // vault-free, bare; no UI surface for them). Silently dropped.
  };
  adapter.onEvent(handler);

  try {
    await adapter.start({ cliPath: settings.cliPath, workingDir });
    await adapter.send(prompt, { bare: true, resumeSessionId });
  } catch (err) {
    adapter.offEvent(handler);
    throw err;
  }
}

/** Stop the active adapter stream for a specific session (user clicked
 *  Stop). Safe no-op if the session has no adapter or it is not running. */
export async function stopPetChat(sessionId: string): Promise<void> {
  const adapter = sessionAdapters.get(sessionId);
  if (!adapter) return;
  try {
    await adapter.stop();
  } catch (err) {
    console.warn('[petChat] stop failed:', err);
  }
}

/** Drop the cached adapter for a session (call on session delete) or ALL
 *  adapters (call on window unmount). `stop()`s the adapter(s) first so no
 *  child process outlives the panel.
 *
 *  - `sessionId` given → stop + delete that one (used when deleting a
 *    session; the store has already removed the session record).
 *  - `sessionId` undefined → stop + clear the whole Map (used on PetChat
 *    unmount / panel hide so the next mount starts fresh). */
export async function resetPetChatAdapter(sessionId?: string): Promise<void> {
  if (sessionId !== undefined) {
    const adapter = sessionAdapters.get(sessionId);
    if (!adapter) return;
    try {
      await adapter.stop();
    } catch (err) {
      console.warn('[petChat] reset stop failed:', err);
    }
    sessionAdapters.delete(sessionId);
    return;
  }
  for (const adapter of sessionAdapters.values()) {
    try {
      await adapter.stop();
    } catch (err) {
      console.warn('[petChat] reset-all stop failed:', err);
    }
  }
  sessionAdapters.clear();
}

/** Test-only access to the live adapter for a session. Used by the service
 *  unit tests to assert per-session isolation / id invalidation without
 *  reaching into the `CliAdapterRegistry` mock. Not part of the public
 *  runtime API. */
export function __getAdapterForTesting(sessionId: string): CliAdapter | undefined {
  return sessionAdapters.get(sessionId);
}
