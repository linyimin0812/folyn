import { describe, it, expect, vi, beforeEach } from 'vitest';

const { runRigChatMock, runFeatureAgentMock, aiConfigGetMock, aiStoreMock } = vi.hoisted(() => {
  return {
    runRigChatMock: vi.fn(),
    runFeatureAgentMock: vi.fn(),
    aiConfigGetMock: vi.fn(),
    aiStoreMock: {
      createSession: vi.fn(),
      addMessage: vi.fn(),
      appendToLastMessage: vi.fn(),
      setSessionStreaming: vi.fn(),
    },
  };
});

vi.mock('@/services/rigChat', () => ({ runRigChat: runRigChatMock }));
vi.mock('@/services/featureAgentService', () => ({ runFeatureAgent: runFeatureAgentMock }));
// PR5: aiCapability reads pluginPair + providerSettings[pluginPair.provider]
// (NOT global chatProvider/chatModel/chatApiKey). The mock state is seeded
// per-test via aiConfigGetMock.mockReturnValue({...}).
vi.mock('@/store/aiConfigStore', () => ({
  useAiConfigStore: { getState: aiConfigGetMock },
  resolvePairConfig: (pair: { provider: string; model: string } | null, state = aiConfigGetMock()) => {
    if (!pair) return null;
    const slot = state.providerSettings?.[pair.provider];
    if (!slot) return null;
    if (!slot.apiKey) return null;
    return {
      provider: pair.provider,
      model: pair.model,
      apiKey: slot.apiKey,
      baseUrl: slot.baseUrl ?? '',
      thinkingBudget: null,
    };
  },
}));
vi.mock('@/store/aiStore', () => ({ useAiStore: { getState: () => aiStoreMock } }));

import { buildPluginAi } from './aiCapability';
import type { PluginManifest } from '@quill/plugin-host';
import type { CliStreamEvent } from '@quill/cli-adapter';

function manifest(overrides: Partial<PluginManifest> = {}): PluginManifest {
  return {
    id: 'demo-plugin',
    name: 'Demo',
    version: '0.1.0',
    tier: 'trusted',
    main: 'index.js',
    ...overrides,
  };
}

/** The default configured state: anthropic pluginPair + a slot with a key. */
function configuredState() {
  return {
    pluginPair: { provider: 'anthropic', model: 'sonnet' },
    providerSettings: {
      anthropic: { apiKey: 'sk-test', baseUrl: '' },
    },
    customerProviders: {},
  };
}

beforeEach(() => {
  runRigChatMock.mockReset();
  runFeatureAgentMock.mockReset();
  aiConfigGetMock.mockReset();
  aiConfigGetMock.mockReturnValue(configuredState());
  aiStoreMock.createSession.mockReset();
  aiStoreMock.addMessage.mockReset();
  aiStoreMock.appendToLastMessage.mockReset();
  aiStoreMock.setSessionStreaming.mockReset();
  aiStoreMock.createSession.mockReturnValue('shared-sid');
});

