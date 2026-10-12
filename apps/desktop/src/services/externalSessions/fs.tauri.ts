/**
 * Tauri adapters for the external-session service ports.
 *
 * - `tauriSessionFs`: reads local Codex rollout and Claude Code transcript
 *   files through `@tauri-apps/plugin-fs` (read-only — never writes, resumes
 *   or migrates source sessions). `readLines` uses `readTextFileLines` so
 *   bounded head reads do not load whole multi-MB transcripts. Satisfies both
 *   `CodexSessionFs` and `ClaudeSessionFs` (the superset with `mtime`).
 * - `vaultCapturePort`: binds the CURRENT VaultManager at bind time — the
 *   write goes to the vault the user confirmed, even if the app switches
 *   vaults mid-save. Binary asset writes go through `writeFileBytes`
 *   (byte-identical round-trip).
 *
 * Thin pass-throughs (no unit tests — mirrors versionHistoryFs.tauri.ts).
 */
import { exists, readDir, readTextFile, readTextFileLines, stat } from '@tauri-apps/plugin-fs';
import { useVaultStore } from '@/store/vaultStore';
import type { ClaudeSessionFs } from './claudeSessions';
import type { CodexSessionFs } from './codexSessions';
import type { CaptureWritePort } from './captureService';

export const tauriSessionFs: ClaudeSessionFs = {
  readLines: async (path, maxLines) => {
    const iterator = await readTextFileLines(path);
    const lines: string[] = [];
    for await (const line of iterator) {
      lines.push(line);
      if (lines.length >= maxLines) break;
    }
    void iterator.return?.(); // release the underlying file handle
    return lines;
  },
  readTextFile: (path) => readTextFile(path),
  listJsonlFiles: async (dir) => {
    const files: string[] = [];
    const walk = async (d: string): Promise<void> => {
      const entries = await readDir(d);
      for (const entry of entries) {
        const child = `${d.replace(/\/+$/, '')}/${entry.name}`;
        if (entry.isDirectory) {
          await walk(child);
        } else if (entry.isFile && entry.name.endsWith('.jsonl')) {
          files.push(child);
        }
      }
    };
    await walk(dir);
    return files;
  },
  exists: (path) => exists(path),
  mtime: async (path) => {
    try {
      const s = await stat(path);
      return s.mtime == null ? null : s.mtime.getTime();
    } catch {
      return null;
    }
  },
};

/** Alias kept for the Codex-only call shape (index.ts defaults). */
export const tauriCodexSessionFs: CodexSessionFs = tauriSessionFs;

/** Build a capture write port bound to the currently active vault manager. */
export function bindVaultCapturePort(): CaptureWritePort {
  const { manager, currentVault } = useVaultStore.getState();
  if (!currentVault) throw new Error('sessions: no active vault');
  return {
    createDir: (path) => manager.createDir(path),
    writeFile: (path, content) => manager.writeFile(path, content),
    writeFileBytes: (path, bytes) => manager.writeFileBytes(path, bytes),
    // VaultManager has no exists() — a successful read is the existence check.
    exists: async (path) => {
      try {
        await manager.readFile(path);
        return true;
      } catch {
        return false;
      }
    },
  };
}
