/**
 * Activity query API (design §6) — thin typed wrappers over the Rust
 * `activity_*` read commands. All functions take the resolved vault root;
 * `resolveVaultRoot` reuses the runtime's resolver (empty string when no
 * vault is open — callers render the no-vault empty state instead).
 *
 * Row shapes mirror the serde camelCase output of `activity/query.rs`.
 */

import { invoke } from '@/services/tauriInvoke';
import { currentVaultRoot } from './runtime';

export { currentVaultRoot as resolveVaultRoot };

export interface ActivityEventRow {
  id: string;
  type: string;
  source: string;
  actorEntityId?: string | null;
  occurredAt: number;
  title?: string | null;
  summary?: string | null;
  url?: string | null;
  payload?: Record<string, unknown> | null;
  aiSummary?: string | null;
}

export interface ActivityMetricRow {
  type: string;
  count: number;
  totalMinutes?: number | null;
}

export interface ActivityEntityRow {
  id: string;
  type: string;
  identityKey: string;
  displayName?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface ActivityNeighborRow {
  neighborId: string;
  relation: string;
  eventCount: number;
  lastAt: number;
  score: number;
}

export interface ActivityDigestInput {
  events: ActivityEventRow[];
  ongoingTasks: ActivityEntityRow[];
}

/** `sources` = include-list of collector ids (undefined = no filtering,
 *  [] = match nothing). Disabled collectors hide their existing events. */
export async function listActivityEvents(
  vaultRoot: string,
  range: { from: number; to: number },
  types?: string[],
  sources?: string[],
): Promise<ActivityEventRow[]> {
  return invoke<ActivityEventRow[]>('activity_list_events', {
    vaultRoot,
    from: range.from,
    to: range.to,
    types,
    sources,
  });
}

export async function aggregateActivityMetrics(
  vaultRoot: string,
  range: { from: number; to: number },
  sources?: string[],
): Promise<ActivityMetricRow[]> {
  return invoke<ActivityMetricRow[]>('activity_aggregate_metrics', {
    vaultRoot,
    from: range.from,
    to: range.to,
    sources,
  });
}

// ponytail: whole-entity index with a 500 cap — the graph resolves neighbor
// labels/types from this one fetch instead of N get_entity invokes; paginate
// or batch-resolve when real vaults exceed the cap.
export async function listActivityEntities(
  vaultRoot: string,
  entityType?: string,
): Promise<ActivityEntityRow[]> {
  return invoke<ActivityEntityRow[]>('activity_list_entities', {
    vaultRoot,
    entityType,
    limit: 500,
  });
}

export async function getActivityEntityNeighbors(
  vaultRoot: string,
  entityId: string,
  sources?: string[],
): Promise<ActivityNeighborRow[]> {
  return invoke<ActivityNeighborRow[]>('activity_get_entity_neighbors', {
    vaultRoot,
    entityId,
    sources,
  });
}

export async function getActivityDailyDigestInput(
  vaultRoot: string,
  dateKey: string,
  sources?: string[],
): Promise<ActivityDigestInput | null> {
  return invoke<ActivityDigestInput | null>('activity_daily_digest_input', {
    vaultRoot,
    date: dateKey,
    sources,
  });
}

/** Cache a generated AI summary onto the event row (design §6). */
export async function setActivityEventSummary(
  vaultRoot: string,
  eventId: string,
  summary: string,
): Promise<boolean> {
  return invoke<boolean>('activity_set_event_summary', { vaultRoot, eventId, summary });
}
