/**
 * Behavior tests for AI-organized note generation (slice 5).
 *
 * The model bridge (`runRigChat`) and the config stores are stubbed at their
 * seams; the tests INSPECT the stub's input to prove the model receives
 * exactly the selection — no unselected content, no sibling branches, no
 * prior request history (historyMode 'none'), images only when the model
 * supports them. All explicit failure states (no model / too large /
 * image-unsupported / insufficient / cancelled / provider error) are covered
 * and never fall back silently.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  runRigChat: vi.fn(),
  aiState: {
    chatProvider: 'anthropic',
    chatModel: 'claude-sonnet-4-6',
    providerSettings: {
      anthropic: { apiKey: 'key-1', baseUrl: '' },
    } as Record<string, { apiKey: string; baseUrl: string }>,
  },
  modelsByProvider: {} as Record<string, unknown[]>,
  catalogModel: undefined as unknown,
}));

vi.mock('@/services/rigChat', () => ({ runRigChat: h.runRigChat }));

vi.mock('@/store/aiConfigStore', () => ({
  useAiConfigStore: { getState: () => h.aiState },
  resolvePairConfig: (pair: { provider: string; model: string } | null) => {
    const slot = pair ? h.aiState.providerSettings[pair.provider] : undefined;
    if (!pair || !slot) return null;
    return {
      provider: pair.provider,
      model: pair.model,
      apiKey: slot.apiKey,
      baseUrl: slot.baseUrl,
      thinkingBudget: null,
    };
  },
  firstEnabledPair: () => null,
}));

vi.mock('@/store/modelRegistryStore', () => ({
  useModelRegistryStore: { getState: () => ({ modelsByProvider: h.modelsByProvider }) },
}));

vi.mock('@/services/modelRegistry/loader', () => ({
  // catalog lookup stubbed so the vision check is deterministic per test
  findModelInCatalog: () => h.catalogModel,
}));

import {
  NOTE_INPUT_CHAR_LIMIT,
  NOTE_SYSTEM_PREAMBLE,
  INSUFFICIENT_CONTEXT_MARKER,
  buildNotePrompt,
  generateSessionNote,
  InsufficientContextError,
  NoModelConfiguredError,
  NoteGenerationCancelledError,
  SelectionTooLargeError,
  UnsupportedImageModelError,
} from './noteGeneration';
import type { RigChatParams, RigChatImage } from '@/services/rigChat';
import { parseCodexRollout } from './codexSessions';
import { parsePiSession } from './piSessions';
import { LINEAR_BRANCH } from './types';
import type { ExternalSessionDetail, ExternalSessionSummary } from './types';
import type { SaveCaptureInput } from './captureService';

// ── fixtures (same synthetic shapes as the capture tests) ───────────────────

const dataUrl = (bytes: number[], mime = 'image/png') =>
  `data:${mime};base64,${btoa(String.fromCharCode(...bytes))}`;

const rec = (type: string, payload: unknown, timestamp = '2026-10-10T10:00:00.000Z'): string =>
  JSON.stringify({ timestamp, type, payload });

const simpleRollout = [
  rec('session_meta', { session_id: 's', cwd: '/work/alpha' }),
  rec('response_item', {
    type: 'message', id: 'm1', role: 'user',
    internal_chat_message_metadata_passthrough: { content_item_kinds: ['user.text'] },
    content: [{ type: 'input_text', text: 'how to fix the login bug?' }],
  }),
  rec('response_item', { type: 'message', id: 'm2', role: 'assistant', content: [{ type: 'output_text', text: 'reset the token cache' }] }),
  rec('response_item', { type: 'function_call', call_id: 'c1', name: 'exec', input: '{"cmd":"ls"}' }),
  rec('response_item', { type: 'function_call_output', call_id: 'c1', output: '{"output":"a b"}' }),
].join('\n');

const summary: ExternalSessionSummary = {
  source: 'codex',
  sessionId: '11111111-2222-3333-4444-555555555555',
  filePath: '/home/u/.codex/sessions/2026/10/10/rollout-x.jsonl',
  title: 'Fix login',
  cwd: '/work/alpha',
  startedAt: Date.parse('2026-10-10T09:00:00.000Z'),
  updatedAt: null,
  parentSessionId: null,
};

function codexDetail(rolloutText: string): ExternalSessionDetail {
  const { messages, warnings } = parseCodexRollout(rolloutText);
  return { summary, messages, warnings, branch: LINEAR_BRANCH };
}

const visionModel = { id: 'm', providerId: 'anthropic', capabilities: ['vision'], inputModalities: ['text', 'image'] };

beforeEach(() => {
  h.runRigChat.mockReset();
  h.runRigChat.mockImplementation(async (p: RigChatParams) => {
    p.onEvent({ type: 'text', content: '# 整理后的笔记\n\n结论：重置令牌缓存。' });
    p.onEvent({ type: 'done' });
  });
  h.aiState.chatProvider = 'anthropic';
  h.aiState.chatModel = 'claude-sonnet-4-6';
  h.aiState.providerSettings = { anthropic: { apiKey: 'key-1', baseUrl: '' } };
  h.modelsByProvider = {};
  h.catalogModel = undefined;
});

describe('buildNotePrompt — the model input is exactly the selection', () => {
  it('contains selected message text and tool records; unselected messages are absent', () => {
    const detail = codexDetail(simpleRollout);
    const { prompt } = buildNotePrompt({ detail, selectedMessages: [detail.messages[1]!] });

    expect(prompt).toContain('reset the token cache');
    expect(prompt).toContain('{"cmd":"ls"}');
    expect(prompt).toContain('a b');
    expect(prompt).not.toContain('how to fix the login bug?'); // unselected message
    // raw JSONL records are evidence, not model input
    expect(prompt).not.toContain('"type":"response_item"');
  });

  it('a text-range message contributes ONLY the selected excerpt', () => {
    const detail = codexDetail(simpleRollout);
    const msgId = detail.messages[0]!.id; // 'how to fix the login bug?'
    const { prompt } = buildNotePrompt({
      detail,
      selectedMessages: [],
      textRanges: [{ messageId: msgId, start: 0, end: 3 }], // 'how'
    });

    expect(prompt).toContain('how');
    expect(prompt).not.toContain('fix the login bug'); // the unselected rest stays out
    expect(prompt).toContain('节选'); // explicitly marked as an excerpt
  });

  it('collects obtainable inline images as rig image blocks', () => {
    const rollout = [
      rec('session_meta', { session_id: 's', cwd: '/w' }),
      rec('response_item', {
        type: 'message', id: 'm1', role: 'user',
        internal_chat_message_metadata_passthrough: { content_item_kinds: ['user.text'] },
        content: [
          { type: 'input_text', text: 'screenshot' },
          { type: 'input_image', image_url: dataUrl([1, 2, 3]) },
        ],
      }),
    ].join('\n');
    const detail = codexDetail(rollout);
    const { images } = buildNotePrompt({ detail, selectedMessages: detail.messages });

    expect(images).toHaveLength(1);
    expect(images[0]!.mediaType).toBe('image/png');
    expect(images[0]!.data).toBe(btoa(String.fromCharCode(1, 2, 3)));
  });

  it('sibling-branch content is absent (pi forked fixture)', () => {
    const session = [
      JSON.stringify({ type: 'session', version: 3, id: 'h', timestamp: '2026-10-11T09:00:00.000Z', cwd: '/work/pi' }),
      JSON.stringify({ type: 'message', id: 'm1', parentId: 'h', timestamp: '2026-10-11T09:00:01.000Z', message: { role: 'user', content: [{ type: 'text', text: 'explain the parser' }] } }),
      JSON.stringify({ type: 'message', id: 'm3', parentId: 'm1', timestamp: '2026-10-11T09:00:03.000Z', message: { role: 'user', content: [{ type: 'text', text: 'wrong direction' }] } }),
      JSON.stringify({ type: 'message', id: 'c1', parentId: 'm1', timestamp: '2026-10-11T09:00:05.000Z', message: { role: 'user', content: [{ type: 'text', text: 'continue here' }] } }),
    ].join('\n');
    const alt = parsePiSession(session, 'm3'); // the displayed branch
    const piSummary: ExternalSessionSummary = { ...summary, source: 'pi', sessionId: 'p1', title: 'explain the parser' };
    const detail: ExternalSessionDetail = { summary: piSummary, messages: alt.messages, warnings: alt.warnings, branch: alt.branch };

    const { prompt } = buildNotePrompt({ detail, selectedMessages: alt.messages });
    expect(prompt).toContain('wrong direction');
    expect(prompt).not.toContain('continue here'); // sibling branch never joins
  });
});

describe('generateSessionNote — isolated request through the model bridge', () => {
  const input = (detail: ExternalSessionDetail): SaveCaptureInput => ({
    detail,
    selectedMessages: detail.messages,
  });

  it('calls runRigChat with historyMode none, the feature preamble and the selection prompt', async () => {
    const detail = codexDetail(simpleRollout);
    const note = await generateSessionNote(input(detail));

    expect(note).toContain('重置令牌缓存');
    expect(h.runRigChat).toHaveBeenCalledTimes(1);
    const p = h.runRigChat.mock.calls[0]![0] as RigChatParams;
    expect(p.historyMode).toBe('none'); // no prior request history, nothing persisted
    expect(p.preamble).toBe(NOTE_SYSTEM_PREAMBLE);
    expect(p.provider).toBe('anthropic');
    expect(p.model).toBe('claude-sonnet-4-6');
    expect(p.apiKey).toBe('key-1');
    expect(p.prompt).toContain('how to fix the login bug?');
    expect(p.prompt).not.toContain('"type":"response_item"');
    expect(p.images).toBeUndefined(); // no images in the selection
    // fresh isolated session per request — no reused chat session
    expect(p.sessionId).toMatch(/^session-note:/);
  });

  it('the model replying INSUFFICIENT_CONTEXT maps to the insufficient-context state', async () => {
    h.runRigChat.mockImplementationOnce(async (p: RigChatParams) => {
      p.onEvent({ type: 'text', content: INSUFFICIENT_CONTEXT_MARKER });
      p.onEvent({ type: 'done' });
    });
    await expect(generateSessionNote(input(codexDetail(simpleRollout))))
      .rejects.toBeInstanceOf(InsufficientContextError);
  });

  it('prose merely MENTIONING the marker mid-note is not a false positive', async () => {
    h.runRigChat.mockImplementationOnce(async (p: RigChatParams) => {
      p.onEvent({ type: 'text', content: '# 笔记\n\n如遇素材不足，模型会回复 INSUFFICIENT_CONTEXT 标记。\n\n正文继续。' });
      p.onEvent({ type: 'done' });
    });
    const note = await generateSessionNote(input(codexDetail(simpleRollout)));
    expect(note).toContain('正文继续'); // a real note, not the insufficient state
  });

  it('an explicit pair (the sessions flow choice) overrides the chat default', async () => {
    h.aiState.providerSettings = {
      anthropic: { apiKey: 'key-1', baseUrl: '' },
      openai: { apiKey: 'key-2', baseUrl: 'https://relay.example' },
    };
    const note = await generateSessionNote(input(codexDetail(simpleRollout)), {
      pair: { provider: 'openai', model: 'gpt-5.2' },
    });

    expect(note).toContain('重置令牌缓存');
    const p = h.runRigChat.mock.calls[0]![0] as RigChatParams;
    expect(p.provider).toBe('openai');
    expect(p.model).toBe('gpt-5.2');
    expect(p.apiKey).toBe('key-2');
  });

  it('pair: null keeps the app default (the chat pair) — clearing the selector is not an error', async () => {
    const note = await generateSessionNote(input(codexDetail(simpleRollout)), { pair: null });
    expect(note).toContain('重置令牌缓存');
    const p = h.runRigChat.mock.calls[0]![0] as RigChatParams;
    expect(p.provider).toBe('anthropic');
    expect(p.model).toBe('claude-sonnet-4-6');
  });

  it('a chosen pair that cannot resolve is an explicit no-model error, never a silent fallback to the chat pair', async () => {
    // The chat-default provider IS usable — it must not be used anyway.
    h.aiState.providerSettings = { anthropic: { apiKey: 'key-1', baseUrl: '' } };
    await expect(
      generateSessionNote(input(codexDetail(simpleRollout)), {
        pair: { provider: 'openai', model: 'gpt-5.2' }, // no openai slot configured
      }),
    ).rejects.toBeInstanceOf(NoModelConfiguredError);
    expect(h.runRigChat).not.toHaveBeenCalled();
  });

  it('no usable model configured → NoModelConfiguredError, no model call', async () => {
    h.aiState.providerSettings = {};
    await expect(generateSessionNote(input(codexDetail(simpleRollout))))
      .rejects.toBeInstanceOf(NoModelConfiguredError);
    expect(h.runRigChat).not.toHaveBeenCalled();
  });

  it('oversized selection → SelectionTooLargeError, nothing sent, never truncated', async () => {
    const detail = codexDetail([
      rec('session_meta', { session_id: 's', cwd: '/w' }),
      rec('response_item', {
        type: 'message', id: 'm1', role: 'user',
        internal_chat_message_metadata_passthrough: { content_item_kinds: ['user.text'] },
        content: [{ type: 'input_text', text: 'x'.repeat(NOTE_INPUT_CHAR_LIMIT + 1) }],
      }),
    ].join('\n'));
    await expect(generateSessionNote(input(detail))).rejects.toBeInstanceOf(SelectionTooLargeError);
    expect(h.runRigChat).not.toHaveBeenCalled();
  });

  it('selected images with an image-unsupported (or unknown) model → UnsupportedImageModelError, nothing sent', async () => {
    const rollout = [
      rec('session_meta', { session_id: 's', cwd: '/w' }),
      rec('response_item', {
        type: 'message', id: 'm1', role: 'user',
        internal_chat_message_metadata_passthrough: { content_item_kinds: ['user.text'] },
        content: [{ type: 'input_text', text: 'see' }, { type: 'input_image', image_url: dataUrl([9]) }],
      }),
    ].join('\n');
    const detail = codexDetail(rollout);

    // unknown model → capability not knowable → treated as unsupported
    await expect(generateSessionNote(input(detail))).rejects.toBeInstanceOf(UnsupportedImageModelError);
    expect(h.runRigChat).not.toHaveBeenCalled();

    // explicit text-only processing proceeds without the images
    const note = await generateSessionNote(input(detail), { includeImages: false });
    expect(note).toContain('重置令牌缓存');
    const p = h.runRigChat.mock.calls[0]![0] as RigChatParams;
    expect(p.images).toBeUndefined();
  });

  it('images are supplied only when the model is known to support vision', async () => {
    const rollout = [
      rec('session_meta', { session_id: 's', cwd: '/w' }),
      rec('response_item', {
        type: 'message', id: 'm1', role: 'user',
        internal_chat_message_metadata_passthrough: { content_item_kinds: ['user.text'] },
        content: [{ type: 'input_text', text: 'see' }, { type: 'input_image', image_url: dataUrl([9]) }],
      }),
    ].join('\n');
    h.catalogModel = visionModel;
    await generateSessionNote(input(codexDetail(rollout)));
    const p = h.runRigChat.mock.calls[0]![0] as RigChatParams;
    expect((p.images as RigChatImage[] | undefined)?.[0]?.mediaType).toBe('image/png');
  });

  it('cancellation → NoteGenerationCancelledError, no note produced', async () => {
    await expect(
      generateSessionNote(input(codexDetail(simpleRollout)), { cancelled: () => true }),
    ).rejects.toBeInstanceOf(NoteGenerationCancelledError);
    expect(h.runRigChat).not.toHaveBeenCalled();
  });

  it('a provider error surfaced mid-stream is an explicit failure (no empty note)', async () => {
    h.runRigChat.mockImplementationOnce(async (p: RigChatParams) => {
      p.onEvent({ type: 'error', content: 'rate limited' });
      p.onEvent({ type: 'done' });
    });
    await expect(generateSessionNote(input(codexDetail(simpleRollout))))
      .rejects.toThrow('rate limited');
  });

  it('runRigChat rejecting with a plain AppError object surfaces its detail, never "[object Object]"', async () => {
    // chat_stream returns Result<_, AppError>; the invoke rejection is the
    // serialized `{category, detail}` object, not an Error.
    h.runRigChat.mockImplementationOnce(async () => {
      throw { category: 'internal', detail: 'request failed after 3 retries' };
    });
    await expect(generateSessionNote(input(codexDetail(simpleRollout))))
      .rejects.toThrow('request failed after 3 retries');
    await generateSessionNote(input(codexDetail(simpleRollout))).catch((err: unknown) => {
      expect(String(err)).not.toContain('[object Object]');
    });
  });

  it('an empty response is a failure, not an empty note', async () => {
    h.runRigChat.mockImplementationOnce(async (p: RigChatParams) => {
      p.onEvent({ type: 'done' });
    });
    await expect(generateSessionNote(input(codexDetail(simpleRollout))))
      .rejects.toThrow('empty response');
  });
});
