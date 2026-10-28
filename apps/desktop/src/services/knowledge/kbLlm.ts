/**
 * 知识库模型调用桥 —— 只走 runRigChat（chat_stream，无工具无文件访问），
 * `historyMode: 'none'` 保证每次调用独立（ADR-0006：模型提议、程序写入）。
 *
 * AI 配置复用现有聊天设置链路：优先 aiConfigStore 的 kbPair（用户在知识库
 * 面板显式选择的对），未选择时回落全局 chatProvider/chatModel，经
 * resolvePairConfig 解析（与 Bubble Template / Pet 同一条链路）。
 */

import { extractJsonObject } from '@/services/aiStreamUtils';
import { runRigChat } from '@/services/rigChat';
import { resolvePairConfig, useAiConfigStore } from '@/store/aiConfigStore';
import { generateShortId } from '@/utils/idGenerator';

/** 解析知识库模型对；未配置或缺 key 返回 null。
 *  与 voice/extension 的「null 即空态」不同：kbPair 为 null 时回落全局
 *  chatProvider/chatModel —— 显式选择覆盖全局，未选择跟全局（保持开箱即用）。 */
export function resolveKbChatPair() {
  const s = useAiConfigStore.getState();
  const pair = s.kbPair ?? { provider: s.chatProvider, model: s.chatModel };
  return resolvePairConfig(pair);
}

function requireChatPair() {
  const pair = resolveKbChatPair();
  if (!pair) throw new Error('未配置可用的聊天模型，请先在设置中配置 AI 聊天 Provider 与模型');
  return pair;
}

/** 输出上限（tok数）。推理型模型把大量预算花在 reasoning 上，端点默认上限（常为 4k
 *  或更低）会在 JSON 中途截断 —— 思考末尾节选显示逐行列举原文烧光预算是本次根因之一。
 *  16384 覆盖常见端点；端点上限更低时由其自行 clamp 或报错（错误信息已含截断诊断）。 */
const KB_MAX_OUTPUT_TOKENS = 16384;

/** 全局在途 LLM 调用上限（单一常量处控制）：并行构建（资料级 + 块级）下
 *  所有 kbChatText / kbChatJson（含格式纠错的第二次调用）共用此闸门，
 *  避免触发 provider 速率限制。 */
export const KB_MAX_CONCURRENT_LLM_CALLS = 6;

let llmActive = 0;
const llmWaiters: (() => void)[] = [];

// ponytail: 全局单一闸门（简单计数 + FIFO 等待），锁粒度粗；如需按 provider
// 分配额度再升级为按 pair 的多闸门。
async function withLlmSlot<T>(call: () => Promise<T>): Promise<T> {
  while (llmActive >= KB_MAX_CONCURRENT_LLM_CALLS) {
    await new Promise<void>((release) => llmWaiters.push(release));
  }
  llmActive++;
  try {
    return await call();
  } finally {
    llmActive--;
    llmWaiters.shift()?.();
  }
}

/** 流式透出句柄：正文/思考增量原样发出，不改变返回值、重试与兜底行为。 */
export interface KbChatStreamHandlers {
  /** 正文增量（collectResponse 的 text 累积处发出）。 */
  onChunk?: (text: string) => void;
  /** 思考增量（collectResponse 的 thinking 累积处发出）。 */
  onThinking?: (text: string) => void;
}

/** Provider failures propagate unchanged; thinking text is only mined as a
 *  last-resort JSON source (see kbChatJson) and never silently merged into answer text. */
async function collectResponse(
  prompt: string,
  preamble: string,
  pair: ReturnType<typeof requireChatPair>,
  stream?: KbChatStreamHandlers,
) {
  let text = '';
  let thinking = '';
  let doneObserved = false;
  let err: string | null = null;
  await withLlmSlot(() => runRigChat({
    sessionId: `kb-${generateShortId()}`,
    prompt,
    preamble,
    provider: pair.provider,
    model: pair.model,
    apiKey: pair.apiKey,
    baseUrl: pair.baseUrl || undefined,
    adapterFamily: pair.adapterFamily,
    // 知识库的索引/合成/检索动作/核验都是结构化 JSON 任务，禁用思考：开启时
    // 思考会耗尽输出预算导致空正文（Rust 侧 thinking_params 对 None 不加参数）。
    // 如未来某任务确实需要思考，单独传 thinkingBudget，不要改回 pair.thinkingBudget。
    thinkingBudget: null,
    maxTokens: KB_MAX_OUTPUT_TOKENS,
    historyMode: 'none',
    onEvent: (e) => {
      if (e.type === 'text' && e.content) { text += e.content; stream?.onChunk?.(e.content); }
      else if (e.type === 'thinking' && e.content) { thinking += e.content; stream?.onThinking?.(e.content); }
      else if (e.type === 'done') doneObserved = true;
      else if (e.type === 'error') err = e.content ?? 'chat error';
    },
  }));
  if (err !== null) throw new Error(err || 'chat error');
  return { text: text.trim(), thinking: thinking.trim(), doneObserved };
}

/** Independent text call, with no conversation history or file access.
 *  空正文不在这里重试（与 kbChatJson 的刻意差异）：检索动作/回答层调用有自己的
 *  终止与预算逻辑（连续非法动作终止、墙钟预算），在这里重试会吃预算；
 *  空正文走 retrievalLoop 的 error 路径即可。 */
