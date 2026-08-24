/**
 * External-path detection.

Mochi's file model is vault-relative: `editorIoService.openFile(path)` reads
`path` via `vaultStore.readFile` → `TauriVaultProvider.resolve()`, which does
`join(basePath, path)`. That works for vault-internal relative paths but
*breaks* for an absolute path (it gets joined under basePath) and for a
home-relative path (same problem).

"External file" = a file the user opened from *outside* the vault — picked via
the OS file dialog, dropped onto the window, or handed over by the OS "Open
With" flow. These arrive as real absolute paths (or `~`-prefixed paths), so they
must bypass the vault's `resolve()` and be read/written at their true location.

This module is the single predicate that decides which IO route a path takes:
- `true`  → `externalFileProvider` (direct Tauri fs, no basePath join)
- `false` → `vaultStore` / `wikiProvider` (existing vault-relative routes)

A path is external when it is absolute (Unix `/…` or Windows `C:\…` / `C:/…`)
or home-relative (`~/…`, `$HOME/…`). Vault-internal paths are plain relative
segments like `notes/foo.md` or `__daily__/2026-01-01.md`.
*/

/** True if `p` is an external (absolute / home-relative) path. */
export function isExternalPath(p: string): boolean {
  if (!p) return false;
  // Unix absolute: /Users/…
  if (p.startsWith('/')) return true;
  // Home-relative shorthand: ~/…  and  $HOME/…
  if (p.startsWith('~') || p.startsWith('$HOME')) return true;
  // Windows absolute drive: C:\…  or  C:/…
  if (/^[A-Za-z]:[\\/]/.test(p)) return true;
  return false;
}

/**
 * External files are constrained to the user's `$HOME` by app-level choice (a
 * safety boundary), enforced here with a clear error rather than relying on
 * the Tauri fs scope. The Tauri fs scope itself is broadened to `**` so that
 * vaults can live at arbitrary locations (e.g. `D:\mochi`); this guard keeps
 * files opened *outside* the vault — via the OS file dialog, drag-drop, or the
 * "Open With" flow — confined to home.
 */
export async function isWithinHome(absPath: string): Promise<boolean> {
  const { homeDir } = await import('@tauri-apps/api/path');
  // ponytail: normalize both sides to forward slashes before comparing.
  // On Windows, homeDir() returns `C:\Users\x` (backslashes) while absPath
  // from Tauri fs dialogs also uses backslashes — but `home + '/'` ends with
  // a forward slash, so `p.startsWith(home + '/')` was always false on Windows,
  // rejecting every home-relative file as "outside home". Normalizing to `/`
  // makes the comparison separator-agnostic.
  const home = (await homeDir()).replace(/[/\\]+$/, '');
  const h = home.replace(/\\/g, '/');
  let p = absPath.replace(/\\/g, '/');
  if (p.startsWith('~/')) {
    p = h + p.slice(1);
  } else if (p.startsWith('$HOME/')) {
    p = h + p.slice('$HOME'.length);
  }
  p = p.replace(/[/\\]+$/, '');
  return p === h || p.startsWith(h + '/');
}
