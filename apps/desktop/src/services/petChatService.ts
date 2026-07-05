import { CliAdapterRegistry } from '@quill/cli-adapter';
import type { CliAdapter, CliStreamEvent } from '@quill/cli-adapter';
import { useSettingsStore } from '@/store/settingsStore';
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
 *  `bare: true` to enforce isolation). */
async function resolveWorkingDir(): Promise<string> {
  const appData = await appDataDir();
  return join(appData, 'pet-chat-tmp');
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
