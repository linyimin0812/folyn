import { describe, it, expect, beforeEach } from 'vitest';
import { resolveKbChatPair } from './kbLlm';
import { useAiConfigStore } from '@/store/aiConfigStore';

function slot(id: string, apiKey: string) {
  return { id, baseUrl: `https://${id}.example/v1`, apiKey, selectedModelIds: [], enabled: true, extra: {} };
}

beforeEach(() => {
  useAiConfigStore.setState({
    chatProvider: 'anthropic',
    chatModel: 'claude-sonnet-4-6',
    chatApiKey: 'sk-a',
    chatBaseUrl: 'https://anthropic.example/v1',
    kbPair: null,
    customerProviders: {},
    providerSettings: {
      anthropic: slot('anthropic', 'sk-a'),
      openai: slot('openai', 'sk-o'),
    },
  });
});

describe('resolveKbChatPair — kbPair 优先、null 回落全局', () => {
  it('uses kbPair when set', () => {
    useAiConfigStore.setState({ kbPair: { provider: 'openai', model: 'gpt-4o' } });
    const pair = resolveKbChatPair();
    expect(pair?.provider).toBe('openai');
    expect(pair?.model).toBe('gpt-4o');
    expect(pair?.apiKey).toBe('sk-o');
  });

  it('falls back to global chatProvider/chatModel when kbPair is null', () => {
    const pair = resolveKbChatPair();
    expect(pair?.provider).toBe('anthropic');
    expect(pair?.model).toBe('claude-sonnet-4-6');
    expect(pair?.apiKey).toBe('sk-a');
  });
});
