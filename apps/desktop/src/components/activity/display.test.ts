import { describe, expect, it } from 'vitest';
import {
  effectivePinned,
  formatDetailValue,
  groupNeighborsByType,
  isExternalUrl,
  metricCardsFromRows,
  paletteOf,
  togglePinOverride,
} from './display';
import type { ActivityMetricRow } from '@/services/activity/api';

describe('metric cards + pin overrides', () => {
  const rows: ActivityMetricRow[] = [
    { type: 'commit', count: 10, totalMinutes: null },
    { type: 'meeting', count: 2, totalMinutes: 120 },
    { type: 'expense_approval', count: 3, totalMinutes: null },
  ];
  const displayByType: Record<string, any> = {
    expense_approval: {
      type: 'expense_approval',
      metric: { id: 'expense_count', label: '报销审批', aggregate: 'count' },
    },
  };
  const label = (id: string) => `L:${id}`;

  it('maps rows to cards: builtin pinned, custom collapsed, meeting minutes split out', () => {
    const cards = metricCardsFromRows(rows, displayByType, label, label);
    const byId = Object.fromEntries(cards.map((c) => [c.id, c]));
    expect(byId['commit_count']).toMatchObject({ value: 10, defaultPinned: true });
    expect(byId['meeting_count']).toMatchObject({ value: 2, defaultPinned: true });
    expect(byId['meeting_minutes']).toMatchObject({ value: 120, defaultPinned: true });
    expect(byId['expense_count']).toMatchObject({ value: 3, defaultPinned: false, label: '报销审批' });
  });

  it('pin overrides flip state and drop no-op entries', () => {
    const builtin = { id: 'commit_count', label: 'x', value: 1, defaultPinned: true };
    const custom = { id: 'expense_count', label: 'x', value: 1, defaultPinned: false };
    expect(effectivePinned(builtin, {})).toBe(true);
    expect(effectivePinned(custom, {})).toBe(false);
    const afterUnpin = togglePinOverride(builtin, {});
    expect(effectivePinned(builtin, afterUnpin)).toBe(false);
    const afterRepin = togglePinOverride(builtin, afterUnpin);
    expect(effectivePinned(builtin, afterRepin)).toBe(true);
    // Same value as the default → the override is removed, not stored false.
    expect(afterRepin['commit_count']).toBeUndefined();
    const afterPin = togglePinOverride(custom, {});
    expect(effectivePinned(custom, afterPin)).toBe(true);
    expect(afterPin['expense_count']).toBe(true);
  });
});

describe('detail formatters', () => {
  it('formats builtin field types without crashing on junk', () => {
    expect(formatDetailValue(12.5, 'currency')).toBe('¥12.5');
    expect(formatDetailValue('ok', 'text')).toBe('ok');
    expect(formatDetailValue(['a', 'b'], 'list')).toBe('a · b');
    expect(formatDetailValue(null, 'text')).toBe('');
    expect(formatDetailValue(undefined, 'number')).toBe('');
    expect(formatDetailValue('junk', 'currency')).toBe('junk');
    // Malformed payloads (third-party collector data) must not render as
    // anything dangerous or crash the fallback flat-list.
    expect(formatDetailValue({ a: 1 }, 'text')).toBe('{"a":1}');
    expect(formatDetailValue({ nested: { deep: [1, 2] } }, 'text')).toBe('{"nested":{"deep":[1,2]}}');
    expect(formatDetailValue(42n, 'text')).toBe('42');
  });

  it('only http(s) urls count as external (javascript: scheme rejected)', () => {
    expect(isExternalUrl('https://example.com/x')).toBe(true);
    expect(isExternalUrl('http://example.com')).toBe(true);
    expect(isExternalUrl('javascript:alert(1)')).toBe(false);
    expect(isExternalUrl('JaVaScRiPt:alert(1)')).toBe(false);
    expect(isExternalUrl('file:///etc/passwd')).toBe(false);
    expect(isExternalUrl('www.baidu.com')).toBe(false);
    expect(isExternalUrl('')).toBe(false);
    expect(isExternalUrl(null)).toBe(false);
    expect(isExternalUrl(undefined)).toBe(false);
  });
});

describe('entity graph grouping + layout', () => {
  const neighbors = [
    { id: 'm1', type: 'meeting' },
    { id: 'm2', type: 'meeting' },
    { id: 'p1', type: 'person' },
    { id: 'x1', type: 'weird_type' },
  ];

  it('groups same-type neighbors; singletons stay single', () => {
    const groups = groupNeighborsByType(neighbors, (n) => n.type);
    const byType = Object.fromEntries(groups.map((g) => [g.entityType, g.items.length]));
    expect(byType).toEqual({ meeting: 2, person: 1, weird_type: 1 });
  });

  it('paletteOf falls back to gray for unknown keys', () => {
    expect(paletteOf('teal')).toBe('teal');
    expect(paletteOf('#ff0000')).toBe('gray');
    expect(paletteOf(undefined)).toBe('gray');
  });
});
