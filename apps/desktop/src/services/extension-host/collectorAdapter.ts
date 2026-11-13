/**
 * Collector contribution adapter (trusted-tier, design §2/§3).
 *
 * Hands a trusted extension's `contributes.collectors` / `activityDisplay` /
 * `entityTypes` declarations plus the module's `collectors` impl map to the
 * collector registry (`services/activity/registry.ts`), and boots the poll
 * runtime on the first registration. Mirrors featureAdapter: register on
 * activate, unregister on deactivate — "enabled" is activation state.
 *
 * A collector may bring its own settings form (`module.collectors[id].configForm`);
 * it is wrapped in an error boundary here, once, like every other contributed
 * component.
 *
 * Constraints (icon set, palette keys, builtin formatters/aggregates) are
 * validated host-side where the values are consumed (render/query); this
 * adapter only folds declarations, like the other declarative adapters.
 */

import type { ComponentType } from 'react';
import type {
  CollectorConfigFormProps,
  Disposable,
  ExtensionApi,
  ExtensionManifest,
  ExtensionModule,
} from '@folyn/extension-host';
import { useCollectorRegistryStore } from '@/services/activity/registry';
import { ensureCollectorRuntimeStarted } from '@/services/activity/runtime';
import { withExtensionBoundary } from './extensionBoundary';

export function registerExtensionCollectors(
  manifest: ExtensionManifest,
  module: ExtensionModule,
  api: ExtensionApi,
): Disposable {
  const contributes = manifest.contributes;
  const collectors = contributes?.collectors ?? [];
  const activityDisplay = contributes?.activityDisplay ?? [];
  const entityTypes = contributes?.entityTypes ?? [];
  if (collectors.length === 0 && activityDisplay.length === 0 && entityTypes.length === 0) {
    return { dispose: () => {} };
  }

  // Boot subscriptions + initial schedule once; subsequent registrations and
  // settings flips are tracked by the runtime's own store subscriptions.
  ensureCollectorRuntimeStarted();

  // A collector's own settings form renders in the host tree: isolate a render
  // throw to the collector's card.
  const configForms: Record<string, ComponentType<CollectorConfigFormProps>> = {};
  for (const [id, impl] of Object.entries(module.collectors ?? {})) {
    if (impl.configForm) {
      configForms[id] = withExtensionBoundary(impl.configForm, manifest.id, `collector:${id}:config`);
    }
  }

  useCollectorRegistryStore.getState().register({
    extensionId: manifest.id,
    extensionName: manifest.name,
    collectors,
    activityDisplay,
    entityTypes,
    impls: module.collectors,
    configForms,
    api,
  });

  return {
    dispose: () => {
      useCollectorRegistryStore.getState().unregister(manifest.id);
    },
  };
}
