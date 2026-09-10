/**
 * Fetch-RPC listener for tool windows.
 *
 * When a sandbox tool window POSTs to `folyn-extension://localhost/<id>/rpc`,
 * the Rust URI handler (extension_commands.rs) emits a `extension-rpc-request`
 * event with `{ requestId, extensionId, body }` where `body` is the raw POST
 * JSON string (`{ method, params }`). This listener (wired once at app boot
 * in App.tsx):
 *   1. Parses `body` into `{ method, params }`.
 *   2. Looks up the extension manifest from the in-memory ExtensionHost.
 *   3. Dispatches via the shared `dispatchExtensionRpc` (same code path as
 *      the iframe postMessage bridge — same permission checks, same path
 *      resolution).
 *   4. Calls the Rust `extension_rpc_respond` command with `{ requestId,
 *      result }` or `{ requestId, error }` so the URI handler can complete
 *      the fetch response.
 *
 * Why event round-trip instead of a direct Tauri command: the extension's HTML
 * runs in a separate WebviewWindow whose origin (`folyn-extension://localhost`)
 * is not the main app's origin, and we deliberately don't inject Tauri APIs
 * into extension webviews (utools-style isolation). `fetch()` to the
 * `folyn-extension://` scheme is the only bridge; Rust mediates.
 */

import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import type { ExtensionManifest } from '@folyn/extension-host';
import { dispatchExtensionRpc } from './rpcBridge';

export interface ExtensionRpcRequest {
  requestId: string;
  extensionId: string;
  body: string;
}

/** Resolve `~/.folyn/extensions/<extensionId>/<rel>` via Tauri path APIs. */
async function defaultResolvePath(
  extensionId: string,
  relativePath: string,
): Promise<string> {
  const { homeDir, join } = await import('@tauri-apps/api/path');
  const home = await homeDir();
  return join(home, '.folyn', 'extensions', extensionId, relativePath);
}

/**
 * Look up the live manifest for `extensionId` from the in-memory ExtensionHost.
 * Returns `undefined` if the extension is not installed or not active — caller
 * (the listener) rejects the RPC in that case.
 */
async function lookupManifest(extensionId: string): Promise<ExtensionManifest | undefined> {
  const { extensionHost } = await import("@folyn/extension-host");
  const record = extensionHost.get(extensionId);
  return record?.manifest;
}

/**
 * Wire the `extension-rpc-request` listener. Returns an `UnlistenFn` to detach.
 * Safe to call once per app session; calling it again before unlistening
 * will double-dispatch every request.
 */
export async function attachToolWindowRpcListener(): Promise<UnlistenFn> {
  return listen<ExtensionRpcRequest>('extension-rpc-request', async (event) => {
    const { requestId, extensionId, body } = event.payload;
    let method: string;
    let params: unknown;
    try {
      const parsed = JSON.parse(body) as { method?: string; params?: unknown };
      method = parsed.method ?? '';
      params = parsed.params;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await invoke('extension_rpc_respond', {
        requestId,
        error: `invalid rpc body: ${message}`,
      });
      return;
    }
    try {
      const manifest = await lookupManifest(extensionId);
      if (!manifest) {
        await invoke('extension_rpc_respond', {
          requestId,
          error: `extension not installed: ${extensionId}`,
        });
        return;
      }
      const result = await dispatchExtensionRpc(
        manifest,
        extensionId,
        method,
        params,
        (rel) => defaultResolvePath(extensionId, rel),
      );
      await invoke('extension_rpc_respond', { requestId, result: result ?? null });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await invoke('extension_rpc_respond', { requestId, error: message });
    }
  });
}
