import type { ExtensionApi } from 'folyn-extension-sdk';

let api: ExtensionApi | null = null;
let extensionId = '';

export function setApi(a: ExtensionApi): void { api = a; }
export function getApi(): ExtensionApi {
  if (!api) throw new Error('dbml extension: api not set (activate not called)');
  return api;
}
export function setExtensionId(id: string): void { extensionId = id; }
export function getExtensionId(): string { return extensionId; }
