import { describe, expect, it } from 'vitest';
import type { CollectorBundle } from './registry';
import { buildActivityRegistry, useCollectorRegistryStore } from './registry';
import { applyPrivacy, effectiveIntervalMs, MIN_POLL_INTERVAL_MS } from './runtime';

function bundle(extensionId: string, overrides: Partial<CollectorBundle> = {}): CollectorBundle {
  return {
    extensionId,
    collectors: [],
    activityDisplay: [],
    entityTypes: [],
    ...overrides,
  };
}

describe('buildActivityRegistry', () => {
  it('always includes the builtin five entity types', () => {
    const { entityTypes } = buildActivityRegistry([]);
    expect(entityTypes.map((t) => t.id)).toEqual([
      'person', 'meeting', 'repository', 'document', 'task',
    ]);
  });

  it('merges collectors, display entries, and custom entity types', () => {
    const { collectors, displayByType, entityTypes } = buildActivityRegistry([
      bundle('org.example.git', {
        collectors: [{
          id: 'git-commit',
          activityTypes: ['commit'],
          mode: 'poll',
          pollIntervalMs: 300000,
          hostAllowlist: [],
        }],
        activityDisplay: [{
          type: 'commit',
          icon: 'git-commit',
          color: 'teal',
          detailFields: [{ key: 'sha', label: 'SHA', format: 'text' }],
          metric: { id: 'commit_count', label: '提交', aggregate: 'count' },
          entity: { role: 'repository', relationLabel: '提交' },
        }],
        entityTypes: [{ id: 'customer', label: '客户', color: 'blue', icon: 'building' }],
      }),
    ]);
    expect(collectors).toHaveLength(1);
    expect(collectors[0]).toMatchObject({ collectorId: 'git-commit', extensionId: 'org.example.git', mode: 'poll' });
    expect(displayByType['commit']).toMatchObject({ collectorId: 'org.example.git', metric: { aggregate: 'count' } });
    expect(entityTypes.find((t) => t.id === 'customer')?.owner).toBe('org.example.git');
  });

  it('skips a later entityTypes registration on conflict and records the winner', () => {
    const { entityTypes, conflicts } = buildActivityRegistry([
      bundle('ext.a', { entityTypes: [{ id: 'customer', label: '客户A' }] }),
      bundle('ext.b', { entityTypes: [{ id: 'customer', label: '客户B' }] }),
    ]);
    expect(entityTypes.find((t) => t.id === 'customer')?.label).toBe('客户A');
    expect(conflicts).toEqual([{ typeId: 'customer', extensionId: 'ext.b', winner: 'ext.a' }]);
  });

  it('records builtin as the winner when a collector collides with a builtin type', () => {
    const { conflicts } = buildActivityRegistry([
      bundle('ext.a', { entityTypes: [{ id: 'person', label: '冒名人物' }] }),
    ]);
    expect(conflicts).toEqual([{ typeId: 'person', extensionId: 'ext.a', winner: 'builtin' }]);
  });

  it('skips duplicate collector ids and duplicate display types (first wins)', () => {
    const { collectors, displayByType } = buildActivityRegistry([
      bundle('ext.a', {
        collectors: [{ id: 'git-commit', activityTypes: ['commit'], mode: 'poll', hostAllowlist: [] }],
        activityDisplay: [{ type: 'commit', icon: 'a' }],
      }),
      bundle('ext.b', {
        collectors: [{ id: 'git-commit', activityTypes: ['commit'], mode: 'poll', hostAllowlist: [] }],
        activityDisplay: [{ type: 'commit', icon: 'b' }],
      }),
    ]);
    expect(collectors).toHaveLength(1);
    expect(collectors[0]?.extensionId).toBe('ext.a');
    expect(displayByType['commit']?.icon).toBe('a');
  });
});

describe('collector registry store', () => {
  it('register/unregister are idempotent per extension and rebuild the tables', () => {
    const store = useCollectorRegistryStore.getState();
    store.register(bundle('ext.a', { entityTypes: [{ id: 'customer', label: '客户' }] }));
    // Re-register replaces (no duplicate bundle).
    store.register(bundle('ext.a', { entityTypes: [{ id: 'customer', label: '客户' }] }));
    expect(useCollectorRegistryStore.getState().bundles).toHaveLength(1);

    store.register(bundle('ext.b', { entityTypes: [{ id: 'customer', label: '客户B' }] }));
    expect(useCollectorRegistryStore.getState().conflicts).toHaveLength(1);

    useCollectorRegistryStore.getState().unregister('ext.a');
    const after = useCollectorRegistryStore.getState();
    expect(after.bundles.map((b) => b.extensionId)).toEqual(['ext.b']);
    expect(after.conflicts).toEqual([]);
    expect(after.entityTypes.find((t) => t.id === 'customer')?.owner).toBe('ext.b');
    // Cleanup for other tests in this file.
    useCollectorRegistryStore.getState().unregister('ext.b');
  });
});

describe('effectiveIntervalMs', () => {
  it('floors everything at 60s', () => {
    expect(effectiveIntervalMs(1000, undefined)).toBe(MIN_POLL_INTERVAL_MS);
    expect(effectiveIntervalMs(undefined, 5000)).toBe(MIN_POLL_INTERVAL_MS);
    expect(effectiveIntervalMs(undefined, undefined)).toBe(MIN_POLL_INTERVAL_MS);
  });

  it('user override wins over the declared default; both respect the floor', () => {
    expect(effectiveIntervalMs(300000, 120000)).toBe(120000);
    expect(effectiveIntervalMs(300000, undefined)).toBe(300000);
    expect(effectiveIntervalMs(60000, 3_600_000)).toBe(3_600_000);
  });
});

describe('applyPrivacy', () => {
  const events = [
    { id: 'a', title: 'fix token abc123', summary: 'leaks sk-9999', raw: { secret: 'x' } },
    { id: 'b', title: 'plain', raw: undefined },
  ];

  it('strips raw unless keepRaw, and redacts title/summary with user regexes', () => {
    const out = applyPrivacy(events, { keepRaw: false, redactPatterns: ['abc\\d+', 'sk-\\d+'] });
    expect(out[0]?.title).toBe('fix token ***');
    expect(out[0]?.summary).toBe('leaks ***');
    expect(out[0]?.raw).toBeUndefined();
    expect(out[1]?.raw).toBeUndefined();
  });

  it('keeps raw when keepRaw is on and skips invalid regexes', () => {
    const out = applyPrivacy(events, { keepRaw: true, redactPatterns: ['([unclosed'] });
    expect(out[0]?.raw).toEqual({ secret: 'x' });
    expect(out[0]?.title).toBe('fix token abc123');
  });

  it('is pure — does not mutate the input events', () => {
    applyPrivacy(events, { keepRaw: false, redactPatterns: ['abc\\d+'] });
    expect(events[0]?.title).toBe('fix token abc123');
    expect(events[0]?.raw).toEqual({ secret: 'x' });
  });
});
