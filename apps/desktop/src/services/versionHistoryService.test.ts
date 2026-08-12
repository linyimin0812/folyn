import { describe, it, expect, vi } from 'vitest';

import type { VersionFs } from './versionHistoryService';
import {
  snapshot,
  listSnapshots,
  readBlob,
  restore,
} from './versionHistoryService';

/**
 * In-memory FS shim matching the `VersionFs` port. Path strings are opaque
 * map keys (the service only ever joins them with `/`); we model dirs as
 * no-ops since the service never reads a directory listing.
 */
function createInMemoryFs(): VersionFs & {
  files: Map<string, string>;
  renameSpy: ReturnType<typeof vi.fn>;
} {
  const files = new Map<string, string>();
  const renameSpy = vi.fn(async (oldP: string, newP: string) => {
    if (!files.has(oldP)) throw new Error(`ENOENT: ${oldP}`);
    files.set(newP, files.get(oldP)!);
    files.delete(oldP);
  });
  return {
    files,
    renameSpy,
    readFile: async (p: string) => {
      if (!files.has(p)) throw new Error(`ENOENT: ${p}`);
      return files.get(p)!;
    },
    writeFile: async (p: string, c: string) => {
      files.set(p, c);
    },
    exists: async (p: string) => files.has(p),
    mkdir: async () => {},
    rename: renameSpy,
  };
}

const VAULT_ROOT = '/mock/vault';
const FILE_A = 'notes/a.md';
const FILE_B = 'notes/b.md';

async function putFile(fs: VersionFs, path: string, content: string): Promise<void> {
  await fs.writeFile(path, content);
}

describe('versionHistoryService — snapshot', () => {
  it('writes a blob + index entry on first snapshot of new content', async () => {
    const fs = createInMemoryFs();
    await putFile(fs, FILE_A, 'hello world');

    const result = await snapshot(VAULT_ROOT, FILE_A, fs);

    expect(result.kind).toBe('written');
    if (result.kind !== 'written') return;
    expect(result.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(result.ts).toBeGreaterThan(0);

    // Blob file on disk
    const blobFiles = [...fs.files.keys()].filter((k) => k.includes('/blobs/'));
    expect(blobFiles).toHaveLength(1);
    expect(blobFiles[0]!).toContain(result.hash);
    expect(blobFiles[0]!).toMatch(/\.md$/);

    // Index has one entry with {hash, ts, size}
    const entries = await listSnapshots(VAULT_ROOT, FILE_A, fs);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.hash).toBe(result.hash);
    expect(entries[0]!.ts).toBe(result.ts);
    expect(entries[0]!.size).toBe('hello world'.length);
  });

  it('dedups: snapshotting identical content twice is a no-op', async () => {
    const fs = createInMemoryFs();
    await putFile(fs, FILE_A, 'same');

    const first = await snapshot(VAULT_ROOT, FILE_A, fs);
    const second = await snapshot(VAULT_ROOT, FILE_A, fs);

    expect(first.kind).toBe('written');
    expect(second).toEqual({ kind: 'skipped' });

    const entries = await listSnapshots(VAULT_ROOT, FILE_A, fs);
    expect(entries).toHaveLength(1);
  });

  it('appends a new entry when content changes between snapshots', async () => {
    const fs = createInMemoryFs();
    await putFile(fs, FILE_A, 'v1');
    const r1 = await snapshot(VAULT_ROOT, FILE_A, fs);
    expect(r1.kind).toBe('written');

    await putFile(fs, FILE_A, 'v2');
    const r2 = await snapshot(VAULT_ROOT, FILE_A, fs);
    expect(r2.kind).toBe('written');
    if (r2.kind !== 'written') return;

    const entries = await listSnapshots(VAULT_ROOT, FILE_A, fs);
    expect(entries).toHaveLength(2);
    expect(entries[0]!.hash).not.toBe(entries[1]!.hash);
    expect(entries[1]!.hash).toBe(r2.hash);
  });

  it('reuses a single blob across two files with identical content', async () => {
    const fs = createInMemoryFs();
    await putFile(fs, FILE_A, 'shared');
    await putFile(fs, FILE_B, 'shared');

    const r1 = await snapshot(VAULT_ROOT, FILE_A, fs);
    const r2 = await snapshot(VAULT_ROOT, FILE_B, fs);
    expect(r1.kind).toBe('written');
    expect(r2.kind).toBe('written');
    if (r1.kind !== 'written' || r2.kind !== 'written') return;
    expect(r1.hash).toBe(r2.hash);

    // Only one blob file on disk.
    const blobFiles = [...fs.files.keys()].filter((k) => k.includes('/blobs/'));
    expect(blobFiles).toHaveLength(1);

    // Both files have independent index entries pointing at the same hash.
    const eA = await listSnapshots(VAULT_ROOT, FILE_A, fs);
    const eB = await listSnapshots(VAULT_ROOT, FILE_B, fs);
    expect(eA).toHaveLength(1);
    expect(eB).toHaveLength(1);
    expect(eA[0]!.hash).toBe(r1.hash);
    expect(eB[0]!.hash).toBe(r2.hash);
  });

  it('returns snapshots in insertion (time) order', async () => {
    const fs = createInMemoryFs();
    await putFile(fs, FILE_A, 'a');
    await snapshot(VAULT_ROOT, FILE_A, fs);
    await putFile(fs, FILE_A, 'b');
    await snapshot(VAULT_ROOT, FILE_A, fs);
    await putFile(fs, FILE_A, 'a');
    await snapshot(VAULT_ROOT, FILE_A, fs);

    const entries = await listSnapshots(VAULT_ROOT, FILE_A, fs);
    expect(entries).toHaveLength(3);
    expect(entries[0]!.hash).not.toBe(entries[1]!.hash);
    // First and third snapshots have identical content but are both written
    // (dedup only consults the file's *last* entry, which differs in both
    // cases).
    expect(entries[0]!.hash).toBe(entries[2]!.hash);
    expect(entries[0]!.ts).toBeLessThanOrEqual(entries[1]!.ts);
    expect(entries[1]!.ts).toBeLessThanOrEqual(entries[2]!.ts);
  });
});

