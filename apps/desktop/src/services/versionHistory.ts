/**
 * Real entrypoint for version-history operations.
 *
 * Resolves the per-vault metadata root (`~/.mochi/vaults/<vaultId>/`) and
 * delegates to the pure service from `versionHistoryService.ts` with the
 * Tauri FS adapter. The pure service remains the testable core (no Tauri
 * coupling, in-memory FS shim in its test file).
 *
 * `filePath` is **absolute on-disk path** to the source file (NOT
 * vault-relative). PR1's pure service treats `filePath` opaquely — it is
 * passed verbatim to `VersionFs.readFile` AND used as the `index.json` key.
 * Using the absolute path as the key is correct for ADR-0003's
 * machine-local contract (snapshots are NOT portable across machines, so a
 * machine-specific key is fine).
 *
 * Callers (currently only `editorIoService`) resolve `tab.path`
 * (vault-relative) to absolute under the vault content root before calling.
 */
import { homeDir, join } from '@tauri-apps/api/path';
import type { VersionFs, SnapshotEntry, SnapshotResult } from './versionHistoryService';
import {
  snapshot as snapshotPure,
  listSnapshots as listSnapshotsPure,
  readBlob as readBlobPure,
  restore as restorePure,
} from './versionHistoryService';
import { tauriVersionFs } from './versionHistoryFs.tauri';

// ponytail: module-level cache. `homeDir()` is a static per-session value;
// caching avoids a redundant IPC round-trip on every snapshot call (the
// save path is hot — fires on every Cmd+S). Mirrors `pathResolver.ts`'s
// homeDir cache pattern. Upgrade: invalidate if OS-user switching ever
// becomes a thing (it doesn't).
let versionsBase = '';

async function resolveVaultRoot(vaultId: string): Promise<string> {
  if (!versionsBase) {
    const home = (await homeDir()).replace(/\/+$/, '');
    versionsBase = await join(home, '.mochi', 'vaults');
  }
  return join(versionsBase, vaultId);
}

export async function snapshot(
  vaultId: string,
  absFilePath: string,
  fs: VersionFs = tauriVersionFs,
): Promise<SnapshotResult> {
  const vaultRoot = await resolveVaultRoot(vaultId);
  return snapshotPure(vaultRoot, absFilePath, fs);
}

export async function listSnapshots(
  vaultId: string,
  absFilePath: string,
  fs: VersionFs = tauriVersionFs,
): Promise<SnapshotEntry[]> {
  const vaultRoot = await resolveVaultRoot(vaultId);
  return listSnapshotsPure(vaultRoot, absFilePath, fs);
}

export async function readBlob(
  vaultId: string,
  hash: string,
  ext: string,
  fs: VersionFs = tauriVersionFs,
): Promise<string> {
  const vaultRoot = await resolveVaultRoot(vaultId);
  return readBlobPure(vaultRoot, hash, ext, fs);
}

export async function restore(
  vaultId: string,
  absFilePath: string,
  targetHash: string,
  targetExt: string,
  fs: VersionFs = tauriVersionFs,
): Promise<SnapshotResult> {
  const vaultRoot = await resolveVaultRoot(vaultId);
  return restorePure(vaultRoot, absFilePath, targetHash, targetExt, fs);
}
