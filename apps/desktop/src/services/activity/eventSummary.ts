/**
 * Event AI summaries (design §7.1 detail panel, §6 getEventSummary): lazy
 * one-shot generation via the host's rig chat (runRigChat), result cached back
 * into `activity_events.ai_summary` so the second expand reads the row. Runs
 * only when the「允许 AI 读取活动数据生成摘要」switch is on — the UI gates
 * the block entirely when it's off.
 *
 * Uses `historyMode: 'none'` (no persisted chat turn) and the extension pair
 * falling back to the first enabled pair — same resolution strategy as
 * extension-host's aiCapability.
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
 * Generate + cache the summary. Returns the text, or null when no AI pair is
 * configured (or the chat errors — caller treats null as "unavailable" and
 * does not retry this session).
 */
export async function generateEventSummary(
  vaultRoot: string,
  event: ActivityEventRow,
): Promise<string | null> {
  const { useAiConfigStore, resolvePairConfig, firstEnabledPair } = await import(
    '@/store/aiConfigStore'
  );
  const state = useAiConfigStore.getState();
  const pair = state.extensionPair ?? firstEnabledPair(state);
  const cfg = resolvePairConfig(pair, state);
  if (!cfg) return null;

  const { runRigChat } = await import('@/services/rigChat');
  let text = '';
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
      },
    });
  } catch (err) {
    console.warn('[activity] event summary generation failed:', err);
    return null;
  }
  const summary = text.trim();
  if (!summary) return null;
  await setActivityEventSummary(vaultRoot, event.id, summary);
  return summary;
}
