/**
 * Version history storage service — PR1.
 *
 * Pure logic + an injectable FS-port. The service knows about the on-disk layout
 * (`<vaultRoot>/versions/blobs/<hash>.<ext>` + `<vaultRoot>/versions/index.json`)
 * but does NOT know how to resolve `~/.mochi/vaults/<vaultId>` from a vault id —
 * the caller (PR2) passes `vaultRoot` already resolved. `filePath` is treated
 * opaquely: it is passed verbatim to the FS-port's `readFile` / `writeFile` AND
 * used as the index key. The real Tauri FS adapter (PR2) is responsible for
 * translating a vault-relative `filePath` into the absolute on-disk path.
 *
 * Layout (per ADR-0003):
 *   <vaultRoot>/versions/blobs/<sha256>.<ext>   — content blobs (dedup by hash)
 *   <vaultRoot>/versions/index.json             — { [filePath]: SnapshotEntry[] }
 *
 * Atomicity: `index.json` is the single source of truth. It is rewritten by
 * writing to `index.json.tmp` then renaming — a crash between blob-write and
 * rename leaves the index either in pre-snapshot or post-snapshot state, never
 * partial. Orphan blobs (written but never indexed) are harmless: they are
 * content-addressable, so a future snapshot of the same content reuses them.
 */

// ponytail: this is the storage layer only. No editor/editorStore/editorIoService
// coupling, no UI, no Tauri-specific FS calls. PR2 wires the save/close hooks
// and injects a real `@tauri-apps/plugin-fs` adapter; PR3 adds the UI panel.

export interface VersionFs {
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
  exists(path: string): Promise<boolean>;
  mkdir(path: string, opts?: { recursive?: boolean }): Promise<void>;
  rename(oldPath: string, newPath: string): Promise<void>;
}

export interface SnapshotEntry {
  hash: string;
  ts: number;
  size: number;
}

export type IndexShape = Record<string, SnapshotEntry[]>;

export type SnapshotResult =
  | { kind: 'written'; hash: string; ts: number }
  | { kind: 'skipped' };

const VERSIONS_DIR = 'versions';
const BLOBS_DIR = 'blobs';
const INDEX_FILE = 'index.json';
const INDEX_TMP = 'index.json.tmp';

function joinPath(...parts: string[]): string {
  return parts.join('/').replace(/\/+/g, '/');
}

function versionsDir(vaultRoot: string): string {
  return joinPath(vaultRoot, VERSIONS_DIR);
}

function blobsDir(vaultRoot: string): string {
  return joinPath(versionsDir(vaultRoot), BLOBS_DIR);
}

function indexPath(vaultRoot: string): string {
  return joinPath(versionsDir(vaultRoot), INDEX_FILE);
}

function tmpIndexPath(vaultRoot: string): string {
  return joinPath(versionsDir(vaultRoot), INDEX_TMP);
}

function blobPath(vaultRoot: string, hash: string, ext: string): string {
  const file = ext ? `${hash}.${ext}` : hash;
  return joinPath(blobsDir(vaultRoot), file);
}

function getExt(filePath: string): string {
  const base = filePath.split('/').pop() ?? filePath;
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : '';
}

async function sha256Hex(content: string): Promise<string> {
  const data = new TextEncoder().encode(content);
  const buf = await crypto.subtle.digest('SHA-256', data);
  const bytes = new Uint8Array(buf);
  let hex = '';
  for (let i = 0; i < bytes.length; i++) hex += bytes[i]!.toString(16).padStart(2, '0');
  return hex;
}

async function ensureDir(fs: VersionFs, dir: string): Promise<void> {
  if (!(await fs.exists(dir))) {
    await fs.mkdir(dir, { recursive: true });
  }
}

async function readIndex(vaultRoot: string, fs: VersionFs): Promise<IndexShape> {
  const p = indexPath(vaultRoot);
  if (!(await fs.exists(p))) return {};
  try {
    const raw = await fs.readFile(p);
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as IndexShape;
    }
    return {};
  } catch {
    // Corrupt or unreadable index — treat as empty. A self-healing rescan is
    // out of scope for v1 (see ADR-0003); the next snapshot overwrites it.
    return {};
  }
}

async function writeIndexAtomic(
  vaultRoot: string,
  index: IndexShape,
  fs: VersionFs,
): Promise<void> {
  await ensureDir(fs, versionsDir(vaultRoot));
  const tmp = tmpIndexPath(vaultRoot);
  const final = indexPath(vaultRoot);
  await fs.writeFile(tmp, JSON.stringify(index, null, 2));
  await fs.rename(tmp, final);
}

/**
 * Read on-disk content, hash, dedup vs the file's last index entry, write a
 * content-addressable blob (skip if it already exists — cross-file dedup is
 * free), and append a `{hash, ts, size}` entry to `index.json` atomically.
 * Idempotent: identical-content calls after the first are no-ops.
 */
export async function snapshot(
  vaultRoot: string,
  filePath: string,
  fs: VersionFs,
): Promise<SnapshotResult> {
  const content = await fs.readFile(filePath);
  const hash = await sha256Hex(content);
  const ext = getExt(filePath);

  const index = await readIndex(vaultRoot, fs);
  const entries = index[filePath] ?? [];
  const last = entries[entries.length - 1];
  if (last && last.hash === hash) {
    return { kind: 'skipped' };
  }

  const bPath = blobPath(vaultRoot, hash, ext);
  await ensureDir(fs, blobsDir(vaultRoot));
  if (!(await fs.exists(bPath))) {
    await fs.writeFile(bPath, content);
  }

  const entry: SnapshotEntry = { hash, ts: Date.now(), size: content.length };
  const newIndex: IndexShape = { ...index, [filePath]: [...entries, entry] };
  await writeIndexAtomic(vaultRoot, newIndex, fs);
  return { kind: 'written', hash, ts: entry.ts };
}

/**
 * Return the snapshots recorded for `filePath`, in insertion (time) order.
 */
export async function listSnapshots(
  vaultRoot: string,
  filePath: string,
  fs: VersionFs,
): Promise<SnapshotEntry[]> {
  const index = await readIndex(vaultRoot, fs);
  return index[filePath] ?? [];
}

/**
 * Read a blob's content by hash + extension. Used by the diff/restore UI.
 */
export async function readBlob(
  vaultRoot: string,
  hash: string,
  ext: string,
  fs: VersionFs,
): Promise<string> {
  return fs.readFile(blobPath(vaultRoot, hash, ext));
}

/**
 * Restore `filePath` to the content of the `<targetHash>.<targetExt>` blob.
 *
 * Three-step monotonic chain (per PRD §5):
 *   (a) snapshot current on-disk content first — never loses the current state.
 *   (b) overwrite on-disk file with the target blob's content.
 *   (c) snapshot the just-restored content — appends the restored hash as a
 *       new index entry, so the history chain is monotonic (no version lost).
 *
 * Returns the result of step (c).
 */
export async function restore(
  vaultRoot: string,
  filePath: string,
  targetHash: string,
  targetExt: string,
  fs: VersionFs,
): Promise<SnapshotResult> {
  // (a) Preserve current state before overwriting.
  await snapshot(vaultRoot, filePath, fs);
  // (b) Overwrite on-disk content with the chosen blob.
  const blobContent = await readBlob(vaultRoot, targetHash, targetExt, fs);
  await fs.writeFile(filePath, blobContent);
  // (c) Snapshot the restored content → new index entry with the restored hash.
  return snapshot(vaultRoot, filePath, fs);
}
