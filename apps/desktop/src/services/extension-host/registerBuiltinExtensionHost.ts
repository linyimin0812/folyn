// registerBuiltinExtensionHost — app-startup registrar that wires the
// extension-host's API/context hooks and its two loaders (sandbox iframe +
// trusted in-process). Extracted from App.tsx module top-level
// (split-oversized-p1-files). Must run once at module-eval time, before any
// extension activation.
//
// Spec: directory-structure.md (register*.ts registrar convention).

import { extensionHost } from "@folyn/extension-host";
import type { ToolExtensionUIContext } from '@folyn/extension-host';
import { createExtensionApi } from './createExtensionApi';
import { extensionAssetUrl } from './extensionUrl';
import { workspaceApi } from '@/services/workspaceRegistry';
import { sandboxLoader } from './sandboxLoader';
import { trustedLoader } from './trustedLoader';

export function registerBuiltinExtensionHost() {
  // ponytail: register extension loaders ONCE at module top-level, NOT inside the
  // extension-host useEffect. React StrictMode (dev) mounts effects twice; both
  // mounts share the SAME `sandboxLoader`/`trustedLoader` module singletons, so
  // mount #1's cleanup disposing its `registerLoader` handle wipes the entry
  // mount #2 registered (dispose checks `loaders.get(tier) === loader` — true
  // for the shared singleton). The result: after StrictMode settles, the
  // loaders map is empty and `extensionHost.activate(id)` throws
  // "No loader registered for tier: sandbox". App-lifetime singletons don't
  // need disposal — they live for the whole session.
  // Phase 2: wire the real capability surface into the new runtime so
  // `module.activate(api, ctx)` gets ai/network/env/export/fileTypes/exporters
  // + `ctx.ui.workspace` instead of `undefined`.
  extensionHost.setHooks({
    createApi: (record) => createExtensionApi(record.manifest),
    createContext: (record) => ({
      extensionId: record.manifest.id,
      extensionPath: record.manifest.main,
      manifest: record.manifest,
      vault: { name: 'default', path: 'default' },
      ui: {
        // Real Tauri dialogs, gated on permissions.dialog (matches the other
        // capability grants). window.confirm fallback covers non-Tauri (tests,
        // browser dev) where the plugin import rejects.
        dialogs: {
          async info(message: string) {
            if (!record.manifest.permissions?.dialog) {
              throw new Error(`extension "${record.manifest.id}" lacks permissions.dialog — call refused`);
            }
            try {
              const { message: showMessage } = await import('@tauri-apps/plugin-dialog');
              await showMessage(message, { kind: 'info' });
            } catch {
              window.alert(message);
            }
          },
          async confirm(message: string) {
            if (!record.manifest.permissions?.dialog) {
              throw new Error(`extension "${record.manifest.id}" lacks permissions.dialog — call refused`);
            }
            try {
              const { confirm } = await import('@tauri-apps/plugin-dialog');
              return await confirm(message, { kind: 'warning' });
            } catch {
              return window.confirm(message);
            }
          },
        },
        notifications: { show() {} },
        workspace: workspaceApi,
      } as ToolExtensionUIContext,
      logger: console,
      // Mirrors Tauri's runtime convertFileSrc rule (tauri/scripts/core.js):
      // Windows/Android serve a registered custom scheme under
      // `${protocolScheme}://${scheme}.localhost`, and the raw `scheme://`
      // form is NOT navigable as a top-level document there (Tauri/wry does
      // not call CoreWebView2CustomSchemeRegistration — tauri-apps/tauri#10667).
      // Same rule as the sandbox-loader / tool-panel iframes — one helper
      // (extensionUrl.ts) owns it.
      resolveAssetUrl: (file) => extensionAssetUrl(record.manifest.id, file),
    }),
  });

  extensionHost.registerLoader(sandboxLoader);
  extensionHost.registerLoader(trustedLoader);
}
