/**
 * Event AI summaries (design §7.1 detail panel, §6 getEventSummary): lazy
 * one-shot generation via the host's rig chat (runRigChat), result cached back
 * into `activity_events.ai_summary` so the second expand reads the row. Runs
 * only when the「允许 AI 读取活动数据生成摘要」switch is on — the UI gates
 * the block entirely when it's off.
 *
 * Uses `historyMode: 'none'` (no persisted chat turn). Pair resolution:
 * summaryPair (报告设置 view) ?? global chat pair ?? first enabled pair —
 * same semantics as design §7.5's "modelOverride undefined = follow global
 * chat config".
 */

import type { ActivityEventRow } from './api';
import { setActivityEventSummary } from './api';

/** Build the prompt from the event's title/summary/payload. Pure. */
export function buildEventSummaryPrompt(event: ActivityEventRow): string {
  const parts = [
    `Type: ${event.type}`,
    event.title ? `Title: ${event.title}` : null,
    event.summary ? `Summary: ${event.summary}` : null,
    `Payload: ${JSON.stringify(event.payload ?? {})}`,
  ].filter((p): p is string => p != null);
  return [
    'Summarize this activity event in 1-2 sentences. Reply in the language of the event content. No preamble.',
    ...parts,
  ].join('\n');
}

/**
 * Generate + cache the summary. Returns the summary text; throws on failure
 * (no AI pair configured, provider error, or empty response) — callers catch
 * and surface the message. A cache-write failure still returns the text (the
 * summary is displayed this session).
 */
export async function generateEventSummary(
  vaultRoot: string,
  event: ActivityEventRow,
): Promise<string> {
  const { useAiConfigStore, resolvePairConfig, firstEnabledPair } = await import(
    '@/store/aiConfigStore'
  );
  const state = useAiConfigStore.getState();
  const chatPair = state.chatProvider && state.chatModel
    ? { provider: state.chatProvider, model: state.chatModel }
    : null;
  const { useActivityCollectorStore } = await import('@/store/activityCollectorStore');
  const summaryPair = useActivityCollectorStore.getState().summaryPair ?? null;
  const pair = summaryPair ?? chatPair ?? firstEnabledPair(state);
  const cfg = resolvePairConfig(pair, state);
  if (!cfg) throw new Error('AI pair not configured');

  const { runRigChat } = await import('@/services/rigChat');
  let text = '';
  let errorText = '';
  try {
    await runRigChat({
      sessionId: `activity-summary:${event.id}`,
      prompt: buildEventSummaryPrompt(event),
      provider: cfg.provider,
      model: cfg.model,
      apiKey: cfg.apiKey,
      ...(cfg.baseUrl ? { baseUrl: cfg.baseUrl } : {}),
      ...(cfg.thinkingBudget != null ? { thinkingBudget: cfg.thinkingBudget } : {}),
      adapterFamily: cfg.adapterFamily,
      historyMode: 'none',
      preamble: 'You summarize activity events concisely. No preamble, no markdown headings.',
      onEvent: (ev) => {
        if (ev.type === 'text' && ev.content) text += ev.content;
        // runRigChat forwards provider errors as error chunks without
        // rejecting the promise — capture them or the failure is silent.
        if (ev.type === 'error') errorText = (errorText ? errorText + '; ' : '') + (ev.content ?? 'chat error');
      },
    });
  } catch (err) {
    console.warn('[activity] event summary generation failed:', err);
    throw err;
  }
  const summary = text.trim();
  if (!summary) throw new Error(errorText || 'empty response');
  try {
    await setActivityEventSummary(vaultRoot, event.id, summary);
  } catch (err) {
    // Cache-write failure still returns the text — it's displayed this session.
    console.warn('[activity] event summary cache write failed:', err);
  }
  return summary;
}
