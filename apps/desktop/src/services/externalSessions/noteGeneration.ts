/**
 * AI-organized notes (slice 5) — generate a standalone knowledge note from
 * EXACTLY the user's selection.
 *
 * The model input is built from the same selection snapshot the verbatim
 * capture uses (`SaveCaptureInput` → `resolveSelectionParts`): whole message
 * blocks, text ranges with only the selected excerpt, correlated tool
 * records, and obtainable inline images. Unselected messages, surrounding
 * history and sibling branches are absent by construction.
 *
 * Requests go through the app's single model bridge `runRigChat` with
 * `historyMode: 'none'` (an isolated turn — no prior chat history is loaded
 * and nothing is persisted) and a feature preamble. Nothing is written to any
 * vault here; the edited draft is saved via the capture service only after
 * the user confirms.
 *
 * Every failure is a typed, explicit error — never a silent fallback:
 *  - NoModelConfiguredError        no usable chat pair configured
 *  - SelectionTooLargeError        request exceeds the conservative limit
 *  - UnsupportedImageModelError    selected images but the model's vision
 *                                  capability is false or unknowable
 *  - InsufficientContextError      the model itself judged the material
 *                                  insufficient (INSUFFICIENT_CONTEXT marker)
 *  - NoteGenerationCancelledError  user cancelled (polled between events)
 */

import type { RigChatImage } from '@/services/rigChat';
import { errorToMessage } from './errorToMessage';
import type { SaveCaptureInput } from './captureService';
import { resolveSelectionParts } from './captureService';

export class NoModelConfiguredError extends Error {
  constructor() {
    super('no usable chat model configured');
  }
}

export class SelectionTooLargeError extends Error {
  constructor(public readonly actualChars: number, public readonly limit: number) {
    super(`selection too large for the model: ${actualChars} chars > ${limit}`);
  }
}

export class UnsupportedImageModelError extends Error {
  constructor(
    public readonly provider: string,
    public readonly model: string,
    public readonly imageCount: number,
  ) {
    super(`model ${provider}/${model} does not support image input (or capability unknown)`);
  }
}

export class InsufficientContextError extends Error {
  constructor() {
    super('selected material is insufficient for a knowledge note');
  }
}

export class NoteGenerationCancelledError extends Error {
  constructor() {
    super('note generation cancelled');
  }
}

/**
 * ponytail: honest conservative ceiling. rigChat exposes no context-size
 * information, so assume the worst token density (≈1 token per char, CJK)
 * and cap the whole request (prompt + image base64) at ~100k tokens, leaving
 * room for the note output on a 128k-context model. Replace with a
 * provider-aware limit when rigChat exposes one.
 */
export const NOTE_INPUT_CHAR_LIMIT = 100_000;

/** The preamble instructs the model to reply with exactly this line when the
 * material is too thin to organize into a useful note. */
export const INSUFFICIENT_CONTEXT_MARKER = 'INSUFFICIENT_CONTEXT';

export const NOTE_SYSTEM_PREAMBLE = [
  '你是一名技术知识整理助手。用户会提供从编程助手会话中精选的原始材料（对话正文、代码、工具调用与结果、图片）。',
  '任务：把材料整理成一篇独立可读的中文 Markdown 知识笔记。',
  '要求：',
  '- 提炼可复用的结论、步骤与注意事项，用标题和小节组织；',
  '- 关键代码、命令和报错保留原文（使用代码块）；',
  '- 只依据给定材料，不引入外部信息，不猜测补全；',
  '- 直接输出 Markdown 正文，不要输出任何前后缀说明。',
  `如果材料信息不足以整理出有价值的笔记，只输出一行：${INSUFFICIENT_CONTEXT_MARKER}`,
].join('\n');

export interface NotePromptMaterial {
  prompt: string;
  images: RigChatImage[];
}

