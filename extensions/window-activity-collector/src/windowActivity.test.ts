/**
 * collect() tests: ctx.frontWindow stubbed with fixed samples — no OS access,
 * same contract shape as the host's runtime injection.
 */
import { describe, it, expect, vi } from 'vitest';
import type { CollectorContext } from 'folyn-extension-sdk';
import { collectWindowActivity } from './windowActivity';

function makeCtx(
  frontWindow: CollectorContext['frontWindow'],
  cursor: string | null = null,
): CollectorContext {
  return { cursor, config: {}, frontWindow };
}

describe('collectWindowActivity', () => {
  it('first run emits one event and sets the cursor to the sample', async () => {
    const fw = vi.fn(async () => ({ app: 'Folyn', title: 'report.md' }));
    const { events, nextCursor } = await collectWindowActivity(makeCtx(fw));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      id: expect.stringMatching(/^window:\d+$/),
      type: 'window_activity',
      title: 'Folyn · report.md',
      summary: '正在使用 Folyn',
      actor: { type: 'person', identityKey: 'self', displayName: '我' },
      entities: [
        { type: 'application', identityKey: 'Folyn', displayName: 'Folyn', relation: 'window' },
      ],
      payload: { app: 'Folyn', title: 'report.md' },
    });
    expect(events[0]!.occurredAt).toBeGreaterThan(0);
    expect(nextCursor).toBe('Folyn|report.md');
  });

  it('unchanged sample emits nothing (cursor untouched)', async () => {
    const fw = vi.fn(async () => ({ app: 'Folyn', title: 'report.md' }));
    const out = await collectWindowActivity(makeCtx(fw, 'Folyn|report.md'));
    expect(out).toEqual({ events: [], nextCursor: 'Folyn|report.md' });
  });

  it('changed sample emits one event, cursor advances', async () => {
    const fw = vi.fn(async () => ({ app: 'Safari', title: null }));
    const { events, nextCursor } = await collectWindowActivity(makeCtx(fw, 'Folyn|report.md'));
    expect(events).toHaveLength(1);
    // No title → app only, and the cursor key uses the empty title slot.
    expect(events[0]!.title).toBe('Safari');
    expect(events[0]!.payload).toMatchObject({ app: 'Safari', title: null });
    expect(nextCursor).toBe('Safari|');
  });

  it('null sample (unavailable platform/permission) emits nothing, cursor kept', async () => {
    const fw = vi.fn(async () => null);
    const out = await collectWindowActivity(makeCtx(fw, 'Folyn|report.md'));
    expect(out).toEqual({ events: [], nextCursor: 'Folyn|report.md' });
  });

  it('absent ctx.frontWindow is tolerated (embedded host)', async () => {
    const out = await collectWindowActivity({ cursor: null, config: {} });
    expect(out).toEqual({ events: [], nextCursor: '' });
  });
});
