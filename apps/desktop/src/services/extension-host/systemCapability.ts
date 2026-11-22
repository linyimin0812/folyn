/**
 * System capability: facts about the user's desktop that need native code to
 * read, each gated by the extension's own `permissions.system` declaration
 * (listed in the consent dialog). The check here fast-fails before the IPC
 * hop; Rust `extension_front_window` re-checks the on-disk manifest.
 */

import type { ExtensionFrontWindow, ExtensionManifest, SystemApi } from '@folyn/extension-host';

export function buildExtensionSystem(manifest: ExtensionManifest): SystemApi {
  return {
    async frontWindow() {
      if (manifest.permissions?.system?.frontWindow !== true) {
        throw new Error(
          `extension "${manifest.id}" lacks permissions.system.frontWindow — add it to manifest.json`,
        );
      }
      const { invoke } = await import('@tauri-apps/api/core');
      return invoke<ExtensionFrontWindow | null>('extension_front_window', { extensionId: manifest.id });
    },
  };
}
