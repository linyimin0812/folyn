# __Name__

A Folyn extension (trusted tier).

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
`cd dist && zip -r ../__pkgName__-__version__.zip .` from inside `dist/`.

## Trusted tier — React

The extension renders inline in the host React tree, so it shares the host's
single React instance. `build.mjs` aliases `react` and `react/jsx-runtime` to
the shims in `src/` (`react-shim.js`, `react-jsx-runtime-shim.js`) that read
`window.React` — the host exposes it before any trusted extension loads. Do
NOT bundle React as a normal dep (two copies → broken hooks).

## Structure

- `src/index.ts` — extension entry. Register `handlers` / `containers` /
  `exporters` here via the `ExtensionModule` default export.
- `src/react-shim.js` + `src/react-jsx-runtime-shim.js` — React shims (read
  `window.React`); inlined by esbuild, not shipped to `dist/` separately.
- `manifest.json` — declares contributions (`fileTypes`, `exporters`,
  `containers`, …). `main: "dist/index.js"` is rewritten to `"index.js"` when
  copied into `dist/`.
- `build.mjs` — esbuild config: bundles `src/index.ts` → `dist/index.js`,
  then assembles `dist/` as the installable directory.

See `folyn-extension-plantuml` in the external `folyn-extension-sdk` repo for a working reference.
