// AI 模型能力查询 (Ask AI for model capabilities) — headless service.
//
// Pattern B (AI as JSON advisor): send model id + provider name → AI returns a
// 6-boolean JSON → caller applies via modelRegistryStore.setModelCapabilities.
// Mirrors planMyDayService's adapter-call + JSON-parse + error-handling shape.
// No UI here; the row button wires the apply + toast undo.

import { createAdapter } from '@quill/cli-adapter';
import { useVaultStore } from '@/store/vaultStore';
import { useAiConfigStore } from '@/store/aiConfigStore';
import { collectTextFromStream, extractJsonObject, type StreamEvent } from './aiStreamUtils';
import { resolveBasePath } from '@/utils/pathResolver';
import type { Capability } from './modelRegistry/types';

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
  const jsonStr = extractJsonObject(aiText);
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

export async function askModelCapabilities(
  modelId: string,
  providerName: string,
  onChunk?: (text: string) => void,
  onEvent?: (event: StreamEvent) => void,
): Promise<ModelCapabilitiesResult> {
  const vault = useVaultStore.getState();
  if (!vault.currentVault) throw new Error('没有活跃的 vault');

  const aiConfig = useAiConfigStore.getState();
  const basePath = await resolveBasePath(vault.currentVault.basePath);

  const adapter = createAdapter(aiConfig.cliAdapter);
  await adapter.start({ cliPath: aiConfig.cliPath, workingDir: basePath });

  try {
    const textPromise = collectTextFromStream(adapter, onChunk, onEvent);
    await adapter.send(buildPrompt(modelId, providerName));
    const aiText = await textPromise;
    return parseCapabilities(aiText);
  } finally {
    await adapter.stop();
  }
}
