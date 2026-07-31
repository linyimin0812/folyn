import { createAdapter } from '@quill/cli-adapter';
import type { CliAdapter, CliStreamEvent } from '@quill/cli-adapter';
import { useAiConfigStore } from '@/store/aiConfigStore';
import { resolvePairForPetSession } from '@/store/petChatStore';
import { useVaultConfigStore } from '@/store/vaultConfigStore';
import { usePetChatStore } from '@/store/petChatStore';
import { isRigMode, resolveSendOptions } from '@/components/ai/inputModes';
import { runRigChat } from '@/services/rigChat';
import { isTauri } from '@/utils/platform';
import { appDataDir, join } from '@tauri-apps/api/path';
import { resolveBasePath } from '@/utils/pathResolver';

/**
 * PetChatService — the pet-panel's self-hosted AI chat pipeline.
 *
 * The pet-panel chat is vault-free (PRD R6): it does NOT use `aiStore`,
 * `adapterManager`, or any vault-grounded send options. Instead it creates
 * its own `CliAdapter` instances via `createAdapter(...)`, and
 * streams plain text in/out. cwd depends on mode: `chat` (rig) has none; This mirrors the adapter-creation pattern in
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
 *  `existing.id === aiConfig.cliAdapter` guard. */
function getAdapterForSession(sessionId: string): CliAdapter {
  const id = useAiConfigStore.getState().cliAdapter || 'claude';
  const existing = sessionAdapters.get(sessionId);
  if (existing && existing.id === id) return existing;

  // Adapter type changed (or first creation): stop the stale one before
  // replacing so we don't leave an orphaned child process.
  if (existing) {
    void existing.stop().catch((err) => {
      console.warn('[petChat] stale adapter stop failed:', err);
    });
  }
  const adapter = createAdapter(id);
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

/** Resolve the neutral working directory (NOT the vault) used as the CLI
 *  cwd AND as the parent dir for saved blob attachments. Public wrapper
 *  around {@link resolveWorkingDir} so PetChat can pass the same path to
 *  `saveBlobs(attachments, workingDir, { subdir: ATTACHMENTS_SUBDIR })`
 *  without reaching into the private helper. Returns `''` outside Tauri. */
export async function getPetChatWorkingDir(): Promise<string> {
  return resolveWorkingDir();
}

export interface PetChatSendHandlers {
  onToken?: (text: string) => void;
  onThinking?: (text: string) => void;
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
  const aiConfig = useAiConfigStore.getState();
  const vaultConfig = useVaultConfigStore.getState();
  const adapter = getAdapterForSession(sessionId);
  const resumeSessionId = getCliSessionIdFor(sessionId);
  const mode = usePetChatStore.getState().inputMode;
  // Closed-over `sessionId` — NOT re-read from the store at event time.
  // This is the race-prevention contract: even if the user switches the
  // active session before a `session_id` event fires, the event attributes
  // to the session that sent the prompt.
  const handler = (event: CliStreamEvent) => {
    if (event.type === 'text' && event.content) {
      handlers.onToken?.(event.content);
    } else if (event.type === 'thinking' && event.content) {
      handlers.onThinking?.(event.content);
    } else if (event.type === 'session_id' && event.sessionId) {
      usePetChatStore.getState().setCliSessionId(sessionId, event.sessionId);
    } else if (event.type === 'error') {
      adapter.offEvent(handler);
      handlers.onError?.(event.content || 'LLM error');
    } else if (event.type === 'done') {
      adapter.offEvent(handler);
      handlers.onDone?.();
    }
    // tool_start / tool_end / file_change → ignored (pet is vault-free,
    // bare; no UI surface for them). Silently dropped.
  };

  if (isRigMode(mode)) {
    // chat: rig direct LLM (Rust `chat_stream`). handler is driven directly by
    // runRigChat — no CLI adapter subscription, so the `adapter.offEvent(...)`
    // calls above are harmless no-ops for a chat turn. workingDir / cliPath
    // are unused (rig has no cwd). History is persisted on disk by the backend
    // keyed by `sessionId`.
    //
    // Phase 2: read the pair from the pet session (moved off the global
    // petPair). If the session has no pair or its provider isn't configured,
    // surface the unconfigured error to the caller and bail — per PRD ADR,
    // per-caller pairs are independent (no global fallback). The pet panel's
    // PairSelector + PetSettings both write the active session's pair via
    // petChatStore.setSessionPair.
    const cfg = resolvePairForPetSession(sessionId);
    if (!cfg) {
      const msg = 'pet chat not configured — pick a (provider, model) pair in Pet Settings';
      handlers.onError?.(msg);
      return;
    }
    try {
      await runRigChat({
        sessionId,
        prompt,
        provider: cfg.provider,
        model: cfg.model,
        apiKey: cfg.apiKey,
        baseUrl: cfg.baseUrl,
        thinkingBudget: cfg.thinkingBudget,
        adapterFamily: cfg.adapterFamily,
        onEvent: handler,
      });
    } catch (err) {
      handlers.onError?.(String(err));
      throw err;
    }
    return;
  }

  // ask/agent: CLI adapter. Run against the current vault so file tools are
  // meaningful (previously the pet was vault-free); fall back to the neutral
  // appData dir when no vault is open so ask/agent still run. chat (above) has
  // no cwd. `resolveSendOptions` applies ask (plan) vs agent (bypassPermissions);
  // 'agent' here is byte-identical to the pre-chat `{ bare: true }` default.
  //
  // `vaultConfig.vaultPath` is the raw basePath (e.g. `~/quill/default_vault`
  // for the default vault — see vaultStore.ts:155/221). The claude adapter
  // spawns `/bin/sh -c 'cd <dir> && …'`, and single-quoted `~` doesn't expand
  // → `cd: ~/quill/default_vault: No such file or directory`. Run it through
  // `resolveBasePath` first (same as useVoiceInput.ts:198, featureAgentService,
  // wikiIngestService, etc.).
  const rawVaultPath = vaultConfig.vaultPath || '';
  const workingDir = rawVaultPath
    ? await resolveBasePath(rawVaultPath)
    : await resolveWorkingDir();
  adapter.onEvent(handler);

  try {
    await adapter.start({ cliPath: aiConfig.cliPath, workingDir });
    await adapter.send(prompt, resolveSendOptions(mode, { bare: true, resumeSessionId }));
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
 *  reaching into the `createAdapter` mock. Not part of the public
 *  runtime API. */
export function __getAdapterForTesting(sessionId: string): CliAdapter | undefined {
  return sessionAdapters.get(sessionId);
}
