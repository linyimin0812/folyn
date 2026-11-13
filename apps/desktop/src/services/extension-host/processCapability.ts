/**
 * Process capability: run a local program for a trusted extension.
 *
 * Which programs is the extension's own declaration — `permissions.exec.programs`
 * in its manifest, listed in the consent dialog — not a list kept in the host.
 * The check here fast-fails before the IPC hop; Rust `extension_exec` re-checks
 * the on-disk manifest.
 */

import type { ExtensionExecResult, ExtensionManifest, ProcessApi } from '@folyn/extension-host';

export function buildExtensionProcess(manifest: ExtensionManifest): ProcessApi {
  return {
    async exec(program, args = [], opts) {
      if (!manifest.permissions?.exec?.programs?.includes(program)) {
        throw new Error(
          `extension "${manifest.id}" lacks permissions.exec.programs for "${program}" — add it to manifest.json`,
        );
      }
      const { invoke } = await import('@tauri-apps/api/core');
      return invoke<ExtensionExecResult>('extension_exec', {
        extensionId: manifest.id,
        program,
        args,
        cwd: opts?.cwd ?? null,
      });
    },
  };
}
