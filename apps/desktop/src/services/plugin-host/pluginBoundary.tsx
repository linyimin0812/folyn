/**
 * `withPluginBoundary` — the trusted-plugin render-isolation chokepoint.
 *
 * Trusted plugins are `import()`-ed into the host webview realm (see
 * `trustedLoader`), so a plugin-contributed React component that throws during
 * render propagates up the host tree and white-screens the whole app. The
 * `plugin-sdk` is public and third-party authors ship plugins, so isolation
 * must be a **host-side hard contract**: no plugin render throw may crash the
 * host, regardless of how the plugin is written.
 *
 * This helper wraps a plugin-contributed component so a render throw is
 * isolated to that surface (inline fallback) and recorded to `pluginStore`.
 * Applied **once at the adapter** that registers the component into a host
 * registry (`registerPluginFileTypes` Editor/Preview, code-renderer
 * component) — render sites (`WorkArea`, `PreviewPane`, `MarkdownPreview`)
 * then render an already-wrapped component and need no change.
 *
 * Each `createElement(Wrapped)` instance gets its own boundary instance, so
 * sibling isolation is automatic: one broken `:::box` / ```lang``` block
 * doesn't take out its siblings.
 *
 * ponytail: a thin functional wrapper around the existing `PanelErrorBoundary`
 * — no new boundary class, no new SDK runtime. The boundary stays in error
 * state until remount; plugin deactivation disposes the registered component,
 * so the next activation mounts a fresh boundary (error cleared). Switching
 * tabs remounts per-instance boundaries. A "retry" button is a follow-up.
 */

import { createElement, type ComponentType } from 'react';
import { PanelErrorBoundary } from '@/components/sidebar/PanelErrorBoundary';

/**
 * Wrap a plugin-contributed component in a `PanelErrorBoundary` keyed to the
 * given plugin + surface label.
 *
 * @param Comp     The plugin component (Editor / Preview / code renderer).
 * @param pluginId The contributing plugin's manifest id, for error attribution.
 * @param surface  Diagnostics label, e.g. `file-type:dbml:editor`.
 */
export function withPluginBoundary<P extends object>(
  Comp: ComponentType<P>,
  pluginId: string,
  surface: string,
): ComponentType<P> {
  return function PluginBoundaryWrapped(props: P) {
    return createElement(
      PanelErrorBoundary,
      { pluginId, surface },
      createElement(Comp, props),
    );
  };
}
