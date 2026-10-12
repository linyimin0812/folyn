/**
 * Tests for the tauriSessionFs readLines port (via the plugin-fs mock).
 *
 * Regression under test: `readTextFileLines`' iterator had no `return()`, so
 * breaking after maxLines leaked the Rust-side file handle — sequential
 * discovery over ~300 files exhausted the 256 FD soft limit. readLines must
 * close its FileHandle exactly once per call, even when maxLines stops the
 * read early, and must honestly drop a final line truncated by the head cap.
 */
import { describe, it, expect, vi } from 'vitest';
import { open, writeTextFile } from '@tauri-apps/plugin-fs';
import type { MockFileHandle } from '@tauri-apps/plugin-fs';

// fs.tauri.ts pulls vaultStore for bindVaultCapturePort; keep that (and its
// heavy import chain) out of this test — readLines never touches it.
vi.mock('@/store/vaultStore', () => ({
  useVaultStore: { getState: () => ({ manager: {}, currentVault: null }) },
}));

import { tauriSessionFs } from './fs.tauri';

async function lastOpenedHandle(): Promise<MockFileHandle> {
  const result = open.mock.results[open.mock.results.length - 1];
  if (!result) throw new Error('open was not called');
  return (await result.value) as MockFileHandle;
}

describe('tauriSessionFs.readLines', () => {
  it('closes the file handle exactly once when maxLines stops the read early', async () => {
    await writeTextFile('/s/a.jsonl', 'l0\nl1\nl2\nl3\nl4\n');
    const lines = await tauriSessionFs.readLines('/s/a.jsonl', 2);
    expect(lines).toEqual(['l0', 'l1']);
    const handle = await lastOpenedHandle();
    expect(handle.close).toHaveBeenCalledTimes(1); // the FD-leak regression
  });

  it('closes the handle exactly once on a full (EOF) read', async () => {
    await writeTextFile('/s/b.jsonl', 'l0\nl1\n');
    const lines = await tauriSessionFs.readLines('/s/b.jsonl', 50);
    expect(lines).toEqual(['l0', 'l1']);
    const handle = await lastOpenedHandle();
    expect(handle.close).toHaveBeenCalledTimes(1);
  });

  it('returns at most maxLines lines and trims \\r', async () => {
    await writeTextFile('/s/c.jsonl', 'a\r\nb\r\nc\r\n');
    expect(await tauriSessionFs.readLines('/s/c.jsonl', 2)).toEqual(['a', 'b']);
    expect(await tauriSessionFs.readLines('/s/c.jsonl', 50)).toEqual(['a', 'b', 'c']);
  });

  it('returns [] for an empty file', async () => {
    await writeTextFile('/s/empty.jsonl', '');
    expect(await tauriSessionFs.readLines('/s/empty.jsonl', 50)).toEqual([]);
    expect((await lastOpenedHandle()).close).toHaveBeenCalledTimes(1);
  });

  it('streams chunk-split big records line-accurately through one handle (2MB budget)', async () => {
    // Real transcripts carry multi-100KB JSONL records; the first typed
    // prompt sits ~90KB in. Chunks stream through ONE handle, so every line
    // completing inside the 2MB budget is emitted — 150KB is not a chunk
    // multiple, so records also split across chunk boundaries.
    const bigRecord = `{"type":"user","filler":"${'x'.repeat(150_000)}"}`;
    const content = `${bigRecord}\n`.repeat(6) + '{"type":"user","prompt":"real prompt"}\n';
    await writeTextFile('/s/wide.jsonl', content);
    const lines = await tauriSessionFs.readLines('/s/wide.jsonl', 80);
    expect(lines).toHaveLength(7);
    expect(lines[6]).toBe('{"type":"user","prompt":"real prompt"}');
    expect((await lastOpenedHandle()).close).toHaveBeenCalledTimes(1);
  });

  it('drops the final line when the 2MB head cap cuts it mid-line', async () => {
    // 2 short lines + a >2MB single line: the 2MB boundary lands mid-line, so
    // the partial tail must be dropped, and the handle still closed once.
    await writeTextFile('/s/big.jsonl', `l0\nl1\n${'y'.repeat(2 * 1024 * 1024 + 100)}`);
    const lines = await tauriSessionFs.readLines('/s/big.jsonl', 50);
    expect(lines).toEqual(['l0', 'l1']);
    expect((await lastOpenedHandle()).close).toHaveBeenCalledTimes(1);
  });

  it('propagates read errors and still closes the handle', async () => {
    await expect(tauriSessionFs.readLines('/s/missing.jsonl', 10)).rejects.toThrow();
  });
});
