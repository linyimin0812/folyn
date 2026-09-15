/**
 * Storage provider registry — the single registry built-in and
 * extension-contributed storage providers register into. The Storage & Sharing
 * settings UI, the image-paste flow, and the markdown→HTML share flow all route
 * through `getAllProviders()` / `getProvider(id)`; a provider that is not
 * registered here is invisible.
 *
 * Built-in R2/Qiniu/OSS providers register at boot via
 * `builtinStorageProviders.ts`; trusted extensions register through the
 * `storageProviderAdapter` contribution point. Both call the same `register`.
 *
 * ponytail: a Map keyed by id, no ownership tracking — contributions
 * themselves stay owned by the adapter's Disposable (which calls `unregister`
 * on extension deactivate). Mirrors `VaultProviderRegistry`.
 */
import type { ComponentType } from 'react';
import type { Disposable } from 'folyn-extension-sdk';
import type { StorageConfigFormProps } from 'folyn-extension-sdk';
import type { StorageProviderCapabilities } from './types';

export interface StorageProviderEntry {
  /** Unique provider id, e.g. `r2`, `smms`. */
  readonly id: string;
  /** i18n key for the selector label, e.g. `settings:storage.provider.r2.label`. */
  readonly labelKey: string;
  /** Emoji, inline `<svg>`, `.svg` path, or ThemeIcon name. */
  readonly icon?: string;
  readonly capabilities: StorageProviderCapabilities;
  /** Default config seeded when the provider is first selected. */
  readonly defaultConfig: unknown;
  /** React form rendered in Settings → Storage & Sharing when this provider is active. */
  readonly configForm: ComponentType<StorageConfigFormProps>;
  /** Whether the saved config is populated enough to attempt an upload. */
  readonly isConfigured: (config: unknown) => boolean;
  /** Upload image bytes; returns the public https URL. Required when capabilities.image. */
  readonly uploadImage?: (bytes: Uint8Array, ext: string, config: unknown) => Promise<string>;
  /** Upload an HTML string; returns the public https URL. Required when capabilities.html. */
  readonly uploadHtml?: (html: string, config: unknown) => Promise<string>;  /** Owning extension id; undefined for built-ins. Used for diagnostics + cleanup. */
  readonly ownerId?: string;
}

class StorageProviderRegistry {
  private entries = new Map<string, StorageProviderEntry>();

  /** Register a provider entry. Idempotent: re-registering an id replaces it.
   *  Returns a Disposable that unregisters (for extension deactivate). */
  register(entry: StorageProviderEntry): Disposable {
    this.entries.set(entry.id, entry);
    return { dispose: () => { this.entries.delete(entry.id); } };
  }

  /** All registered entries, in insertion order. */
  getAll(): readonly StorageProviderEntry[] {
    return Array.from(this.entries.values());
  }

  /** Get one entry by id, or undefined if not registered. */
  get(id: string): StorageProviderEntry | undefined {
    return this.entries.get(id);
  }
}

export const storageProviderRegistry = new StorageProviderRegistry();

/** All registered storage providers (thin delegator — stable call-site API). */
export function getAllProviders(): readonly StorageProviderEntry[] {
  return storageProviderRegistry.getAll();
}

/** Get one storage provider by id. Throws if not registered (call sites that
 *  tolerate an unregistered active provider should use `getAll()` first). */
export function getProvider(id: string): StorageProviderEntry {
  const entry = storageProviderRegistry.get(id);
  if (!entry) throw new Error(`Unknown storage provider: ${id}`);
  return entry;
}
