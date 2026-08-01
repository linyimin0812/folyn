/**
 * Pure path-normalization helper for AiPanel's clickable-path feature.
 *
 * The AI often quotes absolute paths (`/Users/.../apps/desktop/src/foo.ts`)
 * even when the file lives inside the active vault. Without normalization,
 * `editorIoService.openFile` would route such a path as `ext:` (external),
 * opening a duplicate tab next to an existing vault-relative tab.
 *
 * `normalizeVaultPath` strips the vault's `basePath` prefix from an external
 * path when the path is inside the vault; otherwise it leaves the path alone
 * (true external paths stay external).
 */

import { isExternalPath } from '@/utils/isExternalPath';

interface VaultLike {
  basePath: string;
}

/** Normalize an external path to vault-relative when it lives inside the
 *  active vault. Returns the input unchanged for non-external paths or
 *  when there's no active vault. */
export function normalizeVaultPath(raw: string, vault: VaultLike | null | undefined): string {
  if (!vault || !isExternalPath(raw)) return raw;
  const base = vault.basePath.replace(/\/+$/, '');
  if (raw === base || raw.startsWith(base + '/')) {
    return raw.slice(base.length).replace(/^\/+/, '');
  }
  return raw;
}
