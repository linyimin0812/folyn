import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RigChatParams } from '@/services/rigChat';
import { runRigChat } from '@/services/rigChat';
import { useAiConfigStore } from '@/store/aiConfigStore';
import { kbChatJson, kbChatText } from './kbLlm';

vi.mock('@/services/rigChat', () => ({ runRigChat: vi.fn() }));
const chat = vi.mocked(runRigChat);
const response = (content: string, thinking = false) => async (params: RigChatParams) => {
  if (content) params.onEvent({ type: thinking ? 'thinking' : 'text', content });
  params.onEvent({ type: 'done' });
};

beforeEach(() => {
  chat.mockReset();
  useAiConfigStore.setState({
    kbPair: null, chatProvider: 'openai', chatModel: 'test-model',
    customerProviders: {},
    providerSettings: { openai: { id: 'openai', baseUrl: 'https://example.invalid/v1', apiKey: 'test-key', selectedModelIds: [], enabled: true, extra: {} } },
  });
});

describe('kbChatJson response handling at the runRigChat seam', () => {
  it('reproduces the exact reported error for a non-JSON model response', async () => {
    chat.mockImplementation(response('我会为这份资料建立索引。'));
    await expect(kbChatJson('Return an index object.', 'JSON only.')).rejects.toThrow('模型未返回 JSON');
  });

  it('recovers once from a non-JSON response using a fresh constrained call', async () => {
    chat.mockImplementationOnce(response('我会为这份资料建立索引。'))
      .mockImplementationOnce(response('{"nodes":[]}'));
    await expect(kbChatJson('Return an index object.', 'JSON only.')).resolves.toEqual({ nodes: [] });
    expect(chat).toHaveBeenCalledTimes(2);
  });

  it('distinguishes an empty response from an ordinary non-JSON answer', async () => {
    chat.mockImplementation(response(''));
    await expect(kbChatJson('Return an index object.', 'JSON only.')).rejects.toThrow(/空|没有.*正文/);
  });

  it('distinguishes thinking-only output and never treats thoughts as an index', async () => {
    chat.mockImplementation(response('Need to construct the index.', true));
    await expect(kbChatJson('Return an index object.', 'JSON only.')).rejects.toThrow(/思考|thinking/i);
  });
  it('keeps valid JSON a single independent request and handles quoted braces', async () => {
    chat.mockImplementation(response('Result: {"message":"a } and { brace, \\"quoted\\"", "nodes":[]}'));
    await expect(kbChatJson('original prompt', 'original preamble')).resolves.toEqual({message: 'a } and { brace, "quoted"', nodes: []});
    expect(chat).toHaveBeenCalledTimes(1);
    expect(chat.mock.calls[0][0].historyMode).toBe('none');
    // 结构化任务禁用思考：thinkingBudget 必须显式为 null（不继承 pair 配置）。
    expect(chat.mock.calls[0][0].thinkingBudget).toBeNull();
    // 输出上限：推理型模型的 reasoning 会烧掉小默认上限，导致 JSON 中途截断。
    expect(chat.mock.calls[0][0].maxTokens).toBe(16384);
  });

  it('prefers one valid JSON fence over surrounding prose braces', async () => {
    chat.mockImplementation(response('Schema {nodes}:\n```json\n{"nodes":[]}\n```\nNotes {example}.'));
    await expect(kbChatJson('prompt', 'preamble')).resolves.toEqual({nodes: []});
    expect(chat).toHaveBeenCalledTimes(1);
  });

  it('never rescues an inner object from a truncated outer object', async () => {
    chat.mockImplementation(response('{"outer": {"nodes":[]}'));
    await expect(kbChatJson('prompt', 'preamble')).rejects.toThrow(/JSON/);
    expect(chat).toHaveBeenCalledTimes(2);
  });

  it('rejects ambiguous multiple objects instead of choosing one', async () => {
    chat.mockImplementation(response('{"nodes":[]}\n{"nodes":[1]}'));
    await expect(kbChatJson('prompt', 'preamble')).rejects.toThrow(/JSON/);
    expect(chat).toHaveBeenCalledTimes(2);
  });

  it('propagates provider failures without a format retry', async () => {
    chat.mockRejectedValue(new Error('401 unauthorized'));
    await expect(kbChatJson('prompt', 'preamble')).rejects.toThrow('401 unauthorized');
    expect(chat).toHaveBeenCalledTimes(1);
  });

  it('propagates streamed provider errors even when text looks parseable', async () => {
    chat.mockImplementation(async (params) => { params.onEvent({type: 'text', content: '{"nodes":[]}'}); params.onEvent({type: 'error', content: 'network interrupted'}); });
    await expect(kbChatJson('prompt', 'preamble')).rejects.toThrow('network interrupted');
    expect(chat).toHaveBeenCalledTimes(1);
  });

  it('stops after one correction and exposes a format error without leaking output', async () => {
    chat.mockImplementation(response('{"private source fragment":'));
    let failure: unknown;
    try { await kbChatJson('prompt', 'preamble'); } catch (error) { failure = error; }
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toMatch(/JSON/);
    expect((failure as Error).message).not.toContain('private source fragment');
    expect(chat).toHaveBeenCalledTimes(2);
    expect(chat.mock.calls[1][0].prompt).toContain('prompt');
    expect(chat.mock.calls[1][0].historyMode).toBe('none');
  });

  it('rejects a root array rather than extracting its nested object', async () => {
    chat.mockImplementation(response('[{"nodes":[]}]'));
    await expect(kbChatJson('prompt', 'preamble')).rejects.toThrow(/JSON/);
    expect(chat).toHaveBeenCalledTimes(2);
  });

  it('rejects an extra valid object outside a valid JSON fence as ambiguous', async () => {
    chat.mockImplementation(response('```json\n{"nodes":[]}\n```\n{"nodes":[1]}'));
    await expect(kbChatJson('prompt', 'preamble')).rejects.toThrow(/JSON/);
    expect(chat).toHaveBeenCalledTimes(2);
  });

  it('describes absent completion events without assuming a provider returned an empty answer', async () => {
    chat.mockResolvedValue(undefined);
    await expect(kbChatJson('prompt', 'preamble')).rejects.toThrow(/未.*结束事件/);
    expect(chat).toHaveBeenCalledTimes(2);
  });

  describe('empty-body retry (thinking-only / transient truncation)', () => {
    it('recovers when a thinking-only first call is followed by valid JSON', async () => {
      chat.mockImplementationOnce(response('Need to construct the index.', true))
        .mockImplementationOnce(response('{"nodes":[]}'));
      await expect(kbChatJson('Return an index object.', 'JSON only.')).resolves.toEqual({ nodes: [] });
      expect(chat).toHaveBeenCalledTimes(2);
    });

    it('throws the thinking-only diagnostic when the retry stays empty with thinking', async () => {
      chat.mockImplementation(response('Need to construct the index.', true));
      await expect(kbChatJson('prompt', 'preamble')).rejects.toThrow('模型仅返回思考过程且其中未找到可解析的 JSON');
      expect(chat).toHaveBeenCalledTimes(2);
    });

    it('recovers JSON from thinking text when both attempts have an empty body', async () => {
      // 兜底：无法关思考的推理模型 —— 思考里已推导出完整 JSON，正文为空。
      chat.mockImplementation(response('先分析结构……最终答案是 {"nodes":[]}', true));
      await expect(kbChatJson('prompt', 'preamble')).resolves.toEqual({ nodes: [] });
      expect(chat).toHaveBeenCalledTimes(2);
    });

    it('still validates JSON mined from thinking text (truncated object is not rescued)', async () => {
      chat.mockImplementation(response('推导中 {"outer": {"nodes":[]}', true));
      await expect(kbChatJson('prompt', 'preamble')).rejects.toThrow('疑似被截断');
      expect(chat).toHaveBeenCalledTimes(2);
    });

    describe('thinking-only fallback: greedy fence tolerance and truncation diagnostics', () => {
      it('recovers fenced JSON from thinking when the strict single-object path is ambiguous', async () => {
        // 严格路径因围栏外的合法数组（nonObject）拒绝；贪婪路径直接抠出围栏 JSON。
        chat.mockImplementation(response('也许返回数组 [1,2] 不对，应该输出：```json\n{"nodes":[]}\n```', true));
        await expect(kbChatJson('prompt', 'preamble')).resolves.toEqual({ nodes: [] });
        expect(chat).toHaveBeenCalledTimes(2);
      });

      it('reports suspected truncation with a thinking tail excerpt and full console tail', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        try {
          chat.mockImplementation(response('长推导 {$'.repeat(300) + '{"outer": {"nodes":[]}', true));
          let failure: unknown;
          try { await kbChatJson('prompt', 'preamble'); } catch (error) { failure = error; }
          expect((failure as Error).message).toContain('疑似被截断');
          expect((failure as Error).message).toContain('{"outer": {"nodes":[]}');
          expect(warn).toHaveBeenCalledWith('[kb] thinking tail:', expect.stringContaining('{"outer":'));
        } finally {
          warn.mockRestore();
        }
      });

      it('includes a thinking tail excerpt when no JSON is recoverable at all', async () => {
        chat.mockImplementation(response('纯思考，没有任何结构化内容 tail-marker-xyz', true));
        await expect(kbChatJson('prompt', 'preamble')).rejects.toThrow(/tail-marker-xyz/);
        expect(chat).toHaveBeenCalledTimes(2);
      });
    });

    it('throws the empty-response message when the retry stays empty without thinking', async () => {
      chat.mockImplementation(response(''));
      await expect(kbChatJson('prompt', 'preamble')).rejects.toThrow('模型返回空响应，没有可用正文');
      expect(chat).toHaveBeenCalledTimes(2);
    });

    it('sends the no-thinking reminder on the retry prompt', async () => {
      chat.mockImplementationOnce(response('Need to construct the index.', true))
        .mockImplementationOnce(response('{"nodes":[]}'));
      await kbChatJson('prompt', 'preamble');
      expect(chat.mock.calls[1][0].prompt).toContain('不要输出思考过程');
    });
  });

  it('does not swallow an error event with an empty error payload', async () => {
    chat.mockImplementation(async (params) => { params.onEvent({type: 'text', content: '{"nodes":[]}'}); params.onEvent({type: 'error', content: ''}); });
    await expect(kbChatJson('prompt', 'preamble')).rejects.toThrow(/chat error/);
    expect(chat).toHaveBeenCalledTimes(1);
  });

  it('keeps the original model pair during the correction attempt', async () => {
    chat.mockImplementationOnce(async (params) => {
      params.onEvent({type: 'text', content: 'Not JSON'});
      params.onEvent({type: 'done'});
      useAiConfigStore.setState({chatModel: 'different-model'});
    }).mockImplementationOnce(response('{"nodes":[]}'));
    await kbChatJson('original task', 'original instructions');
    expect(chat.mock.calls.map(([params]) => params.model)).toEqual(['test-model', 'test-model']);
    expect(chat.mock.calls[1][0].preamble).toBe('original instructions');
  });

});