describe('versionHistoryService — atomic index write', () => {
  it('index.json is unchanged (pre-snapshot state) when rename throws', async () => {
    const fs = createInMemoryFs();
    await putFile(fs, FILE_A, 'crash-test');
    // Pre-seed an existing index so we can assert "unchanged" meaningfully.
    await fs.writeFile(
      `${VAULT_ROOT}/versions/index.json`,
      JSON.stringify({ 'other/file.md': [{ hash: 'existing', ts: 1, size: 1 }] }, null, 2),
    );

    // Force rename to throw — simulates a crash between blob-write and the
    // index rename step. The blob has already been written; the index.tmp
    // has been written; but the rename to the final path fails.
    fs.renameSpy.mockImplementationOnce(async () => {
      throw new Error('simulated crash during rename');
    });

    await expect(snapshot(VAULT_ROOT, FILE_A, fs)).rejects.toThrow('simulated crash during rename');

    // Index.json still reflects the pre-snapshot state (only the seeded entry).
    const indexRaw = fs.files.get(`${VAULT_ROOT}/versions/index.json`);
    expect(indexRaw).toBeDefined();
    const index = JSON.parse(indexRaw!);
    expect(Object.keys(index)).toEqual(['other/file.md']);
    expect(index[FILE_A]).toBeUndefined();

    // listSnapshots for the just-snapshotted file is empty (no index entry).
    const entries = await listSnapshots(VAULT_ROOT, FILE_A, fs);
    expect(entries).toHaveLength(0);
  });

  it('a successful snapshot writes index.json.tmp then renames atomically', async () => {
    const fs = createInMemoryFs();
    await putFile(fs, FILE_A, 'atomic');

    await snapshot(VAULT_ROOT, FILE_A, fs);

    // After a successful snapshot, no tmp file lingers.
    expect(fs.files.has(`${VAULT_ROOT}/versions/index.json.tmp`)).toBe(false);
    // The final index file exists.
    expect(fs.files.has(`${VAULT_ROOT}/versions/index.json`)).toBe(true);
    // rename was called exactly once (tmp → final).
    expect(fs.renameSpy).toHaveBeenCalledTimes(1);
  });
});

