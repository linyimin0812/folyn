/**
 * Collector contribution adapter (trusted-tier, design §2/§3).
 *
 * Hands a trusted extension's `contributes.collectors` / `activityDisplay` /
 * `entityTypes` declarations plus the module's `collectors` impl map to the
 * collector registry (`services/activity/registry.ts`), and boots the poll
 * runtime on the first registration. Mirrors featureAdapter: register on
 * activate, unregister on deactivate — "enabled" is activation state.
 *
 * Constraints (icon set, palette keys, builtin formatters/aggregates) are
 * validated host-side where the values are consumed (render/query); this
 * adapter only folds declarations, like the other declarative adapters.
 */

import type { Disposable, ExtensionManifest, ExtensionModule } from '@folyn/extension-host';
import { useCollectorRegistryStore } from '@/services/activity/registry';
import { ensureCollectorRuntimeStarted } from '@/services/activity/runtime';

export function registerExtensionCollectors(
  manifest: ExtensionManifest,
  module: ExtensionModule,
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

  useCollectorRegistryStore.getState().register({
    extensionId: manifest.id,
    extensionName: manifest.name,
    collectors,
    activityDisplay,
    entityTypes,
    impls: module.collectors,
  });

  return {
    dispose: () => {
      useCollectorRegistryStore.getState().unregister(manifest.id);
    },
  };
}
