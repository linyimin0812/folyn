/**
 * 知识库模型调用桥 —— 只走 runRigChat（chat_stream，无工具无文件访问），
 * `historyMode: 'none'` 保证每次调用独立（ADR-0006：模型提议、程序写入）。
 *
 * AI 配置复用现有聊天设置链路：优先 aiConfigStore 的 kbPair（用户在知识库
 * 面板显式选择的对），未选择时回落全局 chatProvider/chatModel，经
 * resolvePairConfig 解析（与 Bubble Template / Pet 同一条链路）。
 */

import { runRigChat } from '@/services/rigChat';
import { extractJsonObject } from '@/services/aiStreamUtils';
import { resolvePairConfig, useAiConfigStore } from '@/store/aiConfigStore';
import { generateShortId } from '@/utils/idGenerator';
import { errText } from '@/utils/errText';

/** 解析知识库模型对；未配置或缺 key 返回 null。
 *  与 voice/extension 的「null 即空态」不同：kbPair 为 null 时回落全局
 *  chatProvider/chatModel —— 显式选择覆盖全局，未选择跟全局（保持开箱即用）。 */
export function resolveKbChatPair() {
  const s = useAiConfigStore.getState();
  const pair = s.kbPair ?? { provider: s.chatProvider, model: s.chatModel };
  return resolvePairConfig(pair);
}

/** 单次独立调用，收集全部文本。error 事件记下后在 invoke 返回后抛出。 */
export async function kbChatText(prompt: string, preamble: string): Promise<string> {
  const pair = resolveKbChatPair();
  if (!pair) {
    throw new Error('未配置可用的聊天模型，请先在设置中配置 AI 聊天 Provider 与模型');
  }
  let text = '';
  let err: string | null = null;
  await runRigChat({
    sessionId: `kb-${generateShortId()}`,
    prompt,
    preamble,
    provider: pair.provider,
    model: pair.model,
    apiKey: pair.apiKey,
    baseUrl: pair.baseUrl || undefined,
    adapterFamily: pair.adapterFamily,
    thinkingBudget: pair.thinkingBudget,
    historyMode: 'none',
    onEvent: (e) => {
      if (e.type === 'text' && e.content) text += e.content;
      else if (e.type === 'error') err = e.content ?? 'chat error';
    },
  });
  if (err) throw new Error(err);
  return text.trim();
}

/** 单次独立调用并抠 JSON（extractJsonObject 容忍代码围栏/散文包裹）。 */
export async function kbChatJson<T>(prompt: string, preamble: string): Promise<T> {
  const text = await kbChatText(prompt, preamble);
  const raw = extractJsonObject(text);
  if (!raw) throw new Error('模型未返回 JSON');
  try {
    return JSON.parse(raw) as T;
  } catch (err) {
    throw new Error(`模型返回的 JSON 解析失败: ${errText(err)}`);
  }
}
