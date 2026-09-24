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
import { isCollectRunRecord, type CollectRunRecord } from '@/store/activityCollectorStore';
import { storageClient } from '@/utils/storageClient';

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

// ── Collect-run history (采集记录 — activity db, replaces the old
// storageClient-persisted collectHistory) ────────────────────────────────────

/** Append one completed run to the activity db (Rust enforces the 100-row
 *  and 50-log caps). No-op without an open vault. */
export async function insertActivityCollectRun(record: CollectRunRecord): Promise<void> {
  const vaultRoot = await currentVaultRoot();
  if (!vaultRoot) return;
  await invoke('activity_insert_collect_run', { vaultRoot, run: record });
}

/**
 * All runs (≤ 100), newest-first. On the first call after the db migration,
 * this also performs the one-time legacy migration: any `collectHistory`
 * array still persisted in the storageClient 'activityCollectors' blob is
 * validated, inserted oldest-first (so cap eviction keeps the newest), and
 * the key is stripped from the blob — the removal is the run-at-most-once
 * guard. On migration failure the key is left in place for a retry next
 * launch (worst case: duplicate rows of debug-log history).
 */
export async function listActivityCollectRuns(): Promise<CollectRunRecord[]> {
  const vaultRoot = await currentVaultRoot();
  if (!vaultRoot) return [];
  const blob = await storageClient.get<Record<string, unknown>>('activityCollectors');
  if (blob && typeof blob === 'object' && 'collectHistory' in blob) {
    try {
      const legacy = Array.isArray(blob.collectHistory)
        ? blob.collectHistory.filter(isCollectRunRecord)
        : [];
      legacy.sort((a, b) => a.startedAt - b.startedAt);
      for (const r of legacy) {
        await invoke('activity_insert_collect_run', { vaultRoot, run: r });
      }
      const { collectHistory: _migrated, ...rest } = blob;
      await storageClient.set('activityCollectors', rest);
    } catch (err) {
      console.error('[activity] legacy collectHistory migration failed (will retry next launch):', err);
    }
  }
  return invoke<CollectRunRecord[]>('activity_list_collect_runs', { vaultRoot });
}
