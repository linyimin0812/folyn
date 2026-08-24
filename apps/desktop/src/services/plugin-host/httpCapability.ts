/**
 * Host-mediated HTTP capability for trusted-tier plugins.
 *
 * Single chokepoint: `http.fetch` wraps the Rust `plugin_http_fetch` command,
 * which uses `reqwest` (no webview CSP applies). The JS-side `isOriginAllowed`
 * fast-fails before the IPC hop; Rust re-checks against the on-disk manifest
 * `permissions.http.origins` as defense-in-depth.
 *
 * ponytail: no new HTTP path. Same Rust command the rpcBridge uses for
 * sandbox plugins — trusted tier just calls it directly via `invoke` with
 * its own plugin id. Return shape mirrors rpcBridge `http:fetch` so the
 * plugin sees one consistent contract.
 */

import type {
  PluginHttpCapability,
  PluginHttpInit,
  PluginHttpResponse,
  PluginManifest,
} from '@mochi/plugin-host';
import { isOriginAllowed, normalizeHeaders } from './rpcBridge';

function assertHttpPermission(manifest: PluginManifest, url: string): void {
  const origins = manifest.permissions?.http?.origins;
  if (!origins || !isOriginAllowed(url, origins)) {
    throw new Error(
      `plugin "${manifest.id}" lacks permissions.http.origins for ${url} — add the origin to manifest.json`,
    );
  }
}

export function buildPluginHttp(manifest: PluginManifest): PluginHttpCapability {
  return {
    async fetch(url: string, init?: PluginHttpInit): Promise<PluginHttpResponse> {
      assertHttpPermission(manifest, url);
      const { invoke } = await import('@tauri-apps/api/core');
      const resp = await invoke<{ status: number; headers: Record<string, string>; body: string }>(
        'plugin_http_fetch',
        {
          pluginId: manifest.id,
          url,
          method: typeof init?.method === 'string' ? init.method : undefined,
          headers: normalizeHeaders(init?.headers),
          body: typeof init?.body === 'string' ? init.body : undefined,
        },
      );
      return { status: resp.status, headers: resp.headers, body: resp.body };
    },
  };
}