function fenceFor(content: string): string {
  const runs = content.match(/`{3,}/g) ?? [];
  const longest = runs.reduce((max, r) => Math.max(max, r.length), 0);
  return '`'.repeat(Math.max(3, longest + 1));
}

function dataUrlToRigImage(dataUrl: string): RigChatImage | null {
  const m = /^data:([^;]+);base64,(.+)$/s.exec(dataUrl);
  if (!m) return null;
  return { mediaType: m[1]!, data: m[2]! };
}

/**
 * Pure: build the model input from the selection snapshot. Mirrors the
 * capture resolution (whole-message supersedes a range on the same message)
 * so the AI input and the saved evidence describe the same selection. The
 * raw JSONL records are deliberately NOT included — the model organizes the
 * readable material, the evidence bundle keeps the verbatim records.
 */
export function buildNotePrompt(input: SaveCaptureInput): NotePromptMaterial {
  const { whole, ranged } = resolveSelectionParts(input);
  const s = input.detail.summary;
  const lines: string[] = [];
  const images: RigChatImage[] = [];

  lines.push(
    `以下是从 ${s.source} 会话「${s.title || s.sessionId}」中精选的素材（项目：${s.cwd ?? '未知'}），请整理成知识笔记：`,
  );
  lines.push('');

  const pushFenced = (label: string, content: string) => {
    const fence = fenceFor(content);
    lines.push(`### ${label}`);
    lines.push(fence);
    lines.push(content);
    lines.push(fence);
    lines.push('');
  };

  whole.forEach((msg, idx) => {
    lines.push(`## ${idx + 1}. ${msg.role === 'user' ? '用户' : '助手'}`);
    lines.push('');
    if (msg.content !== '') pushFenced('正文', msg.content);
    for (const call of msg.toolCalls) {
      pushFenced(`工具调用 ${call.name} — 输入`, call.input);
      if (call.output != null) {
        pushFenced(`工具调用 ${call.name} — 输出`, call.output);
      } else {
        lines.push(`（工具 ${call.name} 的结果在源记录中缺失，未提供）`);
        lines.push('');
      }
    }
    for (const img of msg.images) {
      const parsed = dataUrlToRigImage(img.dataUrl);
      if (parsed) {
        images.push(parsed);
        lines.push(`[所选图片 ${images.length}，随本条消息作为附件提供]`);
      } else {
        lines.push('[所选图片无法解码，未提供给模型]');
      }
      lines.push('');
    }
  });

  ranged.forEach((entry, idx) => {
    const text = entry.ranges.map((r) => entry.message.content.slice(r.start, r.end)).join('\n…\n');
    lines.push(`## ${whole.length + idx + 1}. ${entry.message.role === 'user' ? '用户' : '助手'}（节选）`);
    lines.push('');
    pushFenced('节选正文（仅所选文字，不含消息其余内容）', text);
  });

  return { prompt: lines.join('\n'), images };
}

export interface GenerateNoteOptions {
  /** Text-only processing — the explicit user choice after
   * `UnsupportedImageModelError`: images stay out of the model input but
   * remain in the saved evidence bundle. */
  includeImages?: boolean;
  /** Polled before the request, between stream events and after completion;
   * a true result aborts generation (nothing is written). */
  cancelled?: () => boolean;
  /** The user's explicit (provider, model) choice for this flow (the Sessions
   * pair selector — e.g. switching providers after a quota error). Absent or
   * null → the app default (global chat pair, else first enabled pair), the
   * unchanged prior behavior. A chosen pair that cannot resolve (provider
   * disabled / key missing) is NOT silently fallen back — it surfaces
   * NoModelConfiguredError like any unusable configuration. */
  pair?: { provider: string; model: string } | null;
}

/**
 * Generate the note markdown for a selection. Resolves the chat pair like
 * the other one-shot AI features — `opts.pair` (the user's per-flow choice)
 * first, then the global chat pair, else the first enabled pair; throws the
 * typed errors above; never writes anything.
 */
export async function generateSessionNote(
  input: SaveCaptureInput,
  opts: GenerateNoteOptions = {},
): Promise<string> {
  if (opts.cancelled?.()) throw new NoteGenerationCancelledError();

  const { useAiConfigStore, resolvePairConfig, firstEnabledPair } = await import(
    '@/store/aiConfigStore'
  );
  const state = useAiConfigStore.getState();
  const chatPair = state.chatProvider && state.chatModel
    ? { provider: state.chatProvider, model: state.chatModel }
    : null;
  const cfg = resolvePairConfig(opts.pair ?? chatPair ?? firstEnabledPair(state), state);
  if (!cfg) throw new NoModelConfiguredError();

  const material = buildNotePrompt(input);
  const includeImages = opts.includeImages !== false;
  const images = includeImages ? material.images : [];

  if (images.length > 0) {
    // Vision capability: catalog entry ?? fetched models. Unknown model →
    // treat as unsupported (never send images on faith).
    const { findModelInCatalog } = await import('@/services/modelRegistry/loader');
    const { useModelRegistryStore } = await import('@/store/modelRegistryStore');
    const model =
      findModelInCatalog(cfg.provider, cfg.model) ??
      useModelRegistryStore.getState().modelsByProvider[cfg.provider]?.find((m) => m.id === cfg.model);
    const { isVisionModel } = await import('@/services/modelRegistry/merge');
    if (!model || !isVisionModel(model)) {
      throw new UnsupportedImageModelError(cfg.provider, cfg.model, images.length);
    }
  }

  const totalChars = material.prompt.length + images.reduce((n, i) => n + i.data.length, 0);
  if (totalChars > NOTE_INPUT_CHAR_LIMIT) {
    throw new SelectionTooLargeError(totalChars, NOTE_INPUT_CHAR_LIMIT);
  }

  const { runRigChat } = await import('@/services/rigChat');
  const { generateId } = await import('@/utils/idGenerator');
  let text = '';
  let errorText = '';
  let cancelledFlag = false;
  try {
    await runRigChat({
      // Fresh id per request — combined with historyMode 'none', no chat
      // history is ever loaded or persisted for note generation.
      sessionId: `session-note:${generateId()}`,
      prompt: material.prompt,
      provider: cfg.provider,
      model: cfg.model,
      apiKey: cfg.apiKey,
      ...(cfg.baseUrl ? { baseUrl: cfg.baseUrl } : {}),
      ...(cfg.thinkingBudget != null ? { thinkingBudget: cfg.thinkingBudget } : {}),
      ...(cfg.adapterFamily ? { adapterFamily: cfg.adapterFamily } : {}),
      historyMode: 'none',
      preamble: NOTE_SYSTEM_PREAMBLE,
      ...(images.length > 0 ? { images } : {}),
      onEvent: (ev) => {
        if (opts.cancelled?.()) {
          cancelledFlag = true;
          return;
        }
        if (ev.type === 'text' && ev.content) text += ev.content;
        // runRigChat forwards provider errors as error chunks without
        // rejecting the promise — capture them or the failure is silent.
        if (ev.type === 'error') {
          errorText = (errorText ? `${errorText}; ` : '') + (ev.content ?? 'chat error');
        }
      },
    });
  } catch (err) {
    if (opts.cancelled?.()) throw new NoteGenerationCancelledError();
    // runRigChat rejects with the raw invoke rejection — for the Rust
    // `chat_stream` command that is a plain `{category, detail}` AppError
    // object. Normalize HERE (the single boundary into the gen-fail state)
    // so every consumer sees a readable Error, never "[object Object]".
    throw new Error(errorToMessage(err));
  }
  if (cancelledFlag || opts.cancelled?.()) throw new NoteGenerationCancelledError();

  const note = text.trim();
  if (!note) throw new Error(errorText || 'empty response from the model');
  if (new RegExp(`^\\s*${INSUFFICIENT_CONTEXT_MARKER}\\s*$`, 'm').test(note)) {
    throw new InsufficientContextError();
  }
  return note;
}
