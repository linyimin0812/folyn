import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useAiConfigStore, PERSIST_KEYS_AI_CONFIG, type ChatProvider } from './aiConfigStore';
import { storageClient } from '@/utils/storageClient';
import { PROVIDER_CATALOG, PROVIDER_IDS } from '@/services/providers/catalog';

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

  it('PROVIDER_IDS has 20 entries (18 rig + 2 compat)', () => {
    expect(PROVIDER_IDS).toHaveLength(20);
  });
});
