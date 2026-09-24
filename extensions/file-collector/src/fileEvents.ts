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
  /**
   * Truncated text (host `ctx.readVaultFile`, ~8KB/file ceiling) — absent for
   * binary / oversized / unreadable files.
   *
   * ponytail: the cursor now carries capped per-file text (the baseline run
   * reads the vault once). ~8KB/file ceiling — upgrade path = a
   * content-addressed cache table when cursor size becomes a real problem.
   * Content also rides event `payload` (NOT `raw`), so the host's keepRaw
   * switch does not strip it — deliberate, the user asked for content.
   */
  content?: string;
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
  payload?: Record<string, unknown>,
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
    payload: { path, mtimeMs, ...(size !== undefined ? { size } : {}), ...payload },
  };
}

/**
 * Line diff between two file contents (either may be null = absent/unreadable).
 * Unified-style single hunk: common line prefix/suffix trimmed, remaining
 * middle rendered as `- ` (removed) / `+ ` (added) lines. Identical (no
 * middle) or both null → null.
 *
 * Caps: ≤100 removed + ≤100 added lines, each line ≤200 chars, total ~8000
 * chars — the same order of magnitude as the readVaultFile byte cap, so a
 * diff never dwarfs the content it came from.
 */
export function textDiff(oldContent: string | null, newContent: string | null): string | null {
  if (oldContent === null && newContent === null) return null;
  const oldLines = oldContent === null ? [] : oldContent.split('\n');
  const newLines = newContent === null ? [] : newContent.split('\n');
  let start = 0;
  while (start < oldLines.length && start < newLines.length && oldLines[start] === newLines[start]) {
    start++;
  }
  let endOld = oldLines.length;
  let endNew = newLines.length;
  while (endOld > start && endNew > start && oldLines[endOld - 1] === newLines[endNew - 1]) {
    endOld--;
    endNew--;
  }
  const removed = oldLines.slice(start, endOld);
  const added = newLines.slice(start, endNew);
  if (removed.length === 0 && added.length === 0) return null;
  const clip = (line: string) => (line.length > 200 ? line.slice(0, 200) : line);
  const lines = [
    ...removed.slice(0, 100).map((l) => `- ${clip(l)}`),
    ...added.slice(0, 100).map((l) => `+ ${clip(l)}`),
  ];
  return lines.join('\n').slice(0, 8000);
}

/**
 * Diff two vault snapshots. `prev === null` → baseline: snapshot only, no
 * events. Deleted ids carry a `:del` suffix so they can never collide with a
 * created/modified id of the same path + mtime (the delete-then-recreate-at-
 * the-same-mtime case).
 *
 * `contents`: path → text just read this run (`ctx.readVaultFile`); a path
 * absent from the map was not read (its snapshot entry keeps the previous
 * run's content so a later modification still diffs against it).
 */
export function diffSnapshots(
  prev: VaultSnapshot | null,
  current: VaultFile[],
  contents: Map<string, string | null>,
  now: number,
): { events: CollectorEvent[]; snapshot: VaultSnapshot } {
  const snapshot: VaultSnapshot = {};
  for (const f of current) {
    const read = contents.get(f.path);
    // Not re-read this run → carry the previous content forward (an unchanged
    // file keeps its stored text; a read returning null (binary/huge) drops it).
    const content =
      typeof read === 'string'
        ? read
        : contents.has(f.path)
          ? undefined
          : prev?.[f.path]?.content;
    snapshot[f.path] = { mtimeMs: f.mtimeMs, size: f.size, ...(content !== undefined ? { content } : {}) };
  }
  if (prev === null) {
    return { events: [], snapshot };
  }
  const events: CollectorEvent[] = [];
  for (const f of current) {
    const before = prev[f.path];
    if (!before) {
      const content = contents.get(f.path);
      events.push(
        fileEvent('file_created', f.path, f.mtimeMs, now, f.size, typeof content === 'string' ? { content } : undefined),
      );
    } else if (before.mtimeMs !== f.mtimeMs || before.size !== f.size) {
      const newContent = contents.get(f.path) ?? null;
      const oldContent = before.content ?? null;
      const extra: Record<string, unknown> = {};
      if (oldContent === null) {
        // No stored old content (baseline couldn't read it / legacy cursor):
        // a "+ everything" diff would just duplicate the content — show it
        // as content instead.
        if (typeof newContent === 'string') extra.content = newContent;
      } else {
        const diff = textDiff(oldContent, newContent);
        if (diff !== null) extra.diff = diff;
        // Identical content (touch / rewrite): neither diff nor content.
      }
      events.push(fileEvent('file_modified', f.path, f.mtimeMs, now, f.size, extra));
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

/**
 * True if any snapshot entry carries a string `content` — i.e. the snapshot
 * was written by the content-aware version. A non-null snapshot with no
 * content anywhere is a legacy cursor (metadata-only version): the caller
 * re-runs the full-vault read so future modifications have something to
 * diff against.
 */
export function snapshotHasContent(s: VaultSnapshot): boolean {
  return Object.values(s).some((e) => typeof e?.content === 'string');
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
