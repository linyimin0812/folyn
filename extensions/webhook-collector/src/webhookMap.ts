/**
 * Webhook payload → CollectorEvent mapping (design §2.3 official webhook-mode
 * reference). Pure: no I/O, no host APIs — the mapping is driven entirely by
 * the config's field names, so the same code is trivially unit-testable.
 *
 * Contract: exactly one event per payload (or none, when the required title
 * can't be mapped). The id must be stable across re-deliveries — the mapped
 * id field, else a payload hash — so the host's insert-ignore dedup absorbs
 * duplicate pushes.
 */
import type { CollectorEvent } from 'folyn-extension-sdk';

/** Default event type when the type field is absent / not a string. */
export const DEFAULT_EVENT_TYPE = 'external';

/** FNV-1a 32-bit hash — stable for a given payload string, id fallback only.
 *  ponytail: 32 bits is plenty for a dedup id fallback on one machine. */
export function stableHash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h * 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/** Coerce a mapped timestamp value to epoch ms; `null` when unmappable.
 *  Accepts epoch ms, epoch s (< 1e12, design §4.1 uses ms), or ISO strings. */
export function toEpochMs(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value < 1e12 ? value * 1000 : value;
  }
  if (typeof value === 'string') {
    const n = Number(value);
    if (Number.isFinite(n) && value.trim() !== '') {
      return n < 1e12 ? n * 1000 : n;
    }
    const t = Date.parse(value);
    if (Number.isFinite(t)) return t;
  }
  return null;
}

function field(obj: Record<string, unknown>, name: unknown): unknown {
  if (typeof name !== 'string' || name === '') return undefined;
  return obj[name];
}

export function mapWebhookPayload(
  payload: unknown,
  config: Record<string, unknown>,
): CollectorEvent[] {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) return [];
  const obj = payload as Record<string, unknown>;

  const title = field(obj, config.titleField ?? 'title');
  if (typeof title !== 'string' || title.trim() === '') return []; // unmappable

  const typeRaw = field(obj, config.typeField ?? 'type');
  const type =
    typeof typeRaw === 'string' && typeRaw.trim() !== '' ? typeRaw : DEFAULT_EVENT_TYPE;

  const urlRaw = field(obj, config.urlField ?? 'url');
  const url = typeof urlRaw === 'string' && urlRaw !== '' ? urlRaw : undefined;

  const tsRaw = field(obj, config.timestampField ?? 'timestamp');
  const occurredAt = toEpochMs(tsRaw) ?? Date.now();

  const idRaw = field(obj, config.idField ?? 'id');
  const id =
    typeof idRaw === 'string' || typeof idRaw === 'number'
      ? String(idRaw)
      : stableHash(JSON.stringify(obj));

  return [
    {
      id: `webhook:${id}`,
      type,
      occurredAt,
      title,
      url,
      payload: obj,
    },
  ];
}
