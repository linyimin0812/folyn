/**
 * `withExtensionBoundary` — the trusted-extension render-isolation chokepoint.
 *
 * Trusted extensions are `import()`-ed into the host webview realm (see
 * `trustedLoader`), so a extension-contributed React component that throws during
 * render propagates up the host tree and white-screens the whole app. The
 * `extension-sdk` is public and third-party authors ship extensions, so isolation
 * must be a **host-side hard contract**: no extension render throw may crash the
 * host, regardless of how the extension is written.
 *
 * This helper wraps a extension-contributed component so a render throw is
 * isolated to that surface (inline fallback) and recorded to `extensionStore`.
 * Applied **once at the adapter** that registers the component into a host
 * registry (`registerExtensionFileTypes` Editor/Preview, code-renderer
 * component) — render sites (`WorkArea`, `PreviewPane`, `MarkdownPreview`)
 * then render an already-wrapped component and need no change.
 *
 * Each `createElement(Wrapped)` instance gets its own boundary instance, so
 * sibling isolation is automatic: one broken `:::box` / ```lang``` block
 * doesn't take out its siblings.
 *
 * ponytail: a thin functional wrapper around the existing `PanelErrorBoundary`
 * — no new boundary class, no new SDK runtime. The boundary stays in error
 * state until remount; extension deactivation disposes the registered component,
 * so the next activation mounts a fresh boundary (error cleared). Switching
 * tabs remounts per-instance boundaries. A "retry" button is a follow-up.
 */

import { createElement, type ComponentType } from 'react';
import { PanelErrorBoundary } from '@/components/sidebar/PanelErrorBoundary';

/**
 * Wrap a extension-contributed component in a `PanelErrorBoundary` keyed to the
 * given extension + surface label.
 *
 * @param Comp     The extension component (Editor / Preview / code renderer).
 * @param extensionId The contributing extension's manifest id, for error attribution.
 * @param surface  Diagnostics label, e.g. `file-type:dbml:editor`.
 */
export function withExtensionBoundary<P extends object>(
  Comp: ComponentType<P>,
  extensionId: string,
  surface: string,
): ComponentType<P> {
  return function ExtensionBoundaryWrapped(props: P) {
    return createElement(PanelErrorBoundary, {
      extensionId,
      surface,
      children: createElement(Comp, props),
    });
  };
}
