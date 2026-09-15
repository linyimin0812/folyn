/**
 * Storage-provider contribution adapter (trusted tier).
 *
 * Maps a trusted extension's `contributes.storageProviders[]` declarations
 * into the {@link storageProviderRegistry}. Each contribution's entry-refs
 * (`configForm` / `isConfigured` / `uploadImage` / `uploadHtml`) resolve from
 * `module.storageProviders[ref]`; the React config form is wrapped in an error
 * boundary so a render throw is isolated to the Storage & Sharing settings and
 * never white-screens the host.
 *
 * Returns a single Disposable that unregisters every entry on extension
 * deactivate/uninstall — built-in providers are untouched (different owner).
 *
 * ponytail: mirrors the other trusted adapters — read `manifest.contributes.*`,
 * resolve entry-refs, register into the app registry, return a merged Disposable.
 */
import type { ComponentType } from 'react';
import type { Disposable, ExtensionManifest } from '@folyn/extension-host';
import type { StorageProviderContribution } from '@folyn/extension-host';
import type { StorageConfigFormProps } from '@folyn/extension-host';
import type { ExtensionModule } from 'folyn-extension-sdk';
import { storageProviderRegistry } from '@/services/storage/registry';
import { withExtensionBoundary } from './extensionBoundary';

function mergeDisposables(disposables: Disposable[]): Disposable {
  return {
    dispose: async () => {
      for (const d of disposables) {
        try {
          await d.dispose();
        } catch (err) {
          console.error('[extension-host] storage-provider dispose failed:', err);
        }
      }
    },
  };
}

/** Resolve an entry-ref to a value in `module.storageProviders`, or undefined. */
function resolve<T>(module: ExtensionModule, ref: string | undefined): T | undefined {
  if (!ref) return undefined;
  return module.storageProviders?.[ref] as T | undefined;
}

export function registerExtensionStorageProviders(
  manifest: ExtensionManifest,
  module: ExtensionModule,
): Disposable {
  const contributions: StorageProviderContribution[] = manifest.contributes?.storageProviders ?? [];
  if (contributions.length === 0) return { dispose: () => {} };

  const disposables: Disposable[] = [];
  for (const contrib of contributions) {
    const configForm = resolve<ComponentType<StorageConfigFormProps>>(module, contrib.configForm);
    const isConfigured = resolve<(config: unknown) => boolean>(module, contrib.isConfigured);
    const uploadImage = resolve<(bytes: Uint8Array, ext: string, config: unknown) => Promise<string>>(module, contrib.uploadImage);
    const uploadHtml = resolve<(html: string, config: unknown) => Promise<string>>(module, contrib.uploadHtml);

    if (!configForm || typeof configForm !== 'function') {
      console.warn(
        `[extension-host] extension "${manifest.id}" storage provider "${contrib.id}" has no configForm for entry-ref "${contrib.configForm}" — skipped`,
      );
      continue;
    }
    if (typeof isConfigured !== 'function') {
      console.warn(
        `[extension-host] extension "${manifest.id}" storage provider "${contrib.id}" has no isConfigured for entry-ref "${contrib.isConfigured}" — skipped`,
      );
      continue;
    }
    if (contrib.capabilities.image && typeof uploadImage !== 'function') {
      console.warn(
        `[extension-host] extension "${manifest.id}" storage provider "${contrib.id}" declares capabilities.image but has no uploadImage for entry-ref "${contrib.uploadImage}" — skipped`,
      );
      continue;
    }
    if (contrib.capabilities.html && typeof uploadHtml !== 'function') {
      console.warn(
        `[extension-host] extension "${manifest.id}" storage provider "${contrib.id}" declares capabilities.html but has no uploadHtml for entry-ref "${contrib.uploadHtml}" — skipped`,
      );
      continue;
    }

    const d = storageProviderRegistry.register({
      id: contrib.id,
      labelKey: contrib.labelKey,
      icon: contrib.icon,
      capabilities: contrib.capabilities,
      defaultConfig: contrib.defaultConfig,
      configForm: withExtensionBoundary(configForm, manifest.id, `storage-provider:${contrib.id}`),
      isConfigured,
      uploadImage,
      uploadHtml,
      ownerId: manifest.id,
    });
    disposables.push(d);
  }
  return mergeDisposables(disposables);
}
