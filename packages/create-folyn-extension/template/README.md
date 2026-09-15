# __Name__

A Folyn extension.

## Develop

```sh
pnpm install
pnpm build      # → dist/ (installable)
```

## Install

After `pnpm build`, the `dist/` directory is a self-contained extension
package — `manifest.json` + the bundled `index.js`. Open
**Settings → Extensions → Install from folder…** and pick `dist/`.

`dist/` contains only compiled output; source, configs, and
`node_modules/` stay outside. To ship a zip, run
`cd dist && zip -r ../<name>-<version>.zip .` from inside `dist/`.

## Structure

- `src/index.ts` — extension entry. Register `handlers` / `containers` / `exporters` here.
- `manifest.json` — declares contributions (`fileTypes`, `exporters`, `containers`, …). The root manifest's `main: "dist/index.js"` is rewritten to `"index.js"` when copied into `dist/`.
- `build.mjs` — esbuild config that bundles `src/index.ts` → `dist/index.js`, then assembles `dist/` as the installable directory.

See `folyn-extension-plantuml` in the external `folyn-extension-sdk` repo for a working reference.
