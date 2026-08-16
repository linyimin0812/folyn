/**
 * Storage provider registry. Adding a new provider = import its class
 * + push to the `providers` array. Call sites (`imageUploader.ts`,
 * `useExport.ts`) route through `getProvider(id)` and never change.
 */
import type { StorageProvider, StorageProviderId } from './types';
import { R2Provider } from './providers/r2';
import { QiniuProvider } from './providers/qiniu';
import { OssProvider } from './providers/oss';

const providers: StorageProvider[] = [new R2Provider(), new QiniuProvider(), new OssProvider()];

export function getAllProviders(): readonly StorageProvider[] {
  return providers;
}

export function getProvider(id: StorageProviderId): StorageProvider {
  const p = providers.find((p) => p.id === id);
  if (!p) throw new Error(`Unknown storage provider: ${id}`);
  return p;
}
