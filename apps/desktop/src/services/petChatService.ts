import { CliAdapterRegistry } from '@quill/cli-adapter';
import type { CliAdapter, CliStreamEvent } from '@quill/cli-adapter';
import { useSettingsStore } from '@/store/settingsStore';
import { isTauri } from '@/utils/platform';
import { appDataDir, join } from '@tauri-apps/api/path';

/**
 * PetChatService — the pet-panel's self-hosted AI chat pipeline.
 *
 * The pet-panel chat is vault-free (PRD R6): it does NOT use `aiStore`,
 * `sessionAdapters`, or any vault-grounded send options. Instead it creates
 * its own `CliAdapter` via `CliAdapterRegistry.getInstance().create(...)`,
 * starts it in a neutral temp dir (NOT the vault), and streams plain text
 * in/out. This mirrors the adapter-creation pattern in `clipService` /
 * `planMyDayService` / `wikiIngestService` but with no vault dependency.
 *
 * Lifecycle: one adapter per `PetChat` mount. Created lazily on first
 * `send()`; reused across turns; `stop()`-ed on unmount or panel-hide.
 * `onEvent` accumulates `text` tokens into the assistant message via the
 * caller-provided callback (the store's `appendToLastMessage`).
 */

let cachedAdapter: CliAdapter | null = null;
let cachedAdapterId: string | null = null;

/** Resolve a neutral working directory that is NOT the vault. Uses the
 *  app-data dir + `pet-chat-tmp` so the CLI has a stable cwd with no
 *  project CLAUDE.md / `.claude/agents/` discovery (the send options use
 *  `bare: true` to enforce isolation).
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

/** Lazily create (or reuse) a `CliAdapter` for the pet chat. The adapter id
 *  follows `settings.cliAdapter`; if the user switches adapter type, the
 *  next call creates a fresh instance. */
export function getPetChatAdapter(): CliAdapter {
  const settings = useSettingsStore.getState();
  const id = settings.cliAdapter || 'claude';
  if (cachedAdapter && cachedAdapterId === id) return cachedAdapter;
  const registry = CliAdapterRegistry.getInstance();
  const adapter = registry.create(id);
  cachedAdapter = adapter;
  cachedAdapterId = id;
  return adapter;
}

/** Drop the cached adapter (call on unmount / panel hide so the next send
 *  starts a fresh process). `stop()` is the caller's responsibility. */
export function resetPetChatAdapter(): void {
  cachedAdapter = null;
  cachedAdapterId = null;
}

/** Send a plain-text prompt and stream the assistant reply. The caller
 *  supplies `onToken` (append to the assistant message) and `onDone` /
 *  `onError` lifecycle hooks. Returns when the stream completes (`done`
 *  event) or throws on `error`.
 *
 *  Send options are deliberately plain: `bare: true` (no cwd agent
 *  discovery), no `resumeSessionId` (fresh exchange each send), no vault
 *  system prompt. The CLI's default system prompt applies. */
export async function sendPetChatMessage(
  prompt: string,
  handlers: {
    onToken: (text: string) => void;
    onDone: () => void;
    onError: (message: string) => void;
  },
): Promise<void> {
  const settings = useSettingsStore.getState();
  const adapter = getPetChatAdapter();
  const workingDir = await resolveWorkingDir();

  const handler = (event: CliStreamEvent) => {
    if (event.type === 'text' && event.content) {
      handlers.onToken(event.content);
    } else if (event.type === 'error') {
      adapter.offEvent(handler);
      handlers.onError(event.content || 'LLM error');
    } else if (event.type === 'done') {
      adapter.offEvent(handler);
      handlers.onDone();
    }
  };
  adapter.onEvent(handler);

  try {
    await adapter.start({ cliPath: settings.cliPath, workingDir });
    await adapter.send(prompt, { bare: true });
  } catch (err) {
    adapter.offEvent(handler);
    throw err;
  }
}

/** Stop the active adapter stream (user clicked Stop). */
export async function stopPetChat(): Promise<void> {
  if (cachedAdapter) {
    try {
      await cachedAdapter.stop();
    } catch (err) {
      console.warn('[petChat] stop failed:', err);
    }
  }
}
