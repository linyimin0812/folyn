/**
 * Host-mediated HTTP capability for trusted-tier extensions.
 *
 * Single chokepoint: `http.fetch` wraps the Rust `extension_http_fetch` command,
 * which uses `reqwest` (no webview CSP applies). The JS-side `isOriginAllowed`
 * fast-fails before the IPC hop; Rust re-checks against the on-disk manifest
 * `permissions.http.origins` as defense-in-depth.
 *
 * ponytail: no new HTTP path. Same Rust command the rpcBridge uses for
 * sandbox extensions — trusted tier just calls it directly via `invoke` with
 * its own extension id. Return shape mirrors rpcBridge `http:fetch` so the
 * extension sees one consistent contract.
 */

import type {
  ExtensionDownloadResult,
  ExtensionHttpCapability,
  ExtensionHttpInit,
  ExtensionHttpResponse,
  ExtensionManifest,
} from '@folyn/extension-host';
import { isOriginAllowed, normalizeHeaders } from './rpcBridge';

function assertHttpPermission(manifest: ExtensionManifest, url: string): void {
  const origins = manifest.permissions?.http?.origins;
  if (!origins || !isOriginAllowed(url, origins)) {
    throw new Error(
      `extension "${manifest.id}" lacks permissions.http.origins for ${url} — add the origin to manifest.json`,
    );
  }
}

export function buildExtensionHttp(manifest: ExtensionManifest): ExtensionHttpCapability {
  return {
    async fetch(url: string, init?: ExtensionHttpInit): Promise<ExtensionHttpResponse> {
      assertHttpPermission(manifest, url);
      const { invoke } = await import('@tauri-apps/api/core');
      const resp = await invoke<{ status: number; headers: Record<string, string>; body: string }>(
        'extension_http_fetch',
        {
          extensionId: manifest.id,
          url,
          method: typeof init?.method === 'string' ? init.method : undefined,
          headers: normalizeHeaders(init?.headers),
          body: typeof init?.body === 'string' ? init.body : undefined,
        },
      );
      return { status: resp.status, headers: resp.headers, body: resp.body };
    },
    async download(url, init) {
      assertHttpPermission(manifest, url);
      const { invoke, Channel } = await import('@tauri-apps/api/core');
      // Rust streams the body to disk and reports each chunk here; the file
      // itself never crosses IPC.
      const onProgress = new Channel<{ received: number; total?: number }>();
      if (init?.onProgress) {
        const report = init.onProgress;
        onProgress.onmessage = (progress) => report(progress);
      }
      return invoke<ExtensionDownloadResult>('extension_http_download', {
        extensionId: manifest.id,
        url,
        method: typeof init?.method === 'string' ? init.method : undefined,
        headers: normalizeHeaders(init?.headers),
        body: typeof init?.body === 'string' ? init.body : undefined,
        onProgress,
      });
    },
  };
}
