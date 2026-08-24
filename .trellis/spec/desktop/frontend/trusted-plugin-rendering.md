# Trusted Plugin Rendering Contract

> Executable contract for trusted-tier plugins that render React components inline in the host tree (container directive blocks, file-type `Preview`/`Editor`).

---

## Scope / Trigger

Applies whenever a `trusted`-tier plugin contributes a React component that the host mounts inside its own React tree (`contributes.containers[]`, `contributes.fileTypes[].Preview`/`Editor`). Sandbox-tier plugins (iframe + postMessage) are out of scope.

---

## The core contract

Trusted plugins run in the host webview realm but are loaded as a **blob URL** `import()` (see `apps/desktop/src/services/plugin-host/trustedLoader.ts`). A blob URL has no path, so:

- relative imports do not resolve (`./utils.js` fails)
- remote imports are blocked by the `folyn-plugin://` CSP
- **bare specifiers (`react`, `react-dom`) do NOT resolve from a blob module** — there is no import map (see "Why not import maps" below)

A plugin component rendered inside the host's React tree MUST use the **same React instance** as the host, or React hooks throw `Invalid hook call` (two-React-copies problem). Therefore:

### Signature — host side

```ts
// apps/desktop/src/main.tsx — React is imported for the host; expose the SAME
// instance to trusted plugins before createRoot runs:
import React from 'react';
import * as ReactDOMFull from 'react-dom';
window.React = React;
window.ReactDOM = ReactDOMFull; // full namespace (createPortal/findDOMNode); NOT react-dom/client
```

`apps/desktop/src/vite-env.d.ts` declares the globals:

```ts
declare global {
  interface Window {
    React: typeof import('react');
    ReactDOM: typeof import('react-dom'); // full react-dom namespace (matches the UMD global)
  }
}
```

### Signature — plugin side

A trusted plugin resolves the host React instance; it does NOT import it at runtime:

```ts
// plugins/<id>/src/react.ts
export function resolveReact(): typeof import('react') {
  if (typeof window !== 'undefined' && window.React) return window.React;
  throw new Error('[<id>] window.React not available — host must expose it (main.tsx)');
}
```

Plugin components are written with `createElement` (NO JSX, NO `import React from 'react'` at module top level):

```ts
const R = resolveReact();
const { createElement: h, useState, useEffect } = R;

export function MyContainer(props: ContainerProps) {
  const [svg, setSvg] = useState<string | null>(null);
  useEffect(() => { /* ... */ }, [props.children]);
  return h('div', { className: 'docmd-my' }, svg && h('div', { dangerouslySetInnerHTML: { __html: svg } }));
}
```

Type-only imports (`import type React from 'react'`) are erased at build time and are fine — they do not appear in the built bundle. The rule is about **runtime** imports.

---

## Validation & Error Matrix

| Condition | Result |
|-----------|--------|
| Plugin bundle emits `import 'react'` (runtime) | Blob `import()` fails: `TypeError: Failed to resolve module specifier 'react'`. Plugin does not load. |
| Plugin bundles its own React instance | Loads, but hooks throw `Invalid hook call` when host renders the plugin's component. |
| Plugin uses JSX (automatic runtime) | Build emits `import { jsx } from 'react/jsx-runtime'` — same as runtime `import 'react'`: blob import fails. **Do not use JSX in trusted plugins.** |
| Host omits `window.React` assignment | Plugin's `resolveReact()` throws at render time. (Pre-graphviz-plugin state: every trusted sample that renders React was broken at runtime; only worked under vitest where Vite resolves `import('react')`.) |
| `window.ReactDOM` typed as `react-dom/client` | Typecheck fails — the UMD `export as namespace ReactDOM` global exposes the full namespace; `client` lacks `createPortal`/`findDOMNode`. Use `typeof import('react-dom')`. |

---

## Why not import maps

