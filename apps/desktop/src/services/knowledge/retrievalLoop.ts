/**
 * 检索循环（ADR-0008）：程序驱动的多轮检索。
 *
 * 模型每轮返回一个 JSON 动作（list_topics / open_topic / search / read_source / done），
 * 程序执行动作、回填观测、累积结构化证据。程序约束（不依赖模型自律）：
 * - 10 秒墙钟（默认，仅计检索，不含回答生成）；
 * - 最大 8 轮；
 * - 每轮读取量上限（默认 4000 字符，观测与证据文本都被截断到该上限）。
 * 到限返回已有证据与未解决的缺口。循环只产出结构化证据；回答层独立（kbAsk）。
 *
 * ponytail: 墙钟检查在每轮边界执行 —— 一次进行中的模型调用无法中断，
 * 最坏情况是超限一次调用的时长（轮数上限同时兜底）。要硬截止需给
 * runRigChat 加 abort，届时在这里接线。
 *
 * 动作执行端口由调用方注入（kbAsk 接真实 BM25 + fs；测试注入假件）。
 */

import { extractJsonObject } from '@/services/aiStreamUtils';
import { errText } from '@/utils/errText';
import { kbRetrievalPrompt } from './kbPrompts';
import type { KbEvidence } from './kbTypes';
import i18n from '@/i18n';

export type RetrievalAction =
  | { action: 'list_topics' }
  | { action: 'open_topic'; args: { tpId: string } }
  | { action: 'search'; args: { query: string } }
  | { action: 'read_source'; args: { srcId: string; startLine?: number; endLine?: number } }
  | { action: 'done' };

export interface RetrievalPorts {
  /** 模型调用：prompt -> 原始文本（由 kbLlm 提供；测试注入脚本化假件）。 */
  askModel: (prompt: string) => Promise<string>;
  listTopics: () => Promise<string>;
  openTopic: (tpId: string) => Promise<{ observation: string; evidence: KbEvidence | null }>;
  search: (query: string) => Promise<string>;
  readSource: (srcId: string, startLine?: number, endLine?: number) => Promise<{ observation: string; evidence: KbEvidence | null }>;
}

export interface RetrievalBudget {
  maxRounds?: number;
  timeMs?: number;
  roundCharCap?: number;
  /** 程序侧取消检查（轮边界）：返回 true 时停止后续轮次并返回已找到的证据。
   * 进行中的模型调用无法中断 —— 取消最快在当前调用返回后生效（轮数与
   * 墙钟上限同时兜底）。要硬取消需给 runRigChat 加 abort，届时接线。 */
  shouldCancel?: () => boolean;
  /** 每轮开始时回调（round 为 1-based 轮次号），供 UI 展示检索进度。 */
  onRound?: (round: number) => void;
}

export interface RetrievalResult {
  evidence: KbEvidence[];
  rounds: number;
  stoppedBy: 'done' | 'rounds' | 'time' | 'cancelled' | 'parse-error';
  note: string;
}

/** 数值预算的解析后形状；回调类（shouldCancel/onRound）保持可选。 */
type ResolvedBudget = Omit<Required<RetrievalBudget>, 'shouldCancel' | 'onRound'> &
  Pick<RetrievalBudget, 'shouldCancel' | 'onRound'>;

export const DEFAULT_BUDGET: ResolvedBudget = {
  maxRounds: 8,
  timeMs: 10_000,
  roundCharCap: 4_000,
};

const MAX_CONSECUTIVE_PARSE_FAILURES = 2;

