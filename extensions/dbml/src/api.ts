import type { ExtensionApi } from 'folyn-extension-sdk';

let api: ExtensionApi | null = null;
let extensionId = '';
let resolveAssetUrl: ((file: string) => string) | null = null;

export function setApi(a: ExtensionApi): void { api = a; }
export function getApi(): ExtensionApi {
  if (!api) throw new Error('dbml extension: api not set (activate not called)');
  return api;
}
export function setExtensionId(id: string): void { extensionId = id; }
export function getExtensionId(): string { return extensionId; }

/** Capture the host-injected `ctx.resolveAssetUrl` at activate time so the
 *  preview iframe (and the offscreen export iframe) can build a
 *  platform-correct `src` into this extension's own origin. The raw
 *  `folyn-extension://localhost/<id>/<file>` form is only navigable on
 *  macOS/Linux; on Windows/Android WebView2 the host rewrites it to
 *  `http://folyn-extension.localhost/<id>/<file>`. */
export function setResolveAssetUrl(fn: (file: string) => string): void {
  resolveAssetUrl = fn;
}
export function resolveExtensionAssetUrl(file: string): string {
  if (!resolveAssetUrl) throw new Error('dbml extension: ctx.resolveAssetUrl not set (activate not called)');
  return resolveAssetUrl(file);
}
