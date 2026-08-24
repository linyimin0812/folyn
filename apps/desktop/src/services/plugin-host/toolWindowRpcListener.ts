/**
 * Fetch-RPC listener for tool windows.
 *
 * When a sandbox tool window POSTs to `mochi-plugin://localhost/<id>/rpc`,
 * the Rust URI handler (plugin_commands.rs) emits a `plugin-rpc-request`
 * event with `{ requestId, pluginId, body }` where `body` is the raw POST
 * JSON string (`{ method, params }`). This listener (wired once at app boot
 * in App.tsx):
 *   1. Parses `body` into `{ method, params }`.
 *   2. Looks up the plugin manifest from the in-memory PluginHost.
 *   3. Dispatches via the shared `dispatchPluginRpc` (same code path as
 *      the iframe postMessage bridge — same permission checks, same path
 *      resolution).
 *   4. Calls the Rust `plugin_rpc_respond` command with `{ requestId,
 *      result }` or `{ requestId, error }` so the URI handler can complete
 *      the fetch response.
 *
 * Why event round-trip instead of a direct Tauri command: the plugin's HTML
 * runs in a separate WebviewWindow whose origin (`mochi-plugin://localhost`)
 * is not the main app's origin, and we deliberately don't inject Tauri APIs
 * into plugin webviews (utools-style isolation). `fetch()` to the
 * `mochi-plugin://` scheme is the only bridge; Rust mediates.
 */

import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import type { PluginManifest } from '@mochi/plugin-host';
import { dispatchPluginRpc } from './rpcBridge';

export interface PluginRpcRequest {
  requestId: string;
  pluginId: string;
  body: string;
}

/** Resolve `~/.mochi/plugins/<pluginId>/<rel>` via Tauri path APIs. */
async function defaultResolvePath(
  pluginId: string,
  relativePath: string,
): Promise<string> {
  const { homeDir, join } = await import('@tauri-apps/api/path');
  const home = await homeDir();
  return join(home, '.mochi', 'plugins', pluginId, relativePath);
}

/**
 * Look up the live manifest for `pluginId` from the in-memory PluginHost.
 * Returns `undefined` if the plugin is not installed or not active — caller
 * (the listener) rejects the RPC in that case.
 */
async function lookupManifest(pluginId: string): Promise<PluginManifest | undefined> {
  const { pluginHost } = await import('@mochi/plugin-host');
  const record = pluginHost.get(pluginId);
  return record?.manifest;
}

/**
 * Wire the `plugin-rpc-request` listener. Returns an `UnlistenFn` to detach.
 * Safe to call once per app session; calling it again before unlistening
 * will double-dispatch every request.
 */
export async function attachToolWindowRpcListener(): Promise<UnlistenFn> {
  return listen<PluginRpcRequest>('plugin-rpc-request', async (event) => {
    const { requestId, pluginId, body } = event.payload;
    let method: string;
    let params: unknown;
    try {
      const parsed = JSON.parse(body) as { method?: string; params?: unknown };
      method = parsed.method ?? '';
      params = parsed.params;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await invoke('plugin_rpc_respond', {
        requestId,
        error: `invalid rpc body: ${message}`,
      });
      return;
    }
    try {
      const manifest = await lookupManifest(pluginId);
      if (!manifest) {
        await invoke('plugin_rpc_respond', {
          requestId,
          error: `plugin not installed: ${pluginId}`,
        });
        return;
      }
      const result = await dispatchPluginRpc(
        manifest,
        pluginId,
        method,
        params,
        (rel) => defaultResolvePath(pluginId, rel),
      );
      await invoke('plugin_rpc_respond', { requestId, result: result ?? null });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await invoke('plugin_rpc_respond', { requestId, error: message });
    }
  });
}
