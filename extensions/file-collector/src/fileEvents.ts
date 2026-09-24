/**
 * Vault file-snapshot diffing (pure, tested).
 *
 * Each poll asks the host for a full vault file listing (`ctx.scanVault`, Rust
 * `activity_scan_vault`) and diffs it against the snapshot stored in the
 * cursor: new path → created, mtime/size changed → modified, gone → deleted.
 * A `null` prev snapshot is the baseline run — the initial listing produces
 * no events (everything already existed before the collector was installed).
 *
 * ponytail: full-snapshot diff, not fs events — no host-side watcher, the
 * cursor stays a self-contained JSON blob the host stores opaquely. Vaults
 * are note-scale (thousands of files); re-scan cost is fine at a 300s poll.
 */
import type { CollectorEvent } from 'folyn-extension-sdk';

/** One entry of the persisted snapshot (cursor JSON). */
export interface SnapshotEntry {
  mtimeMs: number;
  size: number;
}

/** path → { mtimeMs, size }. */
export type VaultSnapshot = Record<string, SnapshotEntry>;

/** One file as returned by `ctx.scanVault`. */
export interface VaultFile {
  path: string;
  mtimeMs: number;
  size: number;
}

function basename(path: string): string {
  return path.split('/').pop() ?? path;
}

function fileEvent(
  type: 'file_created' | 'file_modified' | 'file_deleted',
  path: string,
  mtimeMs: number,
  now: number,
  size?: number,
): CollectorEvent {
  const name = basename(path);
  return {
    id: `file-activity:${type}:${path}:${mtimeMs}`,
    type,
    occurredAt: now,
    title: name,
    summary: path,
    actor: { type: 'person', identityKey: 'self', displayName: '我' },
    entities: [
      { type: 'file', identityKey: path, displayName: name, relation: '文件' },
    ],
    payload: { path, mtimeMs, ...(size !== undefined ? { size } : {}) },
  };
}

/**
 * Diff two vault snapshots. `prev === null` → baseline: snapshot only, no
 * events. Deleted ids carry a `:del` suffix so they can never collide with a
 * created/modified id of the same path + mtime (the delete-then-recreate-at-
 * the-same-mtime case).
 */
export function diffSnapshots(
  prev: VaultSnapshot | null,
  current: VaultFile[],
  now: number,
): { events: CollectorEvent[]; snapshot: VaultSnapshot } {
  const snapshot: VaultSnapshot = {};
  for (const f of current) {
    snapshot[f.path] = { mtimeMs: f.mtimeMs, size: f.size };
  }
  if (prev === null) {
    return { events: [], snapshot };
  }
  const events: CollectorEvent[] = [];
  for (const f of current) {
    const before = prev[f.path];
    if (!before) {
      events.push(fileEvent('file_created', f.path, f.mtimeMs, now, f.size));
    } else if (before.mtimeMs !== f.mtimeMs || before.size !== f.size) {
      events.push(fileEvent('file_modified', f.path, f.mtimeMs, now, f.size));
    }
  }
  for (const [path, info] of Object.entries(prev)) {
    if (!(path in snapshot)) {
      const ev = fileEvent('file_deleted', path, info.mtimeMs, now);
      ev.id += ':del';
      events.push(ev);
    }
  }
  return { events, snapshot };
}

/** Parse the cursor back into a snapshot; empty/unparseable → null (baseline). */
export function parseSnapshot(cursor: string): VaultSnapshot | null {
  if (!cursor) return null;
  try {
    const parsed = JSON.parse(cursor) as unknown;
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return parsed as VaultSnapshot;
  } catch {
    return null;
  }
}