An import map in `apps/desktop/index.html` mapping `react` → a host-served module URL would let the plugin `import 'react'` and resolve to the host's instance — the "orthodox" solution. **Rejected**:

- Import maps in WKWebView require Safari/WebKit 16.4 = **macOS 13.3 Ventura**.
- This project sets no `MACOSX_DEPLOYMENT_TARGET`; it inherits the Tauri 2 default of **macOS 10.15**.
- Users on macOS 10.15–12 would get `TypeError: Failed to resolve module specifier 'react'` with the import map never consulted, and import maps **cannot be polyfilled**.
- `window.React` globals work on every macOS version Tauri supports.

See `.trellis/tasks/07-30-graphviz-trusted-plugin/research/wkwebview-importmap-blob-url.md` for the full analysis.

---

## Good / Base / Bad

**Good** — plugin component uses `window.React` via `createElement`, no JSX, bundles only its real runtime deps (e.g. `@viz-js/viz`):

```ts
const { createElement: h, useState, useEffect } = resolveReact();
export function GraphvizBlock({ children }: ContainerProps) {
  const [svg, setSvg] = useState<string | null>(null);
  useEffect(() => { renderDot(textOf(children)).then(setSvg); }, [children]);
  return svg ? h('div', { dangerouslySetInnerHTML: { __html: svg } }) : h('div', null, '渲染中…');
}
```

**Base** — a plugin with no inline React (commands only, no `containers`/`Preview`) can `import` lazily inside functions and does not need `window.React`. See `examples/plugins/markdown-todo`.

**Bad** — JSX or runtime React import in a trusted plugin that renders inline:

```tsx
// ❌ emits `import { jsx } from 'react/jsx-runtime'` → blob import fails
export function BadContainer({ children }: ContainerProps) {
  return <div>{children}</div>;
}
```

---

## Tests Required

- **Bundle self-containedness**: after `vite build`, the built `dist/index.js` must contain **zero** `import` statements, zero `react`/`jsx` string occurrences, and reference `window.React`. Assert via a build-smoke test (grep the built file).
- **Render logic**: pure render functions (e.g. `renderDot(source)`) are unit-tested: valid input → output containing `<svg`; invalid input → throws (caught by the component, rendered as an error + original-source fallback).
- **Host gate**: `apps/desktop/src/main.tsx` asserts `window.React` is assigned before `createRoot` (covered by the existing desktop typecheck/build).

---

## Wrong vs Correct

### Wrong — bundling React into the plugin

```ts
// vite.config.ts
import react from '@vitejs/plugin-react';
export default defineConfig({ plugins: [react()], /* ... */ });
// src/Block.tsx
import { useState } from 'react';          // ❌ runtime import + bundled React instance
export function Block() { const [s, setS] = useState(null); return <div/>; }
```

Result: builds fine, but host-rendered component throws `Invalid hook call` (two React copies).

### Correct — host instance via global, no JSX

```ts
// vite.config.ts — NO @vitejs/plugin-react (no JSX). Bundle real deps only.
export default defineConfig({ build: { lib: { entry: 'src/index.ts', formats: ['es'], fileName: 'index' }, rollupOptions: { external: [] } } });
// src/react.ts
export const resolveReact = () => window.React;   // host instance
// src/Block.ts — createElement, no JSX
const { createElement: h, useState } = resolveReact();
export function Block() { const [s] = useState(null); return h('div', null, 'ok'); }
```

---

## Related

- `docs/plugin-development.md` §"The PluginModule export contract (trusted tier)" + §"Trusted tier bundling"
- `apps/desktop/src/services/plugin-host/trustedLoader.ts` (blob URL + `import()`)
- `apps/desktop/src/services/plugin-host/contributionAdapters.ts` (`PluginModule` resolution)
- `packages/container-plugins/src/plugins/MermaidPlugin.tsx` (inline-render precedent — but note: mermaid runs host-bundled, not as a blob-URL plugin; the `window.React` rule applies only to blob-loaded trusted plugins)