export function parseRetrievalAction(text: string): RetrievalAction | null {
  const raw = extractJsonObject(text);
  if (!raw) return null;
  try {
    const obj = JSON.parse(raw) as Record<string, unknown>;
    const action = obj['action'];
    const args = (obj['args'] ?? {}) as Record<string, unknown>;
    switch (action) {
      case 'list_topics':
      case 'done':
        return { action } as RetrievalAction;
      case 'open_topic':
        if (typeof args['tpId'] === 'string' && args['tpId']) return { action, args: { tpId: args['tpId'] } };
        return null;
      case 'search':
        if (typeof args['query'] === 'string' && args['query'].trim()) return { action, args: { query: args['query'] } };
        return null;
      case 'read_source': {
        if (typeof args['srcId'] !== 'string' || !args['srcId']) return null;
        const isPosInt = (v: unknown): v is number =>
          typeof v === 'number' && Number.isInteger(v) && v >= 1;
        const s = isPosInt(args['startLine']) ? args['startLine'] : undefined;
        const e = isPosInt(args['endLine']) ? args['endLine'] : undefined;
        return {
          action,
          args: {
            srcId: args['srcId'],
            ...(s !== undefined ? { startLine: s } : {}),
            ...(e !== undefined ? { endLine: e } : {}),
          },
        };
      }
      default:
        return null;
    }
  } catch {
    return null;
  }
}

function evidenceKey(e: KbEvidence): string {
  return `${e.kind}:${e.srcId ?? e.tpId ?? e.path}:${e.startLine ?? 0}-${e.endLine ?? 0}`;
}

export async function runRetrievalLoop(
  question: string,
  ports: RetrievalPorts,
  budget: RetrievalBudget = {},
): Promise<RetrievalResult> {
  const { maxRounds, timeMs, roundCharCap } = { ...DEFAULT_BUDGET, ...budget };
  const deadline = Date.now() + timeMs;
  const history: string[] = [];
  const evidence: KbEvidence[] = [];
  const seen = new Set<string>();
  let rounds = 0;
  let parseFailures = 0;

  while (true) {
    if (budget.shouldCancel?.()) {
      // 用户停止：已找到的证据照常返回（丢弃证据 = 数据损失，绝不做）。
      return { evidence, rounds, stoppedBy: 'cancelled', note: i18n.t('knowledge:ask.retrieval.cancelled') };
    }
    if (Date.now() >= deadline) {
      return { evidence, rounds, stoppedBy: 'time', note: i18n.t('knowledge:ask.retrieval.timeLimit', { seconds: timeMs / 1000 }) };
    }
    if (rounds >= maxRounds) {
      return { evidence, rounds, stoppedBy: 'rounds', note: i18n.t('knowledge:ask.retrieval.roundLimit', { rounds: maxRounds }) };
    }

    budget.onRound?.(rounds + 1);

    let text: string;
    try {
      text = await ports.askModel(kbRetrievalPrompt(question, history));
    } catch (err) {
      return {
        evidence,
        rounds,
        stoppedBy: 'parse-error',
        note: i18n.t('knowledge:ask.retrieval.modelError', { error: errText(err) }),
      };
    }
    rounds++;

    const action = parseRetrievalAction(text);
    if (!action) {
      parseFailures++;
      history.push(`模型返回了无法解析的动作，已要求重新输出。原始输出片段：${text.slice(0, 200)}`);
      if (parseFailures >= MAX_CONSECUTIVE_PARSE_FAILURES) {
        return { evidence, rounds, stoppedBy: 'parse-error', note: i18n.t('knowledge:ask.retrieval.parseError') };
      }
      continue;
    }
    parseFailures = 0;

    let observation: string;
    let evidenceItem: KbEvidence | null = null;
    switch (action.action) {
      case 'list_topics':
        observation = await ports.listTopics();
        break;
      case 'search':
        observation = await ports.search(action.args.query);
        break;
      case 'open_topic': {
        const r = await ports.openTopic(action.args.tpId);
        observation = r.observation;
        evidenceItem = r.evidence;
        break;
      }
      case 'read_source': {
        const r = await ports.readSource(action.args.srcId, action.args.startLine, action.args.endLine);
        observation = r.observation;
        evidenceItem = r.evidence;
        break;
      }
      case 'done':
        return { evidence, rounds, stoppedBy: 'done', note: i18n.t('knowledge:ask.retrieval.done') };
    }

    if (evidenceItem) {
      const capped: KbEvidence = { ...evidenceItem, text: evidenceItem.text.slice(0, roundCharCap) };
      const key = evidenceKey(capped);
      if (!seen.has(key)) {
        seen.add(key);
        evidence.push(capped);
      }
    }
    history.push(`${JSON.stringify(action)}\n${observation.slice(0, roundCharCap)}`);
  }
}
