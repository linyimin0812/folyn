/**
 * Module-scope ExtensionApi + id holder. The host calls the module's
 * `activate(api, ctx)` before any file-type handler renders; handlers read the
 * captured api to access host capabilities (here: `vault.readBinary` for file
 * bytes) and the extension id (to build the plugin-origin iframe URL).
 */
import type { ExtensionApi } from 'folyn-plugin-sdk';

let api: ExtensionApi | undefined;
let extensionId = '';

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
