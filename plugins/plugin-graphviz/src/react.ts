// ponytail: React access for a trusted-tier plugin loaded via blob-URL import().
// The blob URL can't resolve `import 'react'`, so the plugin MUST NOT import
// react at runtime. Instead the host exposes its own React instance on
// `window.React` (see apps/desktop/src/main.tsx), which trusted plugins share —
// this is what keeps hooks working across the host/plugin boundary (same
// React instance = no "Invalid hook call"). Mirror of
// `examples/plugins/markdown-todo/index.js` `_loadReact`.
import type * as ReactNs from 'react';

export type ReactLike = typeof ReactNs;

/** Resolve the host's shared React instance. Throws if the host forgot to set it. */
export function resolveReact(): ReactLike {
  const w = typeof window !== 'undefined' ? (window as unknown as { React?: ReactLike }) : undefined;
  if (w?.React) return w.React;
  throw new Error(
    '[plugin-graphviz] React not available — host must expose window.React (see main.tsx)',
  );
}

/**
 * Reactive `<html data-theme>`. Graphviz SVG is rendered light then CSS-inverted
 * in dark mode (mirror of MermaidPlugin), so re-render on theme toggle.
 * MutationObserver is the cheapest bridge to the host's appearance store, which
 * always mutates `documentElement.dataset.theme`.
 */
export function useHtmlTheme(): string {
  const React = resolveReact();
  return React.useSyncExternalStore(
    (onChange: () => void) => {
      const obs = new MutationObserver(onChange);
      obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
      return () => obs.disconnect();
    },
    () => document.documentElement.dataset.theme || 'light',
    () => 'light',
  );
}
