/**
 * Host-mediated AI capability for trusted-tier plugins.
 *
 * Single chokepoint: `ai.chat` wraps {@link runRigChat}, `ai.agent` wraps
 * {@link runFeatureAgent}. Provider/model/apiKey come from {@link useAiConfigStore}
 * — never exposed to plugins. `permissions.ai` whitelist is enforced before
 * any AI call.
 *
 * ponytail: no new AI invocation path. Both methods funnel through the host's
 * existing services.
 */

import type {
  PluginAiAgentParams,
  PluginAiCapability,
  PluginAiChatParams,
  PluginAiStreamEvent,
  PluginManifest,
} from '@quill/plugin-host';
import type { CliStreamEvent } from '@quill/cli-adapter';
import { runRigChat } from '@/services/rigChat';
import { runFeatureAgent } from '@/services/featureAgentService';

function assertChatPermission(manifest: PluginManifest): void {
  if (!manifest.permissions?.ai?.chat) {
    throw new Error(
      `plugin "${manifest.id}" lacks permissions.ai.chat — call refused`,
    );
  }
}

function assertAgentPermission(manifest: PluginManifest, feature: string): void {
  const allowed = manifest.permissions?.ai?.agents;
  if (!allowed || !allowed.includes(feature)) {
    throw new Error(
      `plugin "${manifest.id}" not authorized for feature "${feature}" — add to permissions.ai.agents`,
    );
  }
}

/** Map host CliStreamEvent → plugin-visible event (drop tool/file_change). */
function mapEvent(e: CliStreamEvent): PluginAiStreamEvent | null {
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

export function buildPluginAi(manifest: PluginManifest): PluginAiCapability {
  return {
    async chat(params: PluginAiChatParams): Promise<void> {
      assertChatPermission(manifest);

      const [{ useAiConfigStore, resolvePairConfig }, { useAiStore }] = await Promise.all([
        import('@/store/aiConfigStore'),
        import('@/store/aiStore'),
      ]);
      // PR5: read pluginPair (per-caller pair, independent of global
      // chatProvider/chatModel per PRD ADR). Null → caller hasn't picked a
      // pair in PluginsSettings yet; surface a clear error to the plugin.
      const cfg = resolvePairConfig(useAiConfigStore.getState().pluginPair);
      if (!cfg) {
        throw new Error('host AI not configured — pick a (provider, model) pair in Plugins Settings');
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

    async agent(params: PluginAiAgentParams): Promise<void> {
      assertAgentPermission(manifest, params.feature);
      try {
        await runFeatureAgent(params.feature, params.instruction);
        params.onEvent({ type: 'done' });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        params.onEvent({ type: 'error', content: msg });
        throw err;
      }
    },
  };
}
