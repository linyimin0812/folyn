// useExtensionHostSync — main-window extension-host hydration + live-event
// sync hook. Extracted from App.tsx (split-oversized-p1-files).
//
// Hydrates installed extensions from disk (install + activate per tier) and
// listens for live install/approve/uninstall/state-changed events + the
// tool-window RPC listener. Loaders/hooks are registered at module-eval time
// by registerBuiltinExtensionHost — NOT here.
//
// Spec: hook-guidelines.md (effect cleanup, teardown-races-await guard).

import { useEffect } from 'react';
import { extensionHost } from "@folyn/extension-host";
import { attachToolWindowRpcListener } from '@/services/extension-host/toolWindowRpcListener';
import { isTauri } from '@/utils/platform';

export function useExtensionHostSync() {
  // ── Extension host: register loaders + sync on install/approve/uninstall ──
  // The sandbox loader is the untrusted-tier ExtensionLoader (sandboxed iframe +
  // host RPC). The trusted loader is the in-process ExtensionLoader (blob-URL
  // `import()` + TOFU gate). Sandbox extensions auto-activate on install (their
  // commands appear immediately). Trusted extensions do NOT auto-activate on
  // install — they require `approve_extension` (the explicit TOFU-pin consent,
  // surfaced as the `extension://approved` event) before activation. This is the
  // PR3 acceptance: "trusted-tier extensions require explicit approval before
  // loading". Failures are logged and never crash the main app.
  useEffect(() => {
    if (!isTauri()) return;
    let uninstalled: (() => void) | null = null;
    let cancelled = false;

    /** Read a extension manifest from ~/.folyn/extensions/<id>/manifest.json */
    async function readExtensionManifest(id: string): Promise<Record<string, unknown>> {
      const { homeDir, join } = await import('@tauri-apps/api/path');
      const { readTextFile } = await import('@tauri-apps/plugin-fs');
      const home = await homeDir();
      const manifestPath = await join(home, '.folyn', 'extensions', id, 'manifest.json');
      return JSON.parse(await readTextFile(manifestPath)) as Record<string, unknown>;
    }

    (async () => {
      // Loaders are registered at module top-level (see
      // registerBuiltinExtensionHost) — they are app-lifetime singletons, not
      // per-effect disposables.

      // Hydrate from disk: query the Rust side for installed extensions and
      // install + activate each one in the in-memory host.
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        const entries = await invoke<
          Array<{ id: string; name: string; version: string; tier: string; trusted: boolean; enabled: boolean }>
        >('list_extensions');
        for (const entry of entries) {
          if (cancelled) break;
          // ponytail: skip activation when the user disabled the extension in a
          // prior session — the on-disk `enabled` flag is the only state that
          // survives restart (host state is in-memory and reset on launch).
          if (entry.enabled === false) {
            try {
              const manifest = await readExtensionManifest(entry.id);
              // Idempotent: React.StrictMode double-invokes effects in dev,
              // so this runs twice — the 2nd pass would re-install and throw
              // "already installed". Install only when the host doesn't yet
              // have the record (the 1st pass's install is the source of truth).
              if (!extensionHost.get(entry.id)) {
                await extensionHost.install(manifest as never);
              }
            } catch (err: unknown) {
              console.warn(`[App] failed to hydrate disabled extension ${entry.id}:`, err);
            }
            continue;
          }
          try {
            const manifest = await readExtensionManifest(entry.id);
            // Idempotent (see the disabled branch above): skip install on the
            // StrictMode 2nd pass; `activate` below is itself idempotent.
            if (!extensionHost.get(entry.id)) {
              await extensionHost.install(manifest as never);
            }
            // Activate sandbox extensions so their commands appear immediately.
            // Trusted extensions activate only after approval (extension://approved).
            if (manifest.tier === 'sandbox') {
              await extensionHost.activate(manifest.id as string).catch((err: unknown) => {
                console.warn(`[App] failed to activate extension ${entry.id}:`, err);
              });
            } else if (manifest.tier === 'trusted' && entry.trusted) {
              // Already-approved trusted extension (hydrated from a prior
              // session) — activate it now.
              await extensionHost.activate(manifest.id as string).catch((err: unknown) => {
                console.warn(`[App] failed to activate trusted extension ${entry.id}:`, err);
              });
            }
          } catch (err: unknown) {
            console.warn(`[App] failed to hydrate extension ${entry.id}:`, err);
          }
        }
      } catch (err: unknown) {
        console.warn('[App] extension hydration failed:', err);
      }

      // Listen for live install/approve/uninstall events.
      const { listen } = await import('@tauri-apps/api/event');
      const unInstall = await listen<{ id: string; trusted?: boolean; tier?: string }>('extension://installed', async (event) => {
        try {
          // Re-install (update): if the host already has a record, tear it
          // down first (deactivate + drop) so the FRESH manifest + bundle from
          // disk take effect — otherwise the host keeps the stale activation
          // (e.g. an old :::carousel template) and the slash menu / preview
          // keep using it. (Boot hydration also installs, but that path is
          // guarded separately against StrictMode double-invoke.)
          if (extensionHost.get(event.payload.id)) {
            await extensionHost.uninstall(event.payload.id);
          }
          const manifest = await readExtensionManifest(event.payload.id) as {
            id: string; tier: 'sandbox' | 'trusted';
          };
          await extensionHost.install(manifest as never);
          // Sandbox: activate immediately. Trusted: only if already approved
          // (Rust re-install resets `trusted` to false → re-TOFU required).
          if (manifest.tier === 'sandbox') {
            await extensionHost.activate(manifest.id).catch(() => {});
          } else if (manifest.tier === 'trusted' && event.payload.trusted) {
            await extensionHost.activate(manifest.id).catch(() => {});
          }
        } catch (err: unknown) {
          console.warn(`[App] failed to install extension on event:`, err);
        } finally {
          // Refresh any open Settings tab so the new row appears even when
          // the install originated from another window (or the caller's
          // refresh raced the host install above).
          try {
            const { useExtensionStore } = await import('@/store/extensionStore');
            await useExtensionStore.getState().refresh();
          } catch { /* non-fatal */ }
        }
      });
      const unApprove = await listen<{ id: string }>('extension://approved', async (event) => {
        try {
          // The extension was already installed on the `extension://installed`
          // event; just activate it now that the user has approved.
          await extensionHost.activate(event.payload.id).catch((err: unknown) => {
            console.warn(`[App] failed to activate approved extension ${event.payload.id}:`, err);
          });
        } catch (err: unknown) {
          console.warn(`[App] failed to approve extension on event:`, err);
        } finally {
          // Approval flips the trusted flag + activation state — refresh so
          // open Settings tabs (Extensions + Containers gallery) reflect it
          // (the Containers gallery re-reads ContainerRegistry.getAll() on
          // rows change, so newly-registered carousel/slide appear here too).
          try {
            const { useExtensionStore } = await import('@/store/extensionStore');
            await useExtensionStore.getState().refresh();
          } catch { /* non-fatal */ }
        }
      });
      const unUninstall = await listen<{ id: string }>('extension://uninstalled', async (event) => {
        try {
          await extensionHost.uninstall(event.payload.id);
        } catch (err: unknown) {
          console.warn(`[App] failed to uninstall extension on event:`, err);
        }
      });
      // Persisted enabled-state flips from another tab — refresh so every open
      // Settings tab reflects the toggle. The activate/deactivate itself runs
      // in the originating tab; this listener just re-reads the on-disk flag.
      const unEnabled = await listen<{ id: string }>('extension://state-changed', async () => {
        try {
          const { useExtensionStore } = await import('@/store/extensionStore');
          await useExtensionStore.getState().refresh();
        } catch (err: unknown) {
          console.warn(`[App] failed to refresh on extension state change:`, err);
        }
      });

      // Fetch-RPC listener: routes `folyn-extension://.../rpc` POSTs from tool
      // windows back through the shared `dispatchExtensionRpc` so the same
      // permission checks / path resolution apply as the iframe bridge.
      const unRpc = await attachToolWindowRpcListener();

      if (cancelled) {
        unInstall();
        unApprove();
        unUninstall();
        unEnabled();
        unRpc();
      } else {
        uninstalled = () => {
          unInstall();
          unApprove();
          unUninstall();
          unEnabled();
          unRpc();
        };
      }
    })();

    return () => {
      cancelled = true;
      uninstalled?.();
    };
  }, []);
}
