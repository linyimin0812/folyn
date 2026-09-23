import { describe, it, expect } from 'vitest';
import { mapWebhookPayload, stableHash, toEpochMs, DEFAULT_EVENT_TYPE } from './webhookMap';

describe('mapWebhookPayload', () => {
  it('maps default field names and uses the payload id when present', () => {
    const [e] = mapWebhookPayload(
      { id: 'abc-1', title: '部署完成', timestamp: 1760000000, url: 'https://ci.example.com/1' },
      {},
    );
    expect(e).toMatchObject({
      id: 'webhook:abc-1',
      type: DEFAULT_EVENT_TYPE,
      occurredAt: 1760000000 * 1000, // epoch seconds → ms
      title: '部署完成',
      url: 'https://ci.example.com/1',
    });
  });

  it('honors custom field names from the config', () => {
    const [e] = mapWebhookPayload(
      { key: 'jira-42', subject: '修复登录', when: '2026-09-23T10:00:00Z', kind: 'task', link: 'https://jira/42' },
      { idField: 'key', titleField: 'subject', timestampField: 'when', typeField: 'kind', urlField: 'link' },
    );
    expect(e).toMatchObject({
      id: 'webhook:jira-42',
      type: 'task',
      occurredAt: Date.parse('2026-09-23T10:00:00Z'),
      title: '修复登录',
      url: 'https://jira/42',
    });
  });

  it('falls back to a stable payload hash when no id field maps', () => {
    const payload = { title: 'no id here', n: 7 };
    const [a] = mapWebhookPayload(payload, {});
    const [b] = mapWebhookPayload({ ...payload }, {});
    expect(a!.id).toBe(`webhook:${stableHash(JSON.stringify(payload))}`);
    expect(a!.id).toBe(b!.id);
  });

  it('drops unmappable payloads (no title) and non-objects', () => {
    expect(mapWebhookPayload({ id: 'x' }, {})).toEqual([]);
    expect(mapWebhookPayload('plain string', {})).toEqual([]);
    expect(mapWebhookPayload([1, 2], {})).toEqual([]);
    expect(mapWebhookPayload(null, {})).toEqual([]);
  });

  it('defaults occurredAt to now and type to external when absent', () => {
    const before = Date.now();
    const [e] = mapWebhookPayload({ title: 'bare' }, {});
    expect(e!.type).toBe(DEFAULT_EVENT_TYPE);
    expect(e!.occurredAt).toBeGreaterThanOrEqual(before);
    expect(e!.url).toBeUndefined();
  });
});

describe('toEpochMs', () => {
  it('accepts ms numbers, s numbers, numeric strings, and ISO strings', () => {
    expect(toEpochMs(1760000000000)).toBe(1760000000000);
    expect(toEpochMs(1760000000)).toBe(1760000000000);
    expect(toEpochMs('1760000000')).toBe(1760000000000);
    expect(toEpochMs('2026-09-23T10:00:00Z')).toBe(Date.parse('2026-09-23T10:00:00Z'));
  });

  it('returns null for unmappable values', () => {
    expect(toEpochMs('not a date')).toBeNull();
    expect(toEpochMs(undefined)).toBeNull();
    expect(toEpochMs({})).toBeNull();
  });
});