describe('buildPluginAi / ai.chat', () => {
  it('rejects when manifest does not declare permissions.ai.chat', async () => {
    const ai = buildPluginAi(manifest());
    await expect(ai.chat({ sessionId: 's', prompt: 'p', onEvent: vi.fn() })).rejects.toThrow(
      /permissions\.ai\.chat/,
    );
    expect(runRigChatMock).not.toHaveBeenCalled();
  });

  it('rejects when pluginPair is null (caller has not picked a pair)', async () => {
    aiConfigGetMock.mockReturnValue({ pluginPair: null, providerSettings: {}, customerProviders: {} });
    const ai = buildPluginAi(manifest({ permissions: { ai: { chat: true } } }));
    await expect(ai.chat({ sessionId: 's', prompt: 'p', onEvent: vi.fn() })).rejects.toThrow(
      /pick a \(provider, model\) pair in Plugins Settings/,
    );
  });

  it('rejects when the pair provider has no apiKey', async () => {
    aiConfigGetMock.mockReturnValue({
      pluginPair: { provider: 'anthropic', model: 'sonnet' },
      providerSettings: { anthropic: { apiKey: '', baseUrl: '' } },
      customerProviders: {},
    });
    const ai = buildPluginAi(manifest({ permissions: { ai: { chat: true } } }));
    await expect(ai.chat({ sessionId: 's', prompt: 'p', onEvent: vi.fn() })).rejects.toThrow(
      /pick a \(provider, model\) pair in Plugins Settings/,
    );
  });

  it('streams text/done events to plugin onEvent, filters tool/file_change', async () => {
    const events: CliStreamEvent[] = [
      { type: 'thinking', content: 'hmm' },
      { type: 'text', content: 'hello' },
      { type: 'tool_start', toolName: 'Read' },
      { type: 'text', content: ' world' },
      { type: 'file_change', fileChange: { path: '/x' } as never },
      { type: 'done' },
    ];
    runRigChatMock.mockImplementation(async (p: { onEvent: (e: CliStreamEvent) => void }) => {
      for (const e of events) p.onEvent(e);
    });

    const seen: string[] = [];
    const ai = buildPluginAi(manifest({ permissions: { ai: { chat: true } } }));
    await ai.chat({
      sessionId: 's',
      prompt: 'p',
      onEvent: (e) => seen.push(`${e.type}:${e.content ?? ''}`),
    });

    expect(seen).toEqual([
      'thinking:hmm',
      'text:hello',
      'text: world',
      'done:',
    ]);
    expect(seen.some((s) => s.startsWith('tool_'))).toBe(false);
    expect(seen.some((s) => s.startsWith('file_change'))).toBe(false);
  });

  it('passes the pluginPair provider/model/apiKey to runRigChat', async () => {
    runRigChatMock.mockImplementation(async (p: { onEvent: (e: CliStreamEvent) => void }) => {
      p.onEvent({ type: 'done' });
    });
    const ai = buildPluginAi(manifest({ permissions: { ai: { chat: true } } }));
    await ai.chat({ sessionId: 's', prompt: 'p', onEvent: vi.fn() });

    expect(runRigChatMock).toHaveBeenCalledTimes(1);
    const params = runRigChatMock.mock.calls[0][0] as {
      provider: string; model: string; apiKey: string;
    };
    expect(params.provider).toBe('anthropic');
    expect(params.model).toBe('sonnet');
    expect(params.apiKey).toBe('sk-test');
  });

  it('routes stream to aiStore when useSharedSession=true', async () => {
    runRigChatMock.mockImplementation(async (p: { onEvent: (e: CliStreamEvent) => void }) => {
      p.onEvent({ type: 'text', content: 'hi' });
      p.onEvent({ type: 'done' });
    });

    const ai = buildPluginAi(manifest({ permissions: { ai: { chat: true } } }));
    await ai.chat({
      sessionId: 's',
      prompt: 'p',
      onEvent: vi.fn(),
      useSharedSession: true,
    });

    expect(aiStoreMock.createSession).toHaveBeenCalledTimes(1);
    expect(aiStoreMock.addMessage).toHaveBeenCalledWith('user', 'p', 'shared-sid');
    expect(aiStoreMock.setSessionStreaming).toHaveBeenCalledWith('shared-sid', true);
    expect(aiStoreMock.appendToLastMessage).toHaveBeenCalledWith('hi', 'shared-sid');
    expect(aiStoreMock.setSessionStreaming).toHaveBeenLastCalledWith('shared-sid', false);
  });

  it('emits error event and rethrows when runRigChat rejects', async () => {
    runRigChatMock.mockRejectedValue(new Error('boom'));
    const seen: string[] = [];
    const ai = buildPluginAi(manifest({ permissions: { ai: { chat: true } } }));
    await expect(
      ai.chat({ sessionId: 's', prompt: 'p', onEvent: (e) => seen.push(`${e.type}:${e.content ?? ''}`) }),
    ).rejects.toThrow('boom');
    expect(seen).toContain('error:boom');
  });
});

describe('buildPluginAi / ai.agent', () => {
  it('rejects when feature not in permissions.ai.agents', async () => {
    const ai = buildPluginAi(manifest({ permissions: { ai: { agents: ['study'] } } }));
    await expect(
      ai.agent({ feature: 'wiki', instruction: 'do', onEvent: vi.fn() }),
    ).rejects.toThrow(/not authorized for feature "wiki"/);
    expect(runFeatureAgentMock).not.toHaveBeenCalled();
  });

  it('rejects when permissions.ai.agents absent', async () => {
    const ai = buildPluginAi(manifest());
    await expect(
      ai.agent({ feature: 'study', instruction: 'do', onEvent: vi.fn() }),
    ).rejects.toThrow(/permissions\.ai\.agents/);
  });

  it('calls runFeatureAgent and emits done on success', async () => {
    runFeatureAgentMock.mockResolvedValue(undefined);
    const seen: string[] = [];
    const ai = buildPluginAi(manifest({ permissions: { ai: { agents: ['study'] } } }));
    await ai.agent({ feature: 'study', instruction: 'read X', onEvent: (e) => seen.push(e.type) });
    expect(runFeatureAgentMock).toHaveBeenCalledWith('study', 'read X');
    expect(seen).toEqual(['done']);
  });

  it('emits error event and rethrows when runFeatureAgent rejects', async () => {
    runFeatureAgentMock.mockRejectedValue(new Error('agent fail'));
    const seen: string[] = [];
    const ai = buildPluginAi(manifest({ permissions: { ai: { agents: ['study'] } } }));
    await expect(
      ai.agent({ feature: 'study', instruction: 'do', onEvent: (e) => seen.push(`${e.type}:${e.content ?? ''}`) }),
    ).rejects.toThrow('agent fail');
    expect(seen).toContain('error:agent fail');
  });
});
