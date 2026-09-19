/**
 * Page contribution adapter (trusted-tier full pages).
 *
 * Wires a trusted extension's `contributes.pages[]` declarations into
 * {@link useExtensionPageStore}: each page becomes a `PageEntry` rendered as
 * an ActivityBar page-nav button (icon) + a full-page component in App.tsx
 * (same composition as the built-in translation page). Mirrors the
 * `featureAdapter.ts` shape: iterate contributions, register, return a
 * Disposable that unregisters on extension deactivate.
 *
 * MVP scope:
 * - **Trusted-tier only** (like features). Sandbox extensions contribute tool
 *   windows instead.
 * - **icon required** (featureAdapter Q3/Q4 convention). Missing/empty icon
 *   is warned + skipped.
 * - **id namespacing**: the nav id is `ext:<extensionId>.<pageId>`, so
 *   extension page ids never collide with each other or with built-in pages
 *   (editor/vault/settings/translation). The store's collision guard refuses
 *   duplicate re-registration.
 *
 * Dispose: unregisters the page; if it was the current page at dispose time,
 * falls back to 'editor' so the shell never renders a dangling page id.
 */

import type { ComponentType } from 'react';
import type { Disposable, ExtensionManifest } from '@folyn/extension-host';
import type { PageContribution } from '@folyn/extension-host';
import { useExtensionPageStore } from '@/store/extensionPageStore';
import { useNavStore } from '@/store/navStore';
import { renderIcon } from './featureAdapter';
import { withExtensionBoundary } from './extensionBoundary';
import type { ExtensionModule } from './contributionAdapters';

/** Starting `order` slot for extension pages that don't declare `order`. */
const FIRST_PLUGIN_ORDER = 100;

/** Module-level counter so unordered extension pages land in registration order. */
let nextExtensionPageOrder = FIRST_PLUGIN_ORDER;

export function registerExtensionPages(
  manifest: ExtensionManifest,
  module: ExtensionModule,
): Disposable {
  const pages: PageContribution[] = manifest.contributes?.pages ?? [];
  if (pages.length === 0) return { dispose: () => {} };

  const store = useExtensionPageStore.getState();
  const registered: string[] = [];

  for (const page of pages) {
    // Icon required (featureAdapter Q3/Q4 convention).
    if (!page.icon || !page.icon.trim()) {
      console.warn(
        `[extension-host] extension "${manifest.id}" page "${page.id}" has no icon — icon is required, skipped`,
      );
      continue;
    }

    // Resolve component entry-ref.
    const component: ComponentType | undefined = module.pages?.[page.component];
    if (!component) {
      console.warn(
        `[extension-host] extension "${manifest.id}" page "${page.id}" has no component for entry-ref "${page.component}" — skipped`,
      );
      continue;
    }

    const order =
      typeof page.order === 'number'
        ? page.order
        : nextExtensionPageOrder++; // registration-order slot

    const navId = `ext:${manifest.id}.${page.id}`;
    store.register({
      id: navId,
      title: page.title ?? `${manifest.id}/${page.id}`,
      icon: renderIcon(page.icon),
      // Render-isolation chokepoint: wrap once at the adapter (extensionBoundary
      // contract); render sites mount an already-wrapped component.
      component: withExtensionBoundary(
        component,
        manifest.id,
        `page:${manifest.id}:${page.id}`,
      ),
      order,
    });
    registered.push(navId);
  }

  return {
    dispose: () => {
      const s = useExtensionPageStore.getState();
      for (const id of registered) {
        s.unregister(id);
        if (useNavStore.getState().currentPage === id) {
          useNavStore.getState().setCurrentPage('editor');
        }
      }
    },
  };
}
