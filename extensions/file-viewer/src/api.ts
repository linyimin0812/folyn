/**
 * Module-scope ExtensionApi + id holder. The host calls the module's
 * `activate(api, ctx)` before any file-type handler renders; handlers read the
 * captured api to access host capabilities (here: `vault.readBinary` for file
 * bytes) and the extension id (to build the extension-origin iframe URL).
 */
import type { ExtensionApi } from 'folyn-extension-sdk';

let api: ExtensionApi | undefined;
let extensionId = '';
let resolveAssetUrl: ((file: string) => string) | undefined;

export function setApi(next: ExtensionApi): void {
  api = next;
}

export function getApi(): ExtensionApi {
  if (!api) throw new Error('[file-viewer] ExtensionApi not ready — activate() has not run');
  return api;
}

export function setExtensionId(id: string): void {
  extensionId = id;
}

export function getExtensionId(): string {
  return extensionId;
}

/** Capture the host-injected `ctx.resolveAssetUrl` at activate time so
 *  {@link OfficeFrame} can build a platform-correct iframe `src` into this
 *  extension's own origin. The raw `folyn-extension://localhost/<id>/<file>`
 *  form is only navigable on macOS/Linux; on Windows/Android WebView2 the
 *  host rewrites it to `http://folyn-extension.localhost/<id>/<file>`. */
export function setResolveAssetUrl(fn: (file: string) => string): void {
  resolveAssetUrl = fn;
}

export function resolveExtensionAssetUrl(file: string): string {
  if (!resolveAssetUrl) throw new Error('[file-viewer] ctx.resolveAssetUrl not ready — activate() has not run');
  return resolveAssetUrl(file);
}