describe('versionHistoryService — restore', () => {
  it('restore chain is monotonic: [A, B, A] with no version lost', async () => {
    const fs = createInMemoryFs();
    const contentA = 'original A';
    const contentB = 'edited B';

    // Snapshot A
    await putFile(fs, FILE_A, contentA);
    const r1 = await snapshot(VAULT_ROOT, FILE_A, fs);
    expect(r1.kind).toBe('written');
    if (r1.kind !== 'written') return;
    const hashA = r1.hash;

    // Snapshot B
    await putFile(fs, FILE_A, contentB);
    const r2 = await snapshot(VAULT_ROOT, FILE_A, fs);
    expect(r2.kind).toBe('written');
    if (r2.kind !== 'written') return;
    const hashB = r2.hash;
    expect(hashA).not.toBe(hashB);

    // Restore A — should produce 3 index entries [A, B, A].
    const restoreResult = await restore(VAULT_ROOT, FILE_A, hashA, 'md', fs);
    expect(restoreResult.kind).toBe('written');
    if (restoreResult.kind !== 'written') return;
    expect(restoreResult.hash).toBe(hashA);

    // On-disk content is back to A.
    expect(await fs.readFile(FILE_A)).toBe(contentA);

    const entries = await listSnapshots(VAULT_ROOT, FILE_A, fs);
    expect(entries.map((e) => e.hash)).toEqual([hashA, hashB, hashA]);
  });

  it('restore preserves the current state by snapshotting it first', async () => {
    const fs = createInMemoryFs();
    await putFile(fs, FILE_A, 'v1');
    const r1 = await snapshot(VAULT_ROOT, FILE_A, fs);
    if (r1.kind !== 'written') throw new Error('first snapshot must write');
    const hashV1 = r1.hash;

    await putFile(fs, FILE_A, 'v2-uncommitted');
    const r2 = await snapshot(VAULT_ROOT, FILE_A, fs);
    if (r2.kind !== 'written') throw new Error('second snapshot must write');
    const hashV2 = r2.hash;

    // At this point index = [v1, v2-uncommitted]. Restore v1.
    await restore(VAULT_ROOT, FILE_A, hashV1, 'md', fs);

    // After restore, the chain is [v1, v2-uncommitted, v1] — v2-uncommitted
    // (the pre-restore current state) was snapshotted in step (a) of restore.
    const entries = await listSnapshots(VAULT_ROOT, FILE_A, fs);
    expect(entries.map((e) => e.hash)).toEqual([hashV1, hashV2, hashV1]);

    // The v2-uncommitted blob is still readable (the user can restore it back).
    expect(await readBlob(VAULT_ROOT, hashV2, 'md', fs)).toBe('v2-uncommitted');
  });

  it('restore overwrites the on-disk file with the target blob content', async () => {
    const fs = createInMemoryFs();
    await putFile(fs, FILE_A, 'first');
    const r1 = await snapshot(VAULT_ROOT, FILE_A, fs);
    if (r1.kind !== 'written') throw new Error('first snapshot must write');
    const hashFirst = r1.hash;

    await putFile(fs, FILE_A, 'second');
    await snapshot(VAULT_ROOT, FILE_A, fs);

    await restore(VAULT_ROOT, FILE_A, hashFirst, 'md', fs);
    expect(await fs.readFile(FILE_A)).toBe('first');
  });
});

describe('versionHistoryService — listSnapshots', () => {
  it('returns an empty array for a file with no snapshots', async () => {
    const fs = createInMemoryFs();
    const entries = await listSnapshots(VAULT_ROOT, 'never/seen.md', fs);
    expect(entries).toEqual([]);
  });

  it('isolates entries per file path', async () => {
    const fs = createInMemoryFs();
    await putFile(fs, FILE_A, 'a1');
    await snapshot(VAULT_ROOT, FILE_A, fs);
    await putFile(fs, FILE_B, 'b1');
    await snapshot(VAULT_ROOT, FILE_B, fs);
    await putFile(fs, FILE_A, 'a2');
    await snapshot(VAULT_ROOT, FILE_A, fs);

    const eA = await listSnapshots(VAULT_ROOT, FILE_A, fs);
    const eB = await listSnapshots(VAULT_ROOT, FILE_B, fs);
    expect(eA).toHaveLength(2);
    expect(eB).toHaveLength(1);
  });
});
