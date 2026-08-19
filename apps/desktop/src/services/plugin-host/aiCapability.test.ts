import { describe, it, expect, vi, beforeEach } from 'vitest';

const { runRigChatMock, aiConfigGetMock, aiStoreMock, vaultStoreMock } = vi.hoisted(() => {
  return {
    runRigChatMock: vi.fn(),
    aiConfigGetMock: vi.fn(),
    aiStoreMock: {
      createSession: vi.fn(),
      addMessage: vi.fn(),
      appendToLastMessage: vi.fn(),
      setSessionStreaming: vi.fn(),
    },
    vaultStoreMock: {
      readFile: vi.fn(),
      writeFile: vi.fn(),
    },
  };
});

vi.mock('@/services/rigChat', () => ({ runRigChat: runRigChatMock }));
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
vi.mock('@/store/vaultStore', () => ({
  useVaultStore: { getState: () => ({ manager: vaultStoreMock }) },
}));

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
  aiConfigGetMock.mockReset();
  aiConfigGetMock.mockReturnValue(configuredState());
  aiStoreMock.createSession.mockReset();
  aiStoreMock.addMessage.mockReset();
  aiStoreMock.appendToLastMessage.mockReset();
  aiStoreMock.setSessionStreaming.mockReset();
  aiStoreMock.createSession.mockReturnValue('shared-sid');
  vaultStoreMock.readFile.mockReset();
  vaultStoreMock.writeFile.mockReset();
  vaultStoreMock.readFile.mockResolvedValue('OLD');
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
    const ai = buildPluginAi(manifest({ permissions: { ai: { agents: ['wiki'] } } }));
    await expect(
      ai.agent({ feature: 'clips', instruction: 'do', onEvent: vi.fn() }),
    ).rejects.toThrow(/not authorized for feature "clips"/);
  });

  it('rejects when permissions.ai.agents absent', async () => {
    const ai = buildPluginAi(manifest());
    await expect(
      ai.agent({ feature: 'wiki', instruction: 'do', onEvent: vi.fn() }),
    ).rejects.toThrow(/permissions\.ai\.agents/);
  });

  it('refuses to run a feature agent via the plugin host (runFeatureAgent removed)', async () => {
    const seen: string[] = [];
    const ai = buildPluginAi(manifest({ permissions: { ai: { agents: ['wiki'] } } }));
    await expect(
      ai.agent({ feature: 'wiki', instruction: 'read X', onEvent: (e) => seen.push(e.type) }),
    ).rejects.toThrow(/not exposed via the plugin host/);
    expect(seen).toEqual([]);
  });
});

describe('buildPluginAi / ai.editFile & createFile', () => {
  function streamText(chunks: string[]) {
    runRigChatMock.mockImplementation(async (p: { onEvent: (e: CliStreamEvent) => void }) => {
      for (const c of chunks) p.onEvent({ type: 'text', content: c });
    });
  }

  it('rejects editFile without permissions.ai.edit', async () => {
    const ai = buildPluginAi(manifest({ permissions: { ai: { edit: false } } }));
    await expect(
      ai.editFile({ path: 'a.md', instruction: 'x', onEvent: vi.fn() }),
    ).rejects.toThrow(/permissions\.ai\.edit/);
    expect(vaultStoreMock.writeFile).not.toHaveBeenCalled();
  });

  it('rejects createFile without permissions.ai.edit', async () => {
    const ai = buildPluginAi(manifest());
    await expect(
      ai.createFile({ path: 'a.md', instruction: 'x', onEvent: vi.fn() }),
    ).rejects.toThrow(/permissions\.ai\.edit/);
    expect(vaultStoreMock.writeFile).not.toHaveBeenCalled();
  });

  it('strips a single outer fenced block before writing (editFile)', async () => {
    streamText(['```markdown\n', '# Title\n', '\n', 'body\n', '```']);
    const seen: string[] = [];
    const ai = buildPluginAi(manifest({ permissions: { ai: { edit: true } } }));
    await ai.editFile({ path: 'note.md', instruction: 'summarize', onEvent: (e) => seen.push(e.type) });
    expect(vaultStoreMock.readFile).toHaveBeenCalledWith('note.md');
    expect(vaultStoreMock.writeFile).toHaveBeenCalledWith('note.md', '# Title\n\nbody\n');
    expect(seen).toContain('done');
  });

  it('writes plain (unfenced) AI output verbatim (createFile)', async () => {
    streamText(['plain text body']);
    const ai = buildPluginAi(manifest({ permissions: { ai: { edit: true } } }));
    await ai.createFile({ path: 'new.md', instruction: 'draft', onEvent: vi.fn() });
    // create does not read prior content.
    expect(vaultStoreMock.readFile).not.toHaveBeenCalled();
    expect(vaultStoreMock.writeFile).toHaveBeenCalledWith('new.md', 'plain text body');
  });

  it('emits error and rethrows when AI returns empty content', async () => {
    streamText(['   ']);
    const seen: string[] = [];
    const ai = buildPluginAi(manifest({ permissions: { ai: { edit: true } } }));
    await expect(
      ai.editFile({ path: 'a.md', instruction: 'x', onEvent: (e) => seen.push(`${e.type}:${e.content ?? ''}`) }),
    ).rejects.toThrow(/empty content/);
    expect(vaultStoreMock.writeFile).not.toHaveBeenCalled();
    expect(seen).toContain('error:AI returned empty content — file not written');
  });
});
