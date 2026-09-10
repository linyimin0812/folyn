/**
 * Module-scope ExtensionApi holder. The host calls the module's `activate(api)`
 * before any file-type handler renders; handlers read the captured api to
 * access host capabilities (here: `vault.readBinary` for file bytes).
 */
import type { ExtensionApi } from 'folyn-plugin-sdk';

let api: ExtensionApi | undefined;

export function setApi(next: ExtensionApi): void {
  api = next;
}

export function getApi(): ExtensionApi {
  if (!api) throw new Error('[file-viewer] ExtensionApi not ready — activate() has not run');
  return api;
}
