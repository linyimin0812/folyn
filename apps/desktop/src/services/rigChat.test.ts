import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock @tauri-apps/api/core: invoke as a spy, Channel as a minimal class so
// runRigChat can `new Channel()` and we can drive `channel.onmessage` from
// the invoke mock. vi.hoisted ensures the names exist when vi.mock factory
// runs (factories are hoisted above imports).
const { invokeMock, FakeChannel } = vi.hoisted(() => {
  const invokeMock = vi.fn();
  class FakeChannel<T = unknown> {
    onmessage?: (chunk: T) => void;
  }
  return { invokeMock, FakeChannel };
});

vi.mock('@tauri-apps/api/core', () => ({
  invoke: invokeMock,
  Channel: FakeChannel,
  convertFileSrc: vi.fn(),
}));

import { runRigChat, testChatConnection, type ChatTestResult } from './rigChat';
import type { CliStreamEvent } from '@quill/cli-adapter';

beforeEach(() => {
  invokeMock.mockReset();
  invokeMock.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.useRealTimers();
});

function emitChunk(args: { onEvent: { onmessage?: (c: unknown) => void } }, chunk: unknown) {
  args.onEvent.onmessage?.(chunk);
}

describe('testChatConnection', () => {
  it('resolves success on done event', async () => {
    invokeMock.mockImplementation(async (_cmd: string, args: { onEvent: { onmessage?: (c: unknown) => void } }) => {
      emitChunk(args, { type: 'done' });
    });
    const r = await testChatConnection({
      provider: 'anthropic',
      model: 'claude-sonnet-4-6',
      apiKey: 'sk-test',
    });
    expect(r).toEqual<ChatTestResult>({ success: true, message: '连接成功' });
  });

  it('resolves failure on error event', async () => {
    invokeMock.mockImplementation(async (_cmd: string, args: { onEvent: { onmessage?: (c: unknown) => void } }) => {
      emitChunk(args, { type: 'error', message: 'invalid api key' });
    });
    const r = await testChatConnection({
      provider: 'openai',
      model: 'gpt-4o-mini',
      apiKey: 'bad',
    });
    expect(r.success).toBe(false);
    expect(r.message).toContain('invalid api key');
  });

  it('resolves failure on invoke reject', async () => {
    invokeMock.mockRejectedValue(new Error('network down'));
    const r = await testChatConnection({
      provider: 'openai',
      model: 'gpt-4o-mini',
      apiKey: 'sk-test',
    });
    expect(r.success).toBe(false);
    expect(r.message).toContain('network down');
  });

  it('times out when no event fires', async () => {
    vi.useFakeTimers();
    invokeMock.mockImplementation(() => new Promise(() => {})); // never resolves
    const p = testChatConnection({
      provider: 'openai',
      model: 'gpt-4o-mini',
      apiKey: 'sk-test',
      timeoutMs: 1000,
    });
    vi.advanceTimersByTime(1000);
    const r = await p;
    expect(r.success).toBe(false);
    expect(r.message).toContain('超时');
  });

  it('ignores events after timeout (timeout wins)', async () => {
    vi.useFakeTimers();
    invokeMock.mockImplementation((_cmd: string, args: { onEvent: { onmessage?: (c: unknown) => void } }) => {
      // Fire done AFTER the timeout fires (1s) — must not overwrite.
      setTimeout(() => emitChunk(args, { type: 'done' }), 1500);
      return new Promise(() => {});
    });
    const p = testChatConnection({
      provider: 'openai',
      model: 'gpt-4o-mini',
      apiKey: 'sk-test',
      timeoutMs: 1000,
    });
    vi.advanceTimersByTime(1500);
    const r = await p;
    expect(r.success).toBe(false);
    expect(r.message).toContain('超时');
  });
});

describe('runRigChat', () => {
  it('translates a thinking chunk into a thinking CliStreamEvent', async () => {
    invokeMock.mockImplementation(async (_cmd: string, args: { onEvent: { onmessage?: (c: unknown) => void } }) => {
      emitChunk(args, { type: 'thinking', text: 'hmm' });
      emitChunk(args, { type: 'done' });
    });
    const events: CliStreamEvent[] = [];
    await runRigChat({
      sessionId: 'sess-test',
      prompt: 'ping',
      provider: 'anthropic',
      model: 'claude-sonnet-4-6',
      apiKey: 'sk-test',
      onEvent: (e) => events.push(e),
    });
    expect(events).toContainEqual<CliStreamEvent>({ type: 'thinking', content: 'hmm' });
    expect(events.at(-1)).toEqual<CliStreamEvent>({ type: 'done' });
  });

  it('forwards images param to invoke when provided', async () => {
    invokeMock.mockImplementation(async (_cmd: string, _args: { onEvent: { onmessage?: (c: unknown) => void } }) => {});
    await runRigChat({
      sessionId: 'sess-img',
      prompt: 'describe this',
      provider: 'anthropic',
      model: 'claude-sonnet-4-6',
      apiKey: 'sk-test',
      images: [{ data: 'AAAA', mediaType: 'image/png' }],
      onEvent: () => {},
    });
    expect(invokeMock).toHaveBeenCalledTimes(1);
    const args = invokeMock.mock.calls[0][1] as { params: { images?: Array<{ data: string; mediaType: string }> } };
    expect(args.params.images).toEqual([{ data: 'AAAA', mediaType: 'image/png' }]);
  });

  it('omits images when the array is empty', async () => {
    invokeMock.mockImplementation(async () => {});
    await runRigChat({
      sessionId: 'sess-empty',
      prompt: 'ping',
      provider: 'anthropic',
      model: 'claude-sonnet-4-6',
      apiKey: 'sk-test',
      images: [],
      onEvent: () => {},
    });
    const args = invokeMock.mock.calls[0][1] as { params: { images?: unknown } };
    expect(args.params.images).toBeNull();
  });
});
