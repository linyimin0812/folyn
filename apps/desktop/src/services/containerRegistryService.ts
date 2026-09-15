import { ContainerRegistry } from '@folyn/container-extensions';
import type { ContainerExtension } from '@folyn/container-extensions';
import { usePrefsStore } from '@/store/prefsStore';

/**
 * All registered container directives minus those the user disabled in
 * Settings → Containers (`prefsStore.disabledContainers`).
 *
 * Render-side consumers (markdown preview, slash menu, export) read this
 * instead of `ContainerRegistry.getAll()` directly so a disabled `:::name`
 * no longer renders / appears / exports. The settings gallery still uses
 * `getAll()` so disabled directives stay listed and re-enableable.
 *
 * Reads the prefs store imperatively (`getState`) — the same non-reactive
 * read pattern the registry already has, fine for call-sites that rebuild
 * their view on each render / on demand.
 */
export function getActiveContainers(): ContainerExtension[] {
  const disabled = new Set(usePrefsStore.getState().disabledContainers);
  return ContainerRegistry.getInstance()
    .getAll()
    .filter((c) => !disabled.has(c.name));
}
