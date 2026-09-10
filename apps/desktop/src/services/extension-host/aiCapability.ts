/**
 * Host-mediated AI capability for trusted-tier extensions.
 *
 * Single chokepoint: `ai.chat` wraps {@link runRigChat}. Provider/model/apiKey
 * come from {@link useAiConfigStore} — never exposed to extensions.
 * `permissions.ai` whitelist is enforced before any AI call.
 *
 * ponytail: `ai.agent` was previously routed through `runFeatureAgent`, which
 * supported only one feature (now removed). Other features use bespoke
 * flows not exposed to extensions. The method now refuses clearly so the SDK
 * contract stays intact while no stale caller silently no-ops.
 */

import type {
  ExtensionAiAgentParams,
  ExtensionAiCapability,
  ExtensionAiChatParams,
  ExtensionAiCreateFileParams,
  ExtensionAiEditFileParams,
  ExtensionAiStreamEvent,
  ExtensionManifest,
} from '@folyn/extension-host';
import type { CliStreamEvent } from '@folyn/cli-adapter';
import { runRigChat } from '@/services/rigChat';

function assertChatPermission(manifest: ExtensionManifest): void {
  if (!manifest.permissions?.ai?.chat) {
    throw new Error(
      `extension "${manifest.id}" lacks permissions.ai.chat — call refused`,
    );
  }
}

function assertEditPermission(manifest: ExtensionManifest): void {
  if (!manifest.permissions?.ai?.edit) {
    throw new Error(
      `extension "${manifest.id}" lacks permissions.ai.edit — call refused`,
    );
  }
}

function assertAgentPermission(manifest: ExtensionManifest, feature: string): void {
  const allowed = manifest.permissions?.ai?.agents;
  if (!allowed || !allowed.includes(feature)) {
    throw new Error(
      `extension "${manifest.id}" not authorized for feature "${feature}" — add to permissions.ai.agents`,
    );
  }
}

/** Map host CliStreamEvent → extension-visible event (drop tool/file_change). */
function mapEvent(e: CliStreamEvent): ExtensionAiStreamEvent | null {
  switch (e.type) {
    case 'text':
    case 'thinking':
    case 'error':
    case 'done':
      return { type: e.type, content: e.content };
    default:
      return null;
  }
}

export function buildExtensionAi(manifest: ExtensionManifest): ExtensionAiCapability {
  return {
    async chat(params: ExtensionAiChatParams): Promise<void> {
      assertChatPermission(manifest);

      const [{ useAiConfigStore, resolvePairConfig }, { useAiStore }] = await Promise.all([
        import('@/store/aiConfigStore'),
        import('@/store/aiStore'),
      ]);
      // PR5: read extensionPair (per-caller pair, independent of global
      // chatProvider/chatModel per PRD ADR). Null → caller hasn't picked a
      // pair in ExtensionsSettings yet; surface a clear error to the extension.
      const cfg = resolvePairConfig(useAiConfigStore.getState().extensionPair);
      if (!cfg) {
        throw new Error('host AI not configured — pick a (provider, model) pair in Extensions Settings');
      }

      let sharedSid: string | null = null;
      if (params.useSharedSession) {
        sharedSid = useAiStore.getState().createSession();
        useAiStore.getState().addMessage('user', params.prompt, sharedSid);
        useAiStore.getState().addMessage('assistant', '', sharedSid);
        useAiStore.getState().setSessionStreaming(sharedSid, true);
      }

      const finalize = (streaming: boolean) => {
        if (sharedSid) useAiStore.getState().setSessionStreaming(sharedSid, streaming);
      };

      try {
        await runRigChat({
          sessionId: params.sessionId,
          prompt: params.prompt,
          provider: cfg.provider,
          model: cfg.model,
          apiKey: cfg.apiKey,
          ...(cfg.baseUrl ? { baseUrl: cfg.baseUrl } : {}),
          ...(cfg.thinkingBudget != null ? { thinkingBudget: cfg.thinkingBudget } : {}),
          adapterFamily: cfg.adapterFamily,
          onEvent: (event: CliStreamEvent) => {
            const mapped = mapEvent(event);
            if (!mapped) return;
            params.onEvent(mapped);
            if (sharedSid && mapped.type === 'text' && mapped.content) {
              useAiStore.getState().appendToLastMessage(mapped.content, sharedSid);
            }
          },
        });
        finalize(false);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        params.onEvent({ type: 'error', content: msg });
        finalize(false);
        throw err;
      }
    },

    async agent(params: ExtensionAiAgentParams): Promise<void> {
      assertAgentPermission(manifest, params.feature);
      // ponytail: runFeatureAgent was feature-specific and is gone; other
      // features use bespoke flows not exposed to extensions. Refuse clearly so
      // a stale caller fails loudly instead of silently no-oping.
      throw new Error(
        `feature "${params.feature}" agent is not exposed via the extension host AI capability`,
      );
    },

    // ponytail: AI edit/create reuse runRigChat with a file-aware system prompt
    // and the host's vault read/write chokepoints (editorIoService). No new AI
    // invocation path; the extension never touches the filesystem directly.
    async editFile(params: ExtensionAiEditFileParams): Promise<void> {
      assertEditPermission(manifest);
      await runAiFileOp(manifest, params, { create: false });
    },

    async createFile(params: ExtensionAiCreateFileParams): Promise<void> {
      assertEditPermission(manifest);
      await runAiFileOp(manifest, params, { create: true });
    },
  };
}

