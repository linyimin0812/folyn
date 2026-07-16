import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useAiConfigStore } from './aiConfigStore';
import { storageClient } from '@/utils/storageClient';

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
    });
    const s = useAiConfigStore.getState();
    expect(s.cliAdapter).toBe('gemini');
    expect(s.cliPath).toBe('/usr/local/bin/gemini');
    expect(s.chatProvider).toBe('openai');
    expect(s.chatModel).toBe('gpt-4o');
    expect(s.chatApiKey).toBe('sk-hydrated');
    expect(s.chatBaseUrl).toBe('https://api.example.com');
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
});