export async function kbChatText(prompt: string, preamble: string, stream?: KbChatStreamHandlers): Promise<string> {
  return (await collectResponse(prompt, preamble, requireChatPair(), stream)).text;
}

function parseObject(text: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(text);
    return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

/** Scan complete containers, respecting JSON strings/escapes and never entering a truncated parent. */
function scanObjects(text: string) {
  const objects: Record<string, unknown>[] = [];
  const stack: string[] = [];
  let start = -1;
  let quoted = false;
  let escaped = false;
  let nonObject = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (stack.length === 0) {
      if (char === '{' || char === '[') { start = i; stack.push(char); }
      continue;
    }
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') quoted = false;
    } else if (char === '"') quoted = true;
    else if (char === '{' || char === '[') stack.push(char);
    else if (char === '}' || char === ']') {
      if (stack.pop() !== (char === '}' ? '{' : '[')) return { objects: [], incomplete: true, nonObject: false };
      if (stack.length === 0) {
        const candidate = text.slice(start, i + 1);
        const value = parseObject(candidate);
        if (value) objects.push(value);
        else if (candidate.startsWith('[')) {
          try { JSON.parse(candidate); nonObject = true; } catch { /* A prose bracket is not JSON. */ }
        }
      }
    }
  }
  return { objects, incomplete: stack.length > 0, nonObject };
}

function responseObject(text: string): Record<string, unknown> | null {
  const fencePattern = /```(?:json)?[ \t]*\r?\n([\s\S]*?)```/gi;
  const fenced = [...text.matchAll(fencePattern)]
    .map((match) => parseObject(match[1].trim()))
    .filter((value): value is Record<string, unknown> => value !== null);
  if (fenced.length > 0) {
    // Explicit JSON fences take precedence over prose braces, but not another valid object.
    const outside = scanObjects(text.replace(fencePattern, ''));
    return fenced.length === 1 && outside.objects.length === 0 && !outside.nonObject ? fenced[0] : null;
  }
  const result = scanObjects(text);
  return !result.incomplete && !result.nonObject && result.objects.length === 1 ? result.objects[0] : null;
}

/** 尾部 400 字符内简单计数未闭合的 { / [（忽略字符串内括号，只作截断提示）。 */
function hasUnclosedBracket(tail: string): boolean {
  let depth = 0;
  for (const char of tail) {
    if (char === '{' || char === '[') depth++;
    else if (char === '}' || char === ']') depth = Math.max(0, depth - 1);
  }
  return depth > 0;
}

/** 空正文且思考里也抠不出 JSON 时的诊断性报错：附思考尾部节选与截断猜测。 */
function throwThinkingOnlyError(thinking: string): never {
  console.warn('[kb] thinking tail:', thinking.slice(-2000));
  const tail = thinking.slice(-400);
  const preview = (thinking.length > 400 ? '…' : '') + tail;
  const truncated = hasUnclosedBracket(tail) ? '（检测到未闭合括号，疑似被截断）' : '';
  throw new Error(
    `模型仅返回思考过程且其中未找到可解析的 JSON（思考末尾节选：${preview}）${truncated}；` +
    '可能被输出上限截断，请更换模型或提高该端点的输出上限后重试',
  );
}

/** One bounded correction for textual format failures; callers still validate all domain fields. */
export async function kbChatJson<T>(prompt: string, preamble: string, stream?: KbChatStreamHandlers): Promise<T> {
  const pair = requireChatPair();
  for (let attempt = 0; attempt < 2; attempt++) {
    const reminder = '请严格遵守原请求的数据结构。只返回一个完整、合法的 JSON 对象，不要解释、代码围栏或多个备选对象；不要编造缺失的信息。不要输出思考过程，直接返回结果。';
    const result = await collectResponse(attempt === 0 ? prompt : `${prompt}\n\n${reminder}`, preamble, pair, stream);
    if (!result.text) {
      // attempt 0 的空正文多为推理型模型瞬时截断 —— 不直接抛，走第二次提醒重试。
      if (attempt === 0) continue;
      // 兜底：某些推理模型无法真正关闭思考，正文被思考挤空时，思考里往往已经
      // 推导出完整 JSON。依次尝试：严格单对象路径 → 贪婪围栏容忍路径；抠到就
      // 走正常领域校验；都失败才带诊断信息报"仅返回思考过程"。
      if (result.thinking) {
        const strict = responseObject(result.thinking);
        if (strict) return strict as T;
        const greedyRaw = extractJsonObject(result.thinking);
        const greedy = greedyRaw ? parseObject(greedyRaw) : null;
        if (greedy) return greedy as T;
        throwThinkingOnlyError(result.thinking);
      }
      throw new Error(result.doneObserved
        ? '模型返回空响应，没有可用正文；请检查模型配置或稍后重试'
        : '模型调用结束时未收集到正文，也未收到流结束事件；请重试并检查模型连接');
    }
    const value = responseObject(result.text);
    if (value) return value as T;
    if (attempt === 1) throw new Error('模型未返回 JSON 或 JSON 格式无效（已重试一次）；请重试此资料，或更换整理模型');
  }
  throw new Error('模型未返回 JSON');
}
