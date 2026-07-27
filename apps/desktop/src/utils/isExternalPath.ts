/**
 * External-path detection.

Quill's file model is vault-relative: `editorIoService.openFile(path)` reads
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
 * External files are constrained to the user's `$HOME` for now (decision: ship
 * home-only first; the fs scope already grants `$HOME/**`, so no Tauri scope
 * change is needed). Paths outside home are rejected with a clear error rather
 * than silently failing on a scope-denied read.
 */
export async function isWithinHome(absPath: string): Promise<boolean> {
  const { homeDir } = await import('@tauri-apps/api/path');
  const home = (await homeDir()).replace(/\/+$/, '');
  // Normalise ~ / $HOME for the comparison.
  let p = absPath;
  if (p.startsWith('~/')) p = home + p.slice(1);
  else if (p.startsWith('$HOME/')) p = home + p.slice('$HOME'.length);
  // Also strip a trailing slash.
  p = p.replace(/\/+$/, '');
  return p === home || p.startsWith(home + '/');
}
