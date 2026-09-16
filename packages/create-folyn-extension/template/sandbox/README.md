# __Name__

A Folyn extension (sandbox tier).

## Develop

```sh
pnpm install
pnpm build      # → dist/ (installable)
```

## Install

After `pnpm build`, the `dist/` directory is a self-contained extension
package — `manifest.json` + `index.html` + the bundled `index.js`. Open
**Settings → Extensions → Install from folder…** and pick `dist/`.

`dist/` contains only compiled output; source, configs, and
`node_modules/` stay outside. To ship a zip, run
`cd dist && zip -r ../__pkgName__-__version__.zip .` from inside `dist/`.

## Sandbox tier — isolation

The extension runs in a sandboxed iframe (`sandbox="allow-scripts"`, opaque
origin `null`) — no host DOM, no `window.React`, no Tauri APIs. Every host
capability (fs, clipboard, http, vault, dialog, …) goes through a
`postMessage` RPC bridge, and **each call is checked against
`manifest.permissions` before it runs**. Declare what you use in the manifest,
then call it via the `rpc()` helper wired up in `src/index.ts`.

React is NOT available from the host — bundle your own UI deps (they live in
the iframe's isolated origin, so a second React instance is fine here), or use
plain DOM.

## Structure

- `src/index.ts` — iframe script. Listens for host messages, exposes an
  `rpc(method, params)` helper, and dispatches `invoke` messages to the
  `commands` map. Add your command handlers here.
- `src/index.html` — iframe HTML entry. `build.mjs` copies it into `dist/`
  (rewriting the script src to `./index.js`).
- `manifest.json` — declares `tier: "sandbox"`, `html: "index.html"`,
  `main: "index.js"`, `permissions` (RPC gate), and `contributes.*`.
- `build.mjs` — esbuild config: bundles `src/index.ts` → `dist/index.js`
  (IIFE), copies `src/index.html` → `dist/index.html`, writes
  `dist/manifest.json`.

See `folyn-extension-sdk/folyn-extension-plantuml` in the external
`folyn-extension-sdk` repo for a working reference (trusted), and the SDK
docs "Sandbox RPC protocol" section for the message protocol.
