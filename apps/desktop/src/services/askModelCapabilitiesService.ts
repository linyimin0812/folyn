// AI 模型能力查询 (Ask AI for model capabilities) — headless service.
//
// Pattern B (AI as JSON advisor): send model id + provider name → AI returns a
// 6-boolean JSON → caller applies via modelRegistryStore.setModelCapabilities.
// Uses the user's currently-configured chat provider (aiConfigStore.chat*)
// via runRigChat — no CLI adapter, no separate binary.

import { runRigChat } from './rigChat';
import { useAiConfigStore } from '@/store/aiConfigStore';
import type { CliStreamEvent } from '@quill/cli-adapter';
import type { Capability } from './modelRegistry/types';
import type { StreamEvent } from './aiStreamUtils';

export interface ModelCapabilitiesResult {
  capabilities: Capability[];
}

const CAP_KEYS: { key: Capability; jsonField: string }[] = [
  { key: 'reasoning', jsonField: 'reasoning' },
  { key: 'function-call', jsonField: 'function-call' },
  { key: 'vision', jsonField: 'vision' },
  { key: 'web-search', jsonField: 'web-search' },
  { key: 'embedding', jsonField: 'embedding' },
  { key: 'rerank', jsonField: 'rerank' },
];

function buildPrompt(modelId: string, providerName: string): string {
  return [
    'You are a model-capability classifier. Given a model id and its provider,',
    'decide which of the following six capabilities the model supports.',
    '',
    `Model id: ${modelId}`,
    `Provider: ${providerName}`,
    '',
    'Capabilities (boolean, true iff the model supports it):',
    '- reasoning: chain-of-thought / explicit reasoning tokens',
    '- function-call: tool / function calling',
    '- vision: image input',
    '- web-search: built-in web search',
    '- embedding: produces embedding vectors (NOT a chat model)',
    '- rerank: reranks documents (NOT a chat model)',
    '',
    'Return STRICT JSON ONLY — no prose, no code fences:',
    '{"reasoning":bool,"function-call":bool,"vision":bool,"web-search":bool,"embedding":bool,"rerank":bool}',
    'If you are unsure, default to false.',
  ].join('\n');
}

export function parseCapabilities(aiText: string): ModelCapabilitiesResult {
  // ponytail: same extractor as planMyDayService — pull the first {...} out
  // of AI text that may be wrapped in prose or code fences.
  const match = aiText.match(/\{[\s\S]*\}/);
  const jsonStr = match ? match[0] : null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonStr ?? aiText);
  } catch {
    throw new Error('AI 返回的能力信息无法解析');
  }
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('AI 返回的能力信息无法解析');
  }
  const obj = parsed as Record<string, unknown>;
  const capabilities: Capability[] = [];
  for (const { key, jsonField } of CAP_KEYS) {
    if (obj[jsonField] === true) capabilities.push(key);
  }
  return { capabilities };
}

/**
 * Call the user's currently-configured chat model (aiConfigStore.chat*) to
 * classify `modelId`. Streams text + thinking chunks to the optional
 * callbacks; resolves to the 6-boolean result.
 */
export async function askModelCapabilities(
  modelId: string,
  providerName: string,
  onChunk?: (text: string) => void,
  onEvent?: (event: StreamEvent) => void,
): Promise<ModelCapabilitiesResult> {
  const cfg = useAiConfigStore.getState();
  if (!cfg.chatProvider || !cfg.chatModel) {
    throw new Error('未配置聊天模型，请先在模型服务页选好 provider + model + apiKey');
  }

  let text = '';
  const sessionId = `ask-capabilities-${Date.now()}`;

  await runRigChat({
    sessionId,
    prompt: buildPrompt(modelId, providerName),
    provider: cfg.chatProvider,
    model: cfg.chatModel,
    apiKey: cfg.chatApiKey,
    baseUrl: cfg.chatBaseUrl || undefined,
    azureDeploymentId: cfg.chatAzureDeploymentId || undefined,
    azureApiVersion: cfg.chatAzureApiVersion || undefined,
    historyMode: 'none',
    onEvent: (event: CliStreamEvent) => {
      if (event.type === 'text' && event.content) {
        text += event.content;
        onChunk?.(event.content);
        onEvent?.({ kind: 'text', content: event.content });
      } else if (event.type === 'thinking' && event.content) {
        onEvent?.({ kind: 'thinking', content: event.content });
      } else if (event.type === 'error') {
        throw new Error(event.content || 'chat error');
      }
    },
  });

  return parseCapabilities(text);
}
