import { describe, it, expect, vi } from 'vitest';
import { runRetrievalLoop, parseRetrievalAction, type RetrievalPorts } from './retrievalLoop';
import type { KbEvidence } from './kbTypes';

function makePorts(script: string[]): { ports: RetrievalPorts; readCalls: string[] } {
  let call = 0;
  const readCalls: string[] = [];
  const ports: RetrievalPorts = {
    askModel: async () => script[Math.min(call++, script.length - 1)]!,
    listTopics: async () => '- tp-1「测试主题」',
    openTopic: async (tpId) => ({
      observation: `「${tpId}」正文`,
      evidence: {
        kind: 'topic',
        path: `__kb__/topics/${tpId}.md`,
        tpId,
        title: '测试主题',
        text: '主题正文内容',
      } satisfies KbEvidence,
    }),
    search: async () => `- [src-1] a.md（资料）score=1.0`,
    readSource: async (srcId, startLine, endLine) => {
      readCalls.push(`${srcId}:${startLine ?? ''}-${endLine ?? ''}`);
      return {
        observation: 'a.md L1-L3\n第一行\n第二行\n第三行',
        evidence: {
          kind: 'source',
          path: 'a.md',
          srcId,
          startLine: startLine ?? 1,
          endLine: endLine ?? 3,
          text: '第一行\n第二行\n第三行',
        } satisfies KbEvidence,
      };
    },
  };
  return { ports, readCalls };
}

describe('parseRetrievalAction', () => {
  it('parses fenced JSON actions', () => {
    expect(parseRetrievalAction('```json\n{"action":"done"}\n```')).toEqual({ action: 'done' });
    expect(parseRetrievalAction('{"action":"search","args":{"query":"窗口"}}')).toEqual({
      action: 'search',
      args: { query: '窗口' },
    });
  });

  it('returns null for malformed actions', () => {
    expect(parseRetrievalAction('没有任何 JSON')).toBeNull();
    expect(parseRetrievalAction('{"action":"open_topic","args":{}}')).toBeNull();
    expect(parseRetrievalAction('{"action":"teleport"}')).toBeNull();
  });
});

describe('runRetrievalLoop — 预算与停止条件', () => {
  it('stops on done and accumulates evidence', async () => {
    const { ports } = makePorts([
      '{"action":"search","args":{"query":"q"}}',
      '{"action":"read_source","args":{"srcId":"src-1","startLine":1,"endLine":3}}',
      '{"action":"done"}',
    ]);
    const result = await runRetrievalLoop('问题', ports);
    expect(result.stoppedBy).toBe('done');
    expect(result.rounds).toBe(3);
    expect(result.evidence).toHaveLength(1);
    expect(result.evidence[0]).toMatchObject({ kind: 'source', srcId: 'src-1', startLine: 1, endLine: 3 });
  });

  it('stops at maxRounds even if the model never says done', async () => {
    const { ports } = makePorts(['{"action":"search","args":{"query":"q"}}']);
    const result = await runRetrievalLoop('问题', ports, { maxRounds: 3 });
    expect(result.stoppedBy).toBe('rounds');
    expect(result.rounds).toBe(3);
    expect(result.note).toContain('最大检索轮数');
  });

  it('stops at the wall-clock budget', async () => {
    const { ports } = makePorts(['{"action":"search","args":{"query":"q"}}']);
    // timeMs: 0 → 首轮前的预算检查立即命中（墙钟检查先于任何模型调用）。
    const result = await runRetrievalLoop('问题', ports, { timeMs: 0 });
    expect(result.stoppedBy).toBe('time');
    expect(result.note).toContain('时间上限');
  });

  it('cancel at the round boundary keeps already-found evidence', async () => {
    // 程序侧取消（轮边界）：第 1 轮已取证，第 2 轮边界检测到取消 —— 证据不丢。
    let call = 0;
    const ports: RetrievalPorts = {
      askModel: async () => {
        call++;
        return call === 1
          ? '{"action":"read_source","args":{"srcId":"src-1","startLine":1,"endLine":3}}'
          : '{"action":"search","args":{"query":"q"}}';
      },
      listTopics: async () => 'ok',
      openTopic: async () => ({ observation: 'ok', evidence: null }),
      search: async () => 'ok',
      readSource: async (srcId, s, e) => ({
        observation: 'a.md L1-L3\n内容',
        evidence: { kind: 'source', path: 'a.md', srcId, startLine: s ?? 1, endLine: e ?? 3, text: '内容' } satisfies KbEvidence,
      }),
    };
    const result = await runRetrievalLoop('问题', ports, { shouldCancel: () => call >= 1 });
    expect(result.stoppedBy).toBe('cancelled');
    expect(result.rounds).toBe(1);
    expect(result.evidence).toHaveLength(1);
    expect(result.note).toContain('已停止');
  });

  it('terminates after consecutive unparseable model output', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { ports } = makePorts(['模型开始思考...', '我觉得应该继续找...']);
    const result = await runRetrievalLoop('问题', ports);
    expect(result.stoppedBy).toBe('parse-error');
    expect(result.rounds).toBe(2);
    warn.mockRestore();
  });

  it('caps observation + evidence text to roundCharCap and dedupes identical reads', async () => {
    const long = 'x'.repeat(1000);
    const ports: RetrievalPorts = {
      askModel: async () => '{"action":"done"}',
      listTopics: async () => 'ok',
      openTopic: async () => ({ observation: 'ok', evidence: null }),
      search: async () => 'ok',
      readSource: async (srcId) => ({
        observation: long,
        evidence: { kind: 'source', path: 'a.md', srcId, startLine: 1, endLine: 2, text: long },
      }),
    };
    // 首轮 read，第二轮 done —— 相同证据去重靠两次 read 同一范围触发。
    const script = ['{"action":"read_source","args":{"srcId":"src-1"}}', '{"action":"read_source","args":{"srcId":"src-1"}}', '{"action":"done"}'];
    let call = 0;
    ports.askModel = async () => script[Math.min(call++, script.length - 1)]!;
    const result = await runRetrievalLoop('问题', ports, { roundCharCap: 100 });
    expect(result.evidence).toHaveLength(1); // 去重
    expect(result.evidence[0]!.text.length).toBe(100); // 截断到每轮上限
  });
});
