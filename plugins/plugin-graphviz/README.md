# Graphviz Plugin (`@quill/plugin-graphviz`)

Trusted-tier Quill plugin that renders **Graphviz DOT** graphs. Contributes two
things:

- a **file-type handler** for `.dot` / `.gv` — open the file in Quill, get a
  live SVG preview (preview-only; edit the source in an external editor).
- a **`:::graphviz` Markdown container directive** — embed DOT inside any
  Markdown note, rendered to SVG in the preview pane (mirrors `:::mermaid`).

Rendering uses [`@viz-js/viz`](https://github.com/nicholasgriffintn/viz) — a
pure-WASM Graphviz build. The wasm (~1.17 MB / ~456 KB gzip, **wasm included**)
is inlined inside `@viz-js/viz`'s JS as a `binaryDecode('…')` string literal, so
it rides inside this plugin's self-contained ESM bundle — no separate `.wasm`
asset, no fetch, no `locateFile`. The host's main-webview CSP grants
`wasm-unsafe-eval`, so `WebAssembly.instantiate` runs on the inlined bytes.

> **Cost note:** the plugin's `dist/index.js` is ~1.2 MB because it bundles the
> inlined wasm. It is `import()`-ed by the trusted loader **only after** the user
> installs + trusts the plugin and opens a `.dot` file — the host app stays
> zero-cost when the plugin isn't installed.

## Install + trust

1. Build the plugin: `pnpm --filter @quill/plugin-graphviz build` (produces
   `dist/index.js`).
2. In Quill: **Settings → Plugins → 从文件夹安装…**, pick the
   `plugins/plugin-graphviz` folder (folder name must equal the manifest id).
3. The plugin shows as **已安装**. Trusted plugins require explicit approval —
   click **批准并授权** and confirm the consent modal (TOFU gate: integrity
   SHA-256 + user pin).
4. Open any `.dot` / `.gv` file, or type `:::graphviz` in a Markdown note. The
   SVG renders in the preview pane.

Uninstall from the same panel — both the `.dot` extension handler and the
`:::graphviz` container are auto-disposed.

## Architecture

- **Trusted tier**: `import()`-ed into the host webview realm (see
  `apps/desktop/src/services/plugin-host/trustedLoader.ts`). The host exposes
  `window.React` / `window.ReactDOM` so the plugin's components share the host's
  React instance (avoids "Invalid hook call"). The plugin uses
  `window.React.createElement` — **no JSX, no runtime `import 'react'`** — so the
  blob-URL bundle is self-contained.
- **Shared singleton**: both the file Preview and the container use one
  `@viz-js/viz` instance (`src/renderDot.ts`) → wasm loads once.
- **Dark mode**: SVG rendered light, then CSS-inverted (`invert(0.92)
  hue-rotate(180deg)`) on an inner wrapper (mirrors `MermaidPlugin`).
- **Errors**: invalid DOT shows a red box with the message + original source
  (mirrors `MermaidPlugin`'s error path); never crashes.

## Licenses

- Plugin code: MIT (see `LICENSE`).
- `@viz-js/viz`: MIT.
- Graphviz (the WASM build of): EPL-2.0 (weak copyleft, does **not** copyleft
  the MIT host — see `THIRD_PARTY.md`).
