# __Name__

A Quill plugin.

## Develop

```sh
pnpm install
pnpm build      # → dist/ (installable)
```

## Install

After `pnpm build`, the `dist/` directory is a self-contained plugin
package — `manifest.json` + the bundled `index.js`. Open
**Settings → Plugins → Install from folder…** and pick `dist/`.

`dist/` contains only compiled output; source, configs, and
`node_modules/` stay outside. To ship a zip, run
`cd dist && zip -r ../<name>-<version>.zip .` from inside `dist/`.

## Structure

- `src/index.ts` — plugin entry. Register `handlers` / `containers` / `exporters` here.
- `manifest.json` — declares contributions (`fileTypes`, `exporters`, `containers`, …). The root manifest's `main: "dist/index.js"` is rewritten to `"index.js"` when copied into `dist/`.
- `build.mjs` — esbuild config that bundles `src/index.ts` → `dist/index.js`, then assembles `dist/` as the installable directory.

See `quill-plugin-plantuml` in the external `quill-plugin-sdk` repo for a working reference.