/**
 * Shared body for `editFile` / `createFile`. Reads the current file (empty for
 * create), asks the host's configured provider to transform it per the
 * instruction, then writes the result back through the vault manager (the same
 * chokepoint the editor uses) so disk + watchers stay consistent. Streaming
 * text is forwarded to `onEvent`. The extension never touches the filesystem.
 */
async function runAiFileOp(
  manifest: ExtensionManifest,
  params: ExtensionAiEditFileParams | ExtensionAiCreateFileParams,
  opts: { create: boolean },
): Promise<void> {
  const [{ useAiConfigStore, resolvePairConfig }, { useVaultStore }] = await Promise.all([
    import('@/store/aiConfigStore'),
    import('@/store/vaultStore'),
  ]);
  const cfg = resolvePairConfig(useAiConfigStore.getState().extensionPair);
  if (!cfg) {
    throw new Error('host AI not configured — pick a (provider, model) pair in Extensions Settings');
  }
  const manager = useVaultStore.getState().manager;
  if (!manager) throw new Error('no vault open — cannot resolve extension AI file path');

  const prior = opts.create ? '' : await manager.readFile(params.path).catch(() => '');
  const system = opts.create
    ? 'Create the file at the given path per the instruction. Output ONLY the file contents, no prose, no fences.'
    : 'Edit the file per the instruction. Output ONLY the full new file contents, no prose, no fences.';
  const prompt = `${system}\n\nPath: ${params.path}\nInstruction: ${params.instruction}\n\n--- CURRENT CONTENT ---\n${prior}`;

  let next = '';
  try {
    await runRigChat({
      sessionId: `extension-edit-${manifest.id}-${Date.now()}`,
      prompt,
      provider: cfg.provider,
      model: cfg.model,
      apiKey: cfg.apiKey,
      ...(cfg.baseUrl ? { baseUrl: cfg.baseUrl } : {}),
      ...(cfg.thinkingBudget != null ? { thinkingBudget: cfg.thinkingBudget } : {}),
      adapterFamily: cfg.adapterFamily,
      onEvent: (event: CliStreamEvent) => {
        if (event.type === 'text' && event.content) {
          next += event.content;
          params.onEvent({ type: 'text', content: event.content });
        } else if (event.type === 'error') {
          params.onEvent({ type: 'error', content: event.content });
        }
      },
    });
    if (!next.trim()) {
      throw new Error('AI returned empty content — file not written');
    }
    // Strip a single outer fenced-code block if the whole response is one
    // fenced block. Models routinely wrap "file contents" in ```lang … ```
    // despite the no-fences instruction; writing the fences verbatim would
    // corrupt the file. This is a trust-boundary write (disk), so the
    // defensive strip stays. Non-greedy capture preserves interior newlines;
    // a response that isn't a single complete fenced block is left verbatim.
    const fenced = next.match(/^```[a-zA-Z0-9_-]*\n([\s\S]*?)```\s*$/);
    if (fenced) next = fenced[1];
    await manager.writeFile(params.path, next);
    // ponytail: open-tab refresh is best-effort via the vault watcher; if a tab
    // is open for this path, the watcher fires `checkDiskChanges`. No direct
    // editorStore mutation here to avoid coupling AI to the tab model.
    params.onEvent({ type: 'done' });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    params.onEvent({ type: 'error', content: msg });
    throw err;
  }
}
