/**
 * Feature contribution adapter (trusted-tier sidebar panels).
 *
 * Wires a trusted plugin's `contributes.features[]` declarations into
 * {@link useFeaturePanelStore}: each feature becomes a `PanelEntry` rendered
 * in the activity bar (icon) + sidebar (component) when active. Mirrors the
 * `toolAdapter.ts` shape: iterate contributions, register, return a Disposable
 * that unregisters on plugin deactivate.
 *
 * MVP scope (see prd.md decisions):
 * - **Trusted-tier only** (Decision Q1). Sandbox plugins contribute tool
 *   windows instead; this adapter is wired only into `trustedLoader` (PR3).
 * - **Left panel only** (Decision Q2). `panel: 'right'|'bottom'` is warned +
 *   skipped; right/bottom shell slots are a follow-up task.
 * - **icon required** (Decision Q3/Q4). Missing/empty `icon` is warned + skipped.
 * - **id collision guard**: built-in ids (files/wiki/clips/analyze/calendar)
 *   are reserved; a plugin declaring them is refused. A second plugin (or
 *   the same plugin re-registering) hitting an already-registered id is also
 *   refused by the store's own guard.
 *
 * Dispose: unregisters the panel; if the panel was active at dispose time,
 * falls back to 'files' (if registered) or null (PR1 guard — 'files' is
 * registered in PR2). Mirrors App.tsx:384-387 fallback intent.
 */

import type { ComponentType, ReactNode } from 'react';
import type { Disposable, PluginManifest } from '@quill/plugin-host';
import type { FeatureContribution } from '@quill/plugin-host';
import { IconFromSvg } from '@/components/icons/IconFromSvg';
import { ThemeIcon } from '@/components/icons/ThemeIcon';
import { useFeaturePanelStore } from '@/store/featurePanelStore';
import type { PluginModule } from './contributionAdapters';

/** Reserved built-in ids; plugins may not register these. */
const BUILTIN_IDS = new Set(['files', 'wiki', 'clips', 'analyze', 'calendar']);

/** Starting `order` slot for plugin panels that don't declare `order`. */
const FIRST_PLUGIN_ORDER = 100;

/** Module-level counter so unordered plugin panels land after built-ins in registration order. */
let nextPluginOrder = FIRST_PLUGIN_ORDER;

function renderIcon(icon: string): ReactNode {
  // ponytail: a raw `<svg>` string is the common case for plugin authors (inline,
  // self-contained). A `ThemeIcon` name (e.g. "folder") is the convenience path
  // for built-in host icons. Both return ReactNode; the activity bar renders it.
  if (icon.trim().startsWith('<svg')) {
    return <IconFromSvg svg={icon} size={16} />;
  }
  return <ThemeIcon name={icon} size={16} />;
}

export function registerPluginFeatures(
  manifest: PluginManifest,
  module: PluginModule,
): Disposable {
  const features: FeatureContribution[] = manifest.contributes?.features ?? [];
  if (features.length === 0) return { dispose: () => {} };

  const store = useFeaturePanelStore.getState();
  const registered: string[] = [];

  for (const feature of features) {
    // Decision Q2: left only. right/bottom warned + skipped.
    if (feature.panel !== 'left') {
      console.warn(
        `[plugin-host] plugin "${manifest.id}" feature "${feature.id}" has panel: "${feature.panel}" — only 'left' is implemented, skipped`,
      );
      continue;
    }

    // Collision guard: built-in reserved ids.
    if (BUILTIN_IDS.has(feature.id)) {
      console.warn(
        `[plugin-host] plugin "${manifest.id}" feature "${feature.id}" collides with a reserved built-in id — refused`,
      );
      continue;
    }

    // Icon required (Q3/Q4).
    if (!feature.icon || !feature.icon.trim()) {
      console.warn(
        `[plugin-host] plugin "${manifest.id}" feature "${feature.id}" has no icon — icon is required, skipped`,
      );
      continue;
    }

    // Resolve component entry-ref.
    const component: ComponentType | undefined = module.features?.[feature.component];
    if (!component) {
      console.warn(
        `[plugin-host] plugin "${manifest.id}" feature "${feature.id}" has no component for entry-ref "${feature.component}" — skipped`,
      );
      continue;
    }

    const order =
      typeof feature.order === 'number'
        ? feature.order
        : (nextPluginOrder++); // next-after-builtin slot by registration order

    store.register({
      id: feature.id,
      title: feature.title ?? `${manifest.id}/${feature.id}`,
      icon: renderIcon(feature.icon),
      component,
      order,
      badge: feature.badge,
      visible: true,
    });
    registered.push(feature.id);
  }

  return {
    dispose: () => {
      // PR2+: 'files' is a built-in registered at startup by
      // `registerBuiltinPanels`, so it's always present in production. The
      // guard below (fall back to 'files' only if registered, else clear) is a
      // test-env safety net — tests that don't seed 'files' get null. In
      // production this always resolves to 'files'.
      // TODO(PR3): when this adapter is wired into trustedLoader, ALSO call
      // `useEditorStore.getState().setActivePanel('files')` on the wasActive
      // path so editorStore.activePanel (and thus WorkArea's tab filter) stays
      // in sync — the featurePanelStore mirror subscription only covers
      // editorStore→featurePanelStore, not the reverse.
      const filesRegistered = useFeaturePanelStore
        .getState()
        .panels.some((p) => p.id === 'files');
      const s = useFeaturePanelStore.getState();
      for (const id of registered) {
        const wasActive = s.activePanelId === id;
        s.unregister(id);
        if (wasActive) {
          s.setActive(filesRegistered ? 'files' : null);
        }
      }
    },
  };
}
