import { describe, expect, it } from 'vitest';
import { mergeTimelineSessions, formatSessionDuration, providerBadge, eventChips } from './TimelineList';
import type { ActivityEventRow } from '@/services/activity/api';

const MIN = 60_000;
const ev = (id: string, type: string, t: number): ActivityEventRow => ({
  id,
  type,
  source: 's',
  occurredAt: t,
});

describe('mergeTimelineSessions', () => {
  it('merges consecutive window_activity runs (gap ≤ 5min), interrupts split, lone stays event', () => {
    // reverse-chronological, like the API returns
    const events = [
      ev('commit2', 'commit', 20 * MIN),
      ev('w6', 'window_activity', 18 * MIN),
      ev('w5', 'window_activity', 15 * MIN),
      ev('commit1', 'commit', 14 * MIN),
      ev('w4', 'window_activity', 11 * MIN), // gap to w3 is 6min → own run of 1
      ev('w3', 'window_activity', 5 * MIN),
      ev('w2', 'window_activity', 1 * MIN),
      ev('w1', 'window_activity', 0),
    ];
    const items = mergeTimelineSessions(events);
    expect(items.map((i) => i.kind)).toEqual([
      'event',
      'session',
      'event',
      'event',
      'session',
    ]);
    const [first, second] = items.filter((i) => i.kind === 'session');
    if (first.kind !== 'session' || second.kind !== 'session') throw new Error('unreachable');
    // Newest-first inside each session; run flushed before the interrupt.
    expect(first.events.map((e) => e.id)).toEqual(['w6', 'w5']);
    expect(first.newest.id).toBe('w6');
    expect(first.oldest.id).toBe('w5');
    expect(second.events.map((e) => e.id)).toEqual(['w3', 'w2', 'w1']);
  });

  it('gap of exactly 5min merges (threshold is inclusive)', () => {
    const events = [ev('b', 'window_activity', 5 * MIN), ev('a', 'window_activity', 0)];
    const items = mergeTimelineSessions(events);
    expect(items).toHaveLength(1);
    expect(items[0].kind).toBe('session');
  });

  it('no window events → unchanged pass-through', () => {
    const events = [ev('a', 'commit', 2 * MIN), ev('b', 'task', MIN)];
    const items = mergeTimelineSessions(events);
    expect(items).toEqual([
      { kind: 'event', event: events[0] },
      { kind: 'event', event: events[1] },
    ]);
  });
});

describe('formatSessionDuration', () => {
  it('splits hours and minutes', () => {
    const s = formatSessionDuration(135 * MIN, 'en');
    expect(s).toContain('2');
    expect(s).toContain('15');
  });
  it('clamps sub-minute durations to 1 minute (session counts the last sample)', () => {
    const s = formatSessionDuration(0, 'en');
    expect(s).toContain('1');
  });
});

describe('providerBadge', () => {
  it('maps known domains (case-insensitive) and falls back to neutral', () => {
    expect(providerBadge('a@gmail.com')).toEqual({ label: 'G', color: '#EA4335' });
    expect(providerBadge('a@QQ.COM')).toEqual({ label: 'QQ', color: '#12B7F5' });
    expect(providerBadge('15289842383@163.com')).toEqual({ label: '163', color: '#3399EA' });
    expect(providerBadge('a@unknown.tld')).toEqual({ label: '@', color: '#8B93A1' });
    expect(providerBadge('no-at-sign')).toEqual({ label: '@', color: '#8B93A1' });
  });
});

describe('eventChips', () => {
  it('resolves declared chip keys from the payload (strings only)', () => {
    const decl = [{ key: 'mailbox', badge: 'provider' as const }, { key: 'repo' }];
    expect(eventChips({ mailbox: 'a@gmail.com', repo: 'folyn' }, decl)).toEqual([
      { key: 'mailbox', text: 'a@gmail.com', badge: 'provider' },
      { key: 'repo', text: 'folyn' },
    ]);
  });

  it('drops missing / non-string / empty values, and undeclared → []', () => {
    const decl = [{ key: 'mailbox', badge: 'provider' as const }, { key: 'n' }];
    expect(eventChips({ mailbox: 42, n: '  ' }, decl)).toEqual([]);
    expect(eventChips({ mailbox: 'a@x.com' }, undefined)).toEqual([]);
    expect(eventChips({}, [])).toEqual([]);
  });
});