describe('stream handler passthrough (onChunk / onThinking)', () => {
  it('kbChatJson forwards text and thinking increments without changing the result', async () => {
    chat.mockImplementation(async (params) => {
      params.onEvent({ type: 'thinking', content: 'think-1 ' });
      params.onEvent({ type: 'text', content: '{"nodes":' });
      params.onEvent({ type: 'thinking', content: 'think-2' });
      params.onEvent({ type: 'text', content: '[]}' });
      params.onEvent({ type: 'done' });
    });
    const chunks: string[] = [];
    const thinking: string[] = [];
    await expect(kbChatJson('prompt', 'preamble', { onChunk: (t) => chunks.push(t), onThinking: (t) => thinking.push(t) })).resolves.toEqual({ nodes: [] });
    expect(chunks).toEqual(['{"nodes":', '[]}']);
    expect(thinking).toEqual(['think-1 ', 'think-2']);
  });

  it('kbChatText forwards body increments and still returns the full text', async () => {
    chat.mockImplementation(async (params) => {
      params.onEvent({ type: 'text', content: 'Hello ' });
      params.onEvent({ type: 'text', content: 'world' });
      params.onEvent({ type: 'done' });
    });
    const chunks: string[] = [];
    await expect(kbChatText('prompt', 'preamble', { onChunk: (t) => chunks.push(t) })).resolves.toBe('Hello world');
    expect(chunks).toEqual(['Hello ', 'world']);
  });
});
