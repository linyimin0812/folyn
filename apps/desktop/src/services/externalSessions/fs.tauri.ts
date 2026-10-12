/**
 * Tauri adapters for the external-session service ports.
 *
 * - `tauriSessionFs`: reads local Codex rollout and Claude Code transcript
 *   files through `@tauri-apps/plugin-fs` (read-only — never writes, resumes
 *   or migrates source sessions). `readLines` streams chunks through ONE
 *   `open()`ed FileHandle (line+2MB-byte budget) and closes it explicitly —
 *   `readTextFileLines`' iterator has no `return()`, so breaking early leaked
 *   the Rust-side file handle (FD exhaustion after ~256 files). Satisfies both
 *   `CodexSessionFs` and `ClaudeSessionFs` (the superset with `mtime`).
 * - `vaultCapturePort`: binds the CURRENT VaultManager at bind time — the
 *   write goes to the vault the user confirmed, even if the app switches
 *   vaults mid-save. Binary asset writes go through `writeFileBytes`
 *   (byte-identical round-trip).
 *
 * Thin pass-throughs (no unit tests — mirrors versionHistoryFs.tauri.ts).
 */
import { exists, open, readDir, readTextFile, stat } from '@tauri-apps/plugin-fs';
import { useVaultStore } from '@/store/vaultStore';
import type { ClaudeSessionFs } from './claudeSessions';
import type { CodexSessionFs } from './codexSessions';
import type { CaptureWritePort } from './captureService';

/** Head-read byte cap. Real transcripts carry multi-100KB JSONL records (the
 * first typed prompt can sit ~90KB in), so 64KB was too tight — 2MB covers
 * every adapter's HEAD_LINES (≤ 80) with room to spare. Bytes past the cap
 * are a truncated final line, dropped honestly. */
const HEAD_BYTES = 2 * 1024 * 1024;
const CHUNK_BYTES = 64 * 1024;

export const tauriSessionFs: ClaudeSessionFs = {
  readLines: async (path, maxLines) => {
    const fh = await open(path); // read-only by default
    try {
      const decoder = new TextDecoder('utf-8');
      const chunk = new Uint8Array(CHUNK_BYTES);
      const lines: string[] = [];
      let pending = ''; // partial line carried across chunks
      let total = 0;
      let capCut = false;
      for (;;) {
        const nread = await fh.read(chunk);
        if (nread == null || nread === 0) break; // EOF
        let take = nread;
        if (total + nread > HEAD_BYTES) {
          take = HEAD_BYTES - total; // stop exactly at the byte cap
          capCut = true;
        }
        total += take;
        // stream: true carries a multi-byte sequence split across chunks
        pending += decoder.decode(chunk.subarray(0, take), { stream: !capCut });
        let start = 0;
        for (;;) {
          const nl = pending.indexOf('\n', start);
          if (nl === -1) break;
          lines.push(pending.slice(start, nl).replace(/\r$/, ''));
          start = nl + 1;
          if (lines.length >= maxLines) return lines; // finally still closes
        }
        pending = pending.slice(start);
        if (capCut) break;
      }
      if (!capCut) {
        pending += decoder.decode(); // flush a split multi-byte tail at EOF
        if (pending !== '') lines.push(pending.replace(/\r$/, ''));
      }
      return lines; // capCut: the trailing partial line is dropped, not guessed
    } finally {
      await fh.close(); // always released, even when maxLines stops early
    }
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
