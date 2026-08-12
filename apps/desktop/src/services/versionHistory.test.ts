import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock `homeDir` + `join` BEFORE importing the module so the wrapper's
// `resolveVaultRoot` is deterministic. The mock returns logical paths
// (no real Tauri IPC). The `join` mock mirrors `@tauri-apps/api/path`'s
// `join(a, b, c) → `${a}/${b}/${c}`` semantics for the test paths we use.
vi.mock('@tauri-apps/api/path', () => ({
  homeDir: async () => '/mock/home',
  join: async (...parts: string[]) => parts.join('/').replace(/\/+/g, '/'),
}));

// ponytail: do NOT mock the Tauri fs adapter here — the wrapper takes a
// VersionFs default-arg, so we pass a fake. Verifying the adapter itself
// is just function-call forwarding (`tsc` covers that).

import { snapshot, listSnapshots, readBlob, restore } from './versionHistory';
import type { VersionFs, SnapshotEntry } from './versionHistoryService';

/**
 * In-memory VersionFs fake — same shape as the PR1 test shim. Path strings
 * are opaque map keys; the wrapper only ever constructs paths by joining
 * the resolved vaultRoot with literal `versions` / `blobs` / `index.json`.
 */
function createFakeFs(): VersionFs & { files: Map<string, string> } {
  const files = new Map<string, string>();
  return {
    files,
    readFile: async (p) => {
      if (!files.has(p)) throw new Error(`ENOENT: ${p}`);
      return files.get(p)!;
    },
    writeFile: async (p, c) => { files.set(p, c); },
    exists: async (p) => files.has(p),
    mkdir: async () => {},
    rename: async (oldP, newP) => {
      if (!files.has(oldP)) throw new Error(`ENOENT: ${oldP}`);
      files.set(newP, files.get(oldP)!);
      files.delete(oldP);
    },
  };
}

describe('versionHistory — wrapper resolves vault root + delegates', () => {
  const VAULT_ID = 'vault-1';
  const FILE_PATH = '/mock/home/quill/default_vault/notes/foo.md';
  // The wrapper computes `${home}/.quill/vaults/${vaultId}` via the mocked
  // join, so the expected metadata root is `/mock/home/.quill/vaults/vault-1`.
  const META_ROOT = '/mock/home/.quill/vaults/vault-1';

  let fs: ReturnType<typeof createFakeFs>;

  beforeEach(() => {
    fs = createFakeFs();
  });

  it('snapshot writes a blob + index entry under the resolved metadata root', async () => {
    await fs.writeFile(FILE_PATH, 'hello world');

    const result = await snapshot(VAULT_ID, FILE_PATH, fs);

    expect(result.kind).toBe('written');
    // Blob exists under the metadata root, not the vault content root.
    const blobEntry = [...fs.files.keys()].find((k) =>
      k.startsWith(`${META_ROOT}/versions/blobs/`),
    );
    expect(blobEntry).toBeDefined();
    expect(fs.files.get(blobEntry!)).toBe('hello world');

    // Index lists the file's entry.
    const indexRaw = fs.files.get(`${META_ROOT}/versions/index.json`);
    expect(indexRaw).toBeDefined();
    const index = JSON.parse(indexRaw!) as Record<string, SnapshotEntry[]>;
    expect(index[FILE_PATH]).toHaveLength(1);
    expect(index[FILE_PATH]![0]).toMatchObject({
      size: 'hello world'.length,
    });
  });

  it('listSnapshots returns entries written by snapshot', async () => {
    await fs.writeFile(FILE_PATH, 'v1');
    await snapshot(VAULT_ID, FILE_PATH, fs);
    await fs.writeFile(FILE_PATH, 'v2');
    await snapshot(VAULT_ID, FILE_PATH, fs);

    const list = await listSnapshots(VAULT_ID, FILE_PATH, fs);
    expect(list).toHaveLength(2);
    expect(list[0]!.size).toBe('v1'.length);
    expect(list[1]!.size).toBe('v2'.length);
  });

  it('readBlob returns blob content by hash+ext', async () => {
    await fs.writeFile(FILE_PATH, 'snapshotted');
    const result = await snapshot(VAULT_ID, FILE_PATH, fs);
    if (result.kind !== 'written') throw new Error('expected written');
    const content = await readBlob(VAULT_ID, result.hash, 'md', fs);
    expect(content).toBe('snapshotted');
  });

  it('restore preserves current state then overwrites', async () => {
    // Two snapshots: v1, v2.
    await fs.writeFile(FILE_PATH, 'v1');
    const r1 = await snapshot(VAULT_ID, FILE_PATH, fs);
    await fs.writeFile(FILE_PATH, 'v2');
    await snapshot(VAULT_ID, FILE_PATH, fs);

    // Restore v1 → current (v2) snapshotted first, then file overwritten with v1.
    if (r1.kind !== 'written') throw new Error('expected written');
    await restore(VAULT_ID, FILE_PATH, r1.hash, 'md', fs);

    expect(fs.files.get(FILE_PATH)).toBe('v1');
    const list = await listSnapshots(VAULT_ID, FILE_PATH, fs);
    // v1, v2, v1(restored) — 3 entries, monotonic per PRD §5.
    expect(list).toHaveLength(3);
  });
});
