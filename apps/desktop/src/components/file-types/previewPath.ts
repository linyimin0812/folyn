/**
 * Preview-path resolution shared by the file-type handlers.

The handlers receive `filePath` + `vaultRoot` (see `PreviewProps`) and resolve
the file's on-disk absolute path to read its bytes / build an asset URL. The
legacy resolution is `join(resolveBasePath(vaultRoot), filePath)` — correct for
vault-relative paths, but **wrong for external files**, whose `filePath` is
already an absolute path (`/Users/…`, `~/…`, `$HOME/…`): joining it under
`vaultRoot` produces a corrupted path (`/vault-root//Users/…`).

`resolvePreviewPath(filePath, vaultRoot)` is the single front door: external
paths are resolved to their true absolute location; vault-relative paths are
joined under the vault root as before. Handlers that read the file (image,
office) and those that resolve embedded asset references (markdown, markmap) both
route through it.

`resolveAssetRef(ref, filePath, vaultRoot)` resolves a *relative* reference
found inside a file's content (e.g. `![](img.png)` in markdown) against the
file's own directory — so an external markdown file at `~/Docs/a.md` with
`![](pic.png)` resolves to `~/Docs/pic.png`, not `~/vault/pic.png`.
*/

import { isExternalPath } from '@/utils/isExternalPath';
import { resolveBasePath } from '@/utils/pathResolver';
import { resolveAbsolutePath } from '@/services/externalFileProvider';

/**
 * Resolve a file's own on-disk absolute path from its (possibly external)
 * `filePath` and the active vault root. External paths bypass the vault join.
 */
export async function resolvePreviewPath(filePath: string, vaultRoot: string): Promise<string> {
  if (isExternalPath(filePath)) {
    // External: resolve ~ / $HOME; absolute paths pass through unchanged.
    return resolveAbsolutePath(filePath);
  }
  const base = await resolveBasePath(vaultRoot);
  const { join } = await import('@tauri-apps/api/path');
  return join(base, filePath);
}

/**
 * The directory of `filePath` on disk — the base a relative asset reference
 * (e.g. `![](pic.png)` in markdown) should be resolved against.
 *
 * For an external file, that's the file's own directory. For a vault-relative
 * file, that's `<vaultRoot>/<fileDir>` (the legacy behaviour embedded in
 * MarkdownPreview).
 */
export async function resolveAssetBase(filePath: string, vaultRoot: string): Promise<string> {
  if (isExternalPath(filePath)) {
    const abs = await resolvePreviewPath(filePath, vaultRoot);
    const idx = Math.max(abs.lastIndexOf('/'), abs.lastIndexOf('\\'));
    return idx > 0 ? abs.substring(0, idx) : abs;
  }
  const base = await resolveBasePath(vaultRoot);
  const { join } = await import('@tauri-apps/api/path');
  const fileDir = (filePath.includes('/') || filePath.includes('\\')) ? filePath.substring(0, Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'))) : '';
  return fileDir ? join(base, fileDir) : base;
}
