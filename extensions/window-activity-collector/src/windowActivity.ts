/**
 * Window activity collection (frontmost app + window title sampler).
 *
 * Each poll samples the frontmost window via the host-provided
 * `ctx.frontWindow` (Rust `activity_front_window` — fixed scripts, so this
 * collector never gains arbitrary osascript/powershell). An event is emitted
 * only when the sample CHANGED since the last one.
 *
 * ponytail: the cursor here is a repurposed opaque string — the last sample
 * as `app|title` — not a timestamp. Sampling granularity is the host's 60s
 * poll floor; per-second sampling would need a dedicated push channel later.
 */
import type { CollectorContext, CollectorEvent } from 'folyn-extension-sdk';

export async function collectWindowActivity(
  ctx: CollectorContext,
): Promise<{ events: CollectorEvent[]; nextCursor: string }> {
  const cursor = ctx.cursor ?? '';
  const sample = ctx.frontWindow ? await ctx.frontWindow() : null;
  if (!sample || !sample.app) {
    // Unavailable (unsupported platform / permission denied): no events,
    // cursor untouched — the next poll retries.
    return { events: [], nextCursor: cursor };
  }
  const key = `${sample.app}|${sample.title ?? ''}`;
  if (key === cursor) {
    return { events: [], nextCursor: cursor };
  }
  const occurredAt = Date.now();
  return {
    events: [
      {
        id: `window:${occurredAt}`,
        type: 'window_activity',
        occurredAt,
        title: sample.title ? `${sample.app} · ${sample.title}` : sample.app,
        summary: `正在使用 ${sample.app}`,
        actor: { type: 'person', identityKey: 'self', displayName: '我' },
        entities: [
          {
            type: 'application',
            identityKey: sample.app,
            displayName: sample.app,
            relation: 'window',
          },
        ],
        payload: { app: sample.app, title: sample.title },
      },
    ],
    nextCursor: key,
  };
}
