import { describe, expect, it } from 'vitest';
import { mergeTimelineSessions, formatSessionDuration, eventChips } from './TimelineList';
import type { ActivityEventRow } from '@/services/activity/api';
import type { DisplayIndexEntry } from '@/services/activity/registry';

const MIN = 60_000;
const ev = (id: string, type: string, t: number): ActivityEventRow => ({
  id,
  type,
  source: 's',
  occurredAt: t,
});

/** Display index in which `window_activity` and `heartbeat` declare session folding. */
const FOLDING: Record<string, DisplayIndexEntry> = {
  window_activity: { type: 'window_activity', collectorId: 'ext.window', session: { label: 'Window activity' } },
  heartbeat: { type: 'heartbeat', collectorId: 'ext.beat', session: { label: 'Heartbeat' } },
  commit: { type: 'commit', collectorId: 'ext.git' },
};

describe('mergeTimelineSessions', () => {
  it('merges consecutive runs of a session type (gap ≤ 5min), interrupts split, lone stays event', () => {
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
    const items = mergeTimelineSessions(events, FOLDING);
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
    const items = mergeTimelineSessions(events, FOLDING);
    expect(items).toHaveLength(1);
    expect(items[0].kind).toBe('session');
  });

  it('a type folds only when its display entry declares a session', () => {
    const events = [ev('b', 'window_activity', MIN), ev('a', 'window_activity', 0)];
    expect(mergeTimelineSessions(events, {}).map((i) => i.kind)).toEqual(['event', 'event']);
    expect(
      mergeTimelineSessions(events, { window_activity: { type: 'window_activity', collectorId: 'x' } }).map((i) => i.kind),
    ).toEqual(['event', 'event']);
  });

  it('two session types never share a run', () => {
    const events = [
      ev('h2', 'heartbeat', 3 * MIN),
      ev('h1', 'heartbeat', 2 * MIN),
      ev('w2', 'window_activity', MIN),
      ev('w1', 'window_activity', 0),
    ];
    const items = mergeTimelineSessions(events, FOLDING);
    expect(items.map((i) => (i.kind === 'session' ? i.events.map((e) => e.id) : i.kind))).toEqual([
      ['h2', 'h1'],
      ['w2', 'w1'],
    ]);
  });

  it('no session-type events → unchanged pass-through', () => {
    const events = [ev('a', 'commit', 2 * MIN), ev('b', 'task', MIN)];
    const items = mergeTimelineSessions(events, FOLDING);
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

describe('eventChips', () => {
  const BADGE = { label: 'G', color: '#EA4335' };

  it('resolves declared chip keys from the payload (strings only), with the monogram the payload carries', () => {
    const decl = [{ key: 'mailbox', badge: 'mailboxBadge' }, { key: 'repo' }];
    expect(eventChips({ mailbox: 'a@gmail.com', mailboxBadge: BADGE, repo: 'folyn' }, decl)).toEqual([
      { key: 'mailbox', text: 'a@gmail.com', badge: BADGE },
      { key: 'repo', text: 'folyn' },
    ]);
  });

  it('draws no monogram when the payload has none or a malformed one', () => {
    const decl = [{ key: 'mailbox', badge: 'mailboxBadge' }];
    const plain = [{ key: 'mailbox', text: 'a@gmail.com' }];
    expect(eventChips({ mailbox: 'a@gmail.com' }, decl)).toEqual(plain);
    for (const bad of [
      'G',
      { label: 'G' },
      { label: '', color: '#EA4335' },
      { label: 'TOOLONG', color: '#EA4335' },
      { label: 'G', color: 'red' },
      { label: 'G', color: 'url(https://evil.example/x)' },
      { label: 'G', color: '#EA4335;position:fixed' },
    ]) {
      expect(eventChips({ mailbox: 'a@gmail.com', mailboxBadge: bad }, decl)).toEqual(plain);
    }
  });

  it('drops missing / non-string / empty values, and undeclared → []', () => {
    const decl = [{ key: 'mailbox', badge: 'mailboxBadge' }, { key: 'n' }];
    expect(eventChips({ mailbox: 42, n: '  ' }, decl)).toEqual([]);
    expect(eventChips({ mailbox: 'a@x.com' }, undefined)).toEqual([]);
    expect(eventChips({}, [])).toEqual([]);
  });
});
