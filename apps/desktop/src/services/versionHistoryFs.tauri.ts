/**
 * Tauri `@tauri-apps/plugin-fs` adapter for the {@link VersionFs} port.
 *
 * Pass-through: every path string is treated as an absolute on-disk path by
 * the caller (PR2's wrapper in {@link ./versionHistory.ts} resolves
 * vault-relative tab paths to absolute under the vault content root before
 * calling the pure service, which then hands the absolute path verbatim to
 * this adapter). The metadata paths (`<vaultRoot>/versions/...`) are already
 * absolute because `vaultRoot` is resolved from `homeDir() + join(...)`.
 *
 * ponytail: no tests for this file — it's a thin pass-through; the real
 * coverage is the pure service's in-memory FS shim in
 * `versionHistoryService.test.ts`. Adding a mock here would just re-assert
 * the function-call forwarding, which is `tsc`'s job.
 */
import { readTextFile, writeTextFile, exists, mkdir, rename } from '@tauri-apps/plugin-fs';
import type { VersionFs } from './versionHistoryService';

export const tauriVersionFs: VersionFs = {
  readFile: (path) => readTextFile(path),
  writeFile: (path, content) => writeTextFile(path, content),
  exists: (path) => exists(path),
  mkdir: (path, opts) => mkdir(path, opts ?? undefined),
  rename: (oldPath, newPath) => rename(oldPath, newPath),
};
