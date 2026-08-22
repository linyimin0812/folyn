/**
 * External-file provider — read/write files at their true absolute location,
 * bypassing the vault's `basePath` join.

The vault provider (`TauriVaultProvider.resolve`) does `join(basePath, path)`,
which is correct for vault-relative paths but corrupts absolute paths. External
files (picked via the OS file dialog, dropped onto the window, or handed over
by the OS "Open With" flow) are real absolute paths, so they are routed here
instead of through `vaultStore.readFile`.

Scope: `$HOME` only by app-level choice (see `isWithinHome`). The Tauri fs scope
is broadened to `**` so vaults can live at arbitrary locations, but files opened
*outside* the vault (OS file dialog, drag-drop, "Open With") are kept confined
to home as a safety boundary, rejected here with a clear error instead of
failing on a scope-denied read.
*/

import { isWithinHome } from '@/utils/isExternalPath';

/**
 * Resolve a `~`- or `$HOME`-prefixed path to an absolute path. Absolute paths
 * are returned unchanged. Used before every fs call so callers can pass either
 * form.
 */
export async function resolveAbsolutePath(p: string): Promise<string> {
  if (p.startsWith('~/') || p === '~') {
    const { homeDir, join } = await import('@tauri-apps/api/path');
    const home = (await homeDir()).replace(/[/\\]+$/, '');
    // ponytail: join() is separator-aware — string concat produced mixed
    // separators on Windows (C:\Users\x/quill/...) failing the fs scope glob.
    return await join(home, p.slice(1));
  }
  if (p.startsWith('$HOME/') || p === '$HOME') {
    const { homeDir, join } = await import('@tauri-apps/api/path');
    const home = (await homeDir()).replace(/[/\\]+$/, '');
    return await join(home, p.slice('$HOME'.length));
  }
  return p;
}

async function assertWithinHome(absPath: string): Promise<void> {
  const ok = await isWithinHome(absPath);
  if (!ok) {
    throw new Error(
      `Cannot open file outside your home directory: ${absPath}\n` +
        `Quill currently limits external files to your home folder ($HOME).`,
    );
  }
}

export const externalFileProvider = {
  /** Read an external file as UTF-8 text. */
  async readFile(rawPath: string): Promise<string> {
    const abs = await resolveAbsolutePath(rawPath);
    await assertWithinHome(abs);
    const { readTextFile } = await import('@tauri-apps/plugin-fs');
    return readTextFile(abs);
  },

  /** Read an external file as raw bytes. Use this (not `readFile`) when the
   *  caller must preserve the exact bytes — binary copies (zip / xlsx /
   *  images / any non-text file) round-trip through `readFile`'s UTF-8
   *  decode/encode and corrupt non-text byte sequences. */
  async readFileBytes(rawPath: string): Promise<Uint8Array> {
    const abs = await resolveAbsolutePath(rawPath);
    await assertWithinHome(abs);
    const { readFile } = await import('@tauri-apps/plugin-fs');
    return readFile(abs);
  },

  /** Write content to an external file (create or overwrite). */
  async writeFile(rawPath: string, content: string): Promise<void> {
    const abs = await resolveAbsolutePath(rawPath);
    await assertWithinHome(abs);
    const { writeTextFile, mkdir, exists } = await import('@tauri-apps/plugin-fs');
    const { dirname } = await import('@tauri-apps/api/path');
    // ponytail: dirname() is separator-aware. lastIndexOf('/') on a Windows
    // backslash path returns -1 → substring(0, -1) === '' → mkdir('') throws
    // "forbidden path:". Mirrors the TauriVaultProvider.writeFile fix.
    const dir = await dirname(abs);
    if (dir && !(await exists(dir))) {
      await mkdir(dir, { recursive: true });
    }
    await writeTextFile(abs, content);
  },

  /** Whether the file exists on disk. */
  async exists(rawPath: string): Promise<boolean> {
    const abs = await resolveAbsolutePath(rawPath);
    const ok = await isWithinHome(abs);
    if (!ok) return false;
    const { exists } = await import('@tauri-apps/plugin-fs');
    return exists(abs);
  },
};
