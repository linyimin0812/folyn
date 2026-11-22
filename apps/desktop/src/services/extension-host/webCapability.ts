/**
 * Web capability (`api.web`): the public web for trusted extensions that
 * declare `permissions.web`. Rust `extension_web_fetch` / `extension_web_render`
 * refuse private/local destinations, pin DNS, re-check redirects and cap sizes;
 * they also re-check the grant against the on-disk manifest.
 *
 * Render jobs (and image fetches that may fall back to rendering) carry a
 * request id, so pending work is cancelled when the extension deactivates.
 */
import type { ExtensionManifest, ExtensionWebResponse, WebApi } from 'folyn-extension-sdk';
import { invoke } from '@tauri-apps/api/core';

/** `api.web` plus its teardown. */
export interface WebCapability extends WebApi {
  dispose(): void;
}

export function buildExtensionWeb(manifest: ExtensionManifest): WebCapability {
  const grants = manifest.tier === 'trusted' ? manifest.permissions?.web : undefined;
  const pending = new Set<string>();
  let closed = false;

  const denied = (grant: string) =>
    new Error(`extension "${manifest.id}" lacks permissions.web.${grant} — add it to manifest.json`);

  /** Run a host call tracked by request id; reject results that land after teardown. */
  async function tracked<T>(requestId: string | null, call: () => Promise<T>): Promise<T> {
    if (closed) throw new Error('Extension is inactive');
    if (requestId) pending.add(requestId);
    try {
      const result = await call();
      if (closed) throw new Error('Extension is inactive');
      return result;
    } finally {
      if (requestId) pending.delete(requestId);
    }
  }

  return {
    fetch(url, opts) {
      if (grants?.fetch !== true) return Promise.reject(denied('fetch'));
      const binary = opts?.binary === true;
      // A binary fetch may fall back to the isolated browser — only with the
      // render grant, and then it is cancellable like a render.
      const requestId = binary && grants.render === true ? crypto.randomUUID() : null;
      return tracked(requestId, () =>
        invoke<ExtensionWebResponse>('extension_web_fetch', { extensionId: manifest.id, url, binary, requestId }),
      );
    },
    ...(grants?.render === true
      ? {
          render(url: string) {
            const requestId = crypto.randomUUID();
            return tracked(requestId, () =>
              invoke<ExtensionWebResponse>('extension_web_render', { extensionId: manifest.id, requestId, url }),
            );
          },
        }
      : {}),
    dispose() {
      closed = true;
      const ids = [...pending];
      pending.clear();
      for (let i = 0; i < ids.length; i += 32) {
        void invoke('extension_web_cancel_renders', { extensionId: manifest.id, requestIds: ids.slice(i, i + 32) }).catch(() => {});
      }
    },
  };
}
