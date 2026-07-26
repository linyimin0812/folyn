import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useAiConfigStore, PERSIST_KEYS_AI_CONFIG, type ChatProvider } from './aiConfigStore';
import { storageClient } from '@/utils/storageClient';
import { PROVIDER_CATALOG, PROVIDER_IDS, type CustomProvider } from '@/services/providers/catalog';

beforeEach(() => {
  storageClient.__resetForTesting();
  vi.useFakeTimers();
  useAiConfigStore.setState({
    cliAdapter: 'claude',
    cliPath: 'claude',
    chatProvider: 'anthropic',
    chatModel: 'claude-sonnet-4-6',
    chatApiKey: '',
    chatBaseUrl: '',
    chatAzureDeploymentId: '',
    chatAzureApiVersion: '',
    chatThinkingBudget: 1024,
    providerConfigs: {},
    customProviders: [],
    enabledProviders: {},
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useAiConfigStore setters', () => {
  it('setChatModel updates + persists', () => {
    const setSpy = vi.spyOn(storageClient, 'set');
    useAiConfigStore.getState().setChatModel('gpt-4o');
    expect(useAiConfigStore.getState().chatModel).toBe('gpt-4o');
    vi.advanceTimersByTime(400);
    const payload = setSpy.mock.calls[setSpy.mock.calls.length - 1][1] as Record<string, unknown>;
    expect(payload.chatModel).toBe('gpt-4o');
    setSpy.mockRestore();
  });

  it('setChatProvider updates', () => {
    useAiConfigStore.getState().setChatProvider('openai');
    expect(useAiConfigStore.getState().chatProvider).toBe('openai');
  });

  it('setChatApiKey updates', () => {
    useAiConfigStore.getState().setChatApiKey('sk-xxx');
    expect(useAiConfigStore.getState().chatApiKey).toBe('sk-xxx');
  });

  it('setChatAzureDeploymentId updates + persists', () => {
    const setSpy = vi.spyOn(storageClient, 'set');
    useAiConfigStore.getState().setChatAzureDeploymentId('my-deploy');
    expect(useAiConfigStore.getState().chatAzureDeploymentId).toBe('my-deploy');
    vi.advanceTimersByTime(400);
    const payload = setSpy.mock.calls[setSpy.mock.calls.length - 1][1] as Record<string, unknown>;
    expect(payload.chatAzureDeploymentId).toBe('my-deploy');
    setSpy.mockRestore();
  });

  it('setChatAzureApiVersion updates + persists', () => {
    useAiConfigStore.getState().setChatAzureApiVersion('2024-10-21');
    expect(useAiConfigStore.getState().chatAzureApiVersion).toBe('2024-10-21');
  });

  it('setChatThinkingBudget updates + persists', () => {
    useAiConfigStore.getState().setChatThinkingBudget(2048);
    expect(useAiConfigStore.getState().chatThinkingBudget).toBe(2048);
    useAiConfigStore.getState().setChatThinkingBudget(null);
    expect(useAiConfigStore.getState().chatThinkingBudget).toBeNull();
  });
});

describe('useAiConfigStore.hydrate', () => {
  it('applies fields from the blob', () => {
    useAiConfigStore.getState().hydrate({
      cliAdapter: 'gemini',
      cliPath: '/usr/local/bin/gemini',
      chatProvider: 'openai',
      chatModel: 'gpt-4o',
      chatApiKey: 'sk-hydrated',
      chatBaseUrl: 'https://api.example.com',
      chatAzureDeploymentId: 'deploy-x',
      chatAzureApiVersion: '2024-10-21',
    });
    const s = useAiConfigStore.getState();
    expect(s.cliAdapter).toBe('gemini');
    expect(s.cliPath).toBe('/usr/local/bin/gemini');
    expect(s.chatProvider).toBe('openai');
    expect(s.chatModel).toBe('gpt-4o');
    expect(s.chatApiKey).toBe('sk-hydrated');
    expect(s.chatBaseUrl).toBe('https://api.example.com');
    expect(s.chatAzureDeploymentId).toBe('deploy-x');
    expect(s.chatAzureApiVersion).toBe('2024-10-21');
  });

  it('coerces invalid chatProvider to default (keeps anthropic)', () => {
    useAiConfigStore.getState().hydrate({ chatProvider: 'bogus' });
    expect(useAiConfigStore.getState().chatProvider).toBe('anthropic');
  });

  it('missing fields keep defaults', () => {
    useAiConfigStore.getState().hydrate({ chatModel: 'gpt-4' });
    expect(useAiConfigStore.getState().cliAdapter).toBe('claude');
    expect(useAiConfigStore.getState().chatModel).toBe('gpt-4');
  });

  // Regression: the three old ids must hydrate verbatim, no migration.
  it('hydrates the three legacy ids verbatim', () => {
    for (const id of ['anthropic', 'openai', 'openai-compatible'] as const) {
      useAiConfigStore.setState({ chatProvider: 'anthropic' });
      useAiConfigStore.getState().hydrate({ chatProvider: id });
      expect(useAiConfigStore.getState().chatProvider).toBe(id);
    }
  });

  // Parameterized: every catalog id must hydrate.
  it.each(PROVIDER_CATALOG.map((p) => [p.id] as [string]))(
    'hydrates catalog id %s',
    (id) => {
      useAiConfigStore.setState({ chatProvider: 'anthropic' });
      useAiConfigStore.getState().hydrate({ chatProvider: id });
      expect(useAiConfigStore.getState().chatProvider).toBe(id as ChatProvider);
    },
  );

  it('PERSIST_KEYS_AI_CONFIG includes azure fields', () => {
    expect(PERSIST_KEYS_AI_CONFIG).toContain('chatAzureDeploymentId');
    expect(PERSIST_KEYS_AI_CONFIG).toContain('chatAzureApiVersion');
  });

  it('PERSIST_KEYS_AI_CONFIG includes thinkingBudget', () => {
    expect(PERSIST_KEYS_AI_CONFIG).toContain('chatThinkingBudget');
  });

  it('hydrates chatThinkingBudget (number and null)', () => {
    useAiConfigStore.getState().setChatThinkingBudget(1024);
    useAiConfigStore.getState().hydrate({ chatThinkingBudget: 4096 });
    expect(useAiConfigStore.getState().chatThinkingBudget).toBe(4096);
    useAiConfigStore.getState().hydrate({ chatThinkingBudget: null });
    expect(useAiConfigStore.getState().chatThinkingBudget).toBeNull();
  });

  it('ignores invalid chatThinkingBudget values', () => {
    useAiConfigStore.getState().setChatThinkingBudget(1024);
    useAiConfigStore.getState().hydrate({ chatThinkingBudget: 'oops' });
    expect(useAiConfigStore.getState().chatThinkingBudget).toBe(1024);
    useAiConfigStore.getState().hydrate({ chatThinkingBudget: -1 });
    expect(useAiConfigStore.getState().chatThinkingBudget).toBe(1024);
  });

  it('PROVIDER_IDS has 16 entries (14 rig + 2 compat)', () => {
    expect(PROVIDER_IDS).toHaveLength(16);
  });
});

// T06: per-provider config slots.
describe('useAiConfigStore per-provider config (T06)', () => {
  it('setChatApiKey writes into providerConfigs[currentProvider]', () => {
    useAiConfigStore.getState().setChatApiKey('sk-abc');
    const s = useAiConfigStore.getState();
    expect(s.chatApiKey).toBe('sk-abc');
    expect(s.providerConfigs.anthropic?.apiKey).toBe('sk-abc');
  });

  it('setChatProvider saves current slot, loads new slot', () => {
    useAiConfigStore.getState().setChatApiKey('sk-anth');
    useAiConfigStore.getState().setChatProvider('openai');
    const afterSwitch = useAiConfigStore.getState();
    expect(afterSwitch.chatProvider).toBe('openai');
    // Old slot preserved under anthropic
    expect(afterSwitch.providerConfigs.anthropic?.apiKey).toBe('sk-anth');
    // New slot's flat mirror is empty (openai had no slot)
    expect(afterSwitch.chatApiKey).toBe('');
  });

  it('switching back restores the saved slot', () => {
    useAiConfigStore.getState().setChatApiKey('sk-anth');
    useAiConfigStore.getState().setChatBaseUrl('https://anthropic.example');
    useAiConfigStore.getState().setChatThinkingBudget(2048);
    useAiConfigStore.getState().setChatProvider('openai');
    // Set OpenAI's slot
    useAiConfigStore.getState().setChatApiKey('sk-openai');
    // Switch back
    useAiConfigStore.getState().setChatProvider('anthropic');
    const s = useAiConfigStore.getState();
    expect(s.chatApiKey).toBe('sk-anth');
    expect(s.chatBaseUrl).toBe('https://anthropic.example');
    expect(s.chatThinkingBudget).toBe(2048);
    // OpenAI's slot preserved even though we're not on it
    expect(s.providerConfigs.openai?.apiKey).toBe('sk-openai');
  });

  it('setChatThinkingBudget writes into the current slot', () => {
    useAiConfigStore.getState().setChatThinkingBudget(4096);
    expect(useAiConfigStore.getState().providerConfigs.anthropic?.thinkingBudget).toBe(4096);
  });

  it('configuredProviderIds returns providers with non-empty apiKey', () => {
    useAiConfigStore.getState().setChatApiKey('sk-anth');
    // Switch to openai, set key
    useAiConfigStore.getState().setChatProvider('openai');
    useAiConfigStore.getState().setChatApiKey('sk-openai');
    const ids = useAiConfigStore.getState().configuredProviderIds();
    expect(ids).toContain('anthropic');
    expect(ids).toContain('openai');
    expect(ids).toHaveLength(2);
  });

  it('configuredProviderIds includes Ollama only when it has a slot or is current', () => {
    // Ollama has requiresApiKey=false — only included if user picked it or set a slot
    useAiConfigStore.getState().setChatApiKey('sk-anth');
    expect(useAiConfigStore.getState().configuredProviderIds()).toEqual(['anthropic']);
    // Set chatProvider=ollama once → included
    useAiConfigStore.getState().setChatProvider('ollama');
    const ids = useAiConfigStore.getState().configuredProviderIds();
    expect(ids).toContain('ollama');
    expect(ids).toContain('anthropic');
  });

  it('hydrates old flat-key blob into providerConfigs[legacyId]', () => {
    // Simulate a pre-T06 blob: flat chatApiKey/chatBaseUrl/etc + chatProvider=anthropic
    useAiConfigStore.getState().hydrate({
      chatProvider: 'anthropic',
      chatApiKey: 'sk-legacy',
      chatBaseUrl: 'https://legacy.example',
      chatAzureDeploymentId: 'legacy-deploy',
      chatAzureApiVersion: '2024-01-01',
      chatThinkingBudget: 512,
    });
    const s = useAiConfigStore.getState();
    expect(s.providerConfigs.anthropic?.apiKey).toBe('sk-legacy');
    expect(s.providerConfigs.anthropic?.baseUrl).toBe('https://legacy.example');
    expect(s.providerConfigs.anthropic?.azureDeploymentId).toBe('legacy-deploy');
    expect(s.providerConfigs.anthropic?.azureApiVersion).toBe('2024-01-01');
    expect(s.providerConfigs.anthropic?.thinkingBudget).toBe(512);
    // Flat mirrors populated from the slot
    expect(s.chatApiKey).toBe('sk-legacy');
  });

  it('hydrates new providerConfigs blob as-is', () => {
    useAiConfigStore.getState().hydrate({
      chatProvider: 'openai',
      providerConfigs: {
        openai: {
          apiKey: 'sk-new',
          baseUrl: '',
          azureDeploymentId: '',
          azureApiVersion: '',
          thinkingBudget: 8192,
        },
      },
    });
    const s = useAiConfigStore.getState();
    expect(s.chatProvider).toBe('openai');
    expect(s.providerConfigs.openai?.apiKey).toBe('sk-new');
    expect(s.chatApiKey).toBe('sk-new');
    expect(s.chatThinkingBudget).toBe(8192);
  });

  it('persists providerConfigs key', () => {
    const setSpy = vi.spyOn(storageClient, 'set');
    useAiConfigStore.getState().setChatApiKey('sk-persist');
    vi.advanceTimersByTime(400);
    const payload = setSpy.mock.calls[setSpy.mock.calls.length - 1][1] as Record<string, unknown>;
    expect(payload.providerConfigs).toBeDefined();
    const pc = payload.providerConfigs as Record<string, unknown>;
    expect(pc.anthropic).toBeDefined();
    setSpy.mockRestore();
  });
});

describe('useAiConfigStore custom providers (T08)', () => {
  it('addCustomProvider creates an entry with a custom- id, appends to customProviders', () => {
    const id = useAiConfigStore.getState().addCustomProvider({
      displayName: 'My Provider',
      baseUrl: 'https://example.com/v1',
      apiKeyUrl: null,
      category: 'openai',
    });
    expect(id).toMatch(/^custom-/);
    const s = useAiConfigStore.getState();
    const cp = s.customProviders.find((p) => p.id === id);
    expect(cp?.displayName).toBe('My Provider');
    expect(cp?.baseUrl).toBe('https://example.com/v1');
    expect(cp?.category).toBe('openai');
    expect(cp?.createdAt).toBeTypeOf('number');
  });

  it('addCustomProvider trims displayName + baseUrl; empty name defaults to "Custom"', () => {
    const id = useAiConfigStore.getState().addCustomProvider({
      displayName: '  ',
      baseUrl: '  https://x.com/v1  ',
      category: 'gemini',
    });
    const cp = useAiConfigStore.getState().customProviders.find((p) => p.id === id);
    expect(cp?.displayName).toBe('Custom');
    expect(cp?.baseUrl).toBe('https://x.com/v1');
  });

  it('updateCustomProvider patches fields without changing id/createdAt', () => {
    const id = useAiConfigStore.getState().addCustomProvider({
      displayName: 'A',
      baseUrl: 'https://a.com',
      category: 'openai',
    });
    const before = useAiConfigStore.getState().customProviders.find((p) => p.id === id);
    useAiConfigStore.getState().updateCustomProvider(id, { displayName: 'B', baseUrl: 'https://b.com' });
    const after = useAiConfigStore.getState().customProviders.find((p) => p.id === id);
    expect(after?.displayName).toBe('B');
    expect(after?.baseUrl).toBe('https://b.com');
    expect(after?.createdAt).toBe(before?.createdAt);
  });

  it('removeCustomProvider deletes entry + cleans enabledProviders + providerConfigs slot', () => {
    const id = useAiConfigStore.getState().addCustomProvider({
      displayName: 'A',
      baseUrl: 'https://a.com',
      category: 'openai',
    });
    useAiConfigStore.getState().setProviderEnabled(id, true);
    useAiConfigStore.getState().setChatApiKey('sk-xxx');
    useAiConfigStore.getState().setChatProvider(id as ChatProvider);
    useAiConfigStore.getState().removeCustomProvider(id);
    const s = useAiConfigStore.getState();
    expect(s.customProviders.find((p) => p.id === id)).toBeUndefined();
    expect(s.enabledProviders[id]).toBeUndefined();
    expect(s.providerConfigs[id]).toBeUndefined();
    // Removing the active chatProvider falls back to 'anthropic'.
    expect(s.chatProvider).toBe('anthropic');
  });

  it('removeCustomProvider is a no-op for an unknown id', () => {
    const before = useAiConfigStore.getState().customProviders.length;
    useAiConfigStore.getState().removeCustomProvider('custom-does-not-exist');
    expect(useAiConfigStore.getState().customProviders.length).toBe(before);
  });

  it('setProviderEnabled toggles the flag', () => {
    useAiConfigStore.getState().setProviderEnabled('openai', true);
    expect(useAiConfigStore.getState().enabledProviders.openai).toBe(true);
    useAiConfigStore.getState().setProviderEnabled('openai', false);
    expect(useAiConfigStore.getState().enabledProviders.openai).toBe(false);
  });
});

describe('useAiConfigStore hydrate migration (T08)', () => {
  it('pre-T08 blob without enabledProviders gets chatProvider enabled', () => {
    useAiConfigStore.getState().hydrate({
      chatProvider: 'openai',
      chatModel: 'gpt-5.2',
      chatApiKey: 'sk-xxx',
    });
    const s = useAiConfigStore.getState();
    expect(s.chatProvider).toBe('openai');
    expect(s.enabledProviders).toEqual({ openai: true });
    expect(s.customProviders).toEqual([]);
  });

  it('blob with enabledProviders preserves them', () => {
    useAiConfigStore.getState().hydrate({
      chatProvider: 'openai',
      enabledProviders: { openai: true, anthropic: true, deepseek: false },
    });
    expect(useAiConfigStore.getState().enabledProviders).toEqual({
      openai: true,
      anthropic: true,
      deepseek: false,
    });
  });

  it('blob with customProviders preserves them', () => {
    const cp: CustomProvider = {
      id: 'custom-test',
      displayName: 'Test',
      baseUrl: 'https://test.com/v1',
      apiKeyUrl: null,
      category: 'openai',
      createdAt: 1234,
    };
    useAiConfigStore.getState().hydrate({
      chatProvider: 'anthropic',
      customProviders: [cp],
    });
    const s = useAiConfigStore.getState();
    expect(s.customProviders).toEqual([cp]);
  });

  it('blob with malformed customProviders falls back to empty array', () => {
    useAiConfigStore.getState().hydrate({
      chatProvider: 'anthropic',
      customProviders: [{ id: 123, displayName: 'bad' }],
    });
    expect(useAiConfigStore.getState().customProviders).toEqual([]);
  });
});
