# __Name__

A Quill plugin.

## Develop

```sh
pnpm install
pnpm build
```

## Structure

- `src/index.ts` — plugin entry. Register `handlers` / `containers` / `exporters` here.
- `manifest.json` — declares contributions (`fileTypes`, `exporters`, `containers`, …).
- `build.mjs` — esbuild config that bundles `src/index.ts` to `dist/index.js`.

See `quill-plugin-plantuml` in the external `quill-plugin-sdk` repo for a working reference.
