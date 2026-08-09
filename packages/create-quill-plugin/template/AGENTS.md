# Agent Context — Quill Plugin

You are working on a **Quill plugin**. This file gives you the minimum context to develop, build, and ship it. Read it before editing.

## What this is

A Quill plugin is a single-file ESM bundle loaded by the Quill desktop app at runtime. It registers contributions (commands, file types, containers, exporters, markdown code renderers, editor languages, …) declared in `manifest.json` and wired up in `src/index.ts`. React is provided by the host (`window.React`) — do not bundle it.

## Build / verify loop

```sh
pnpm install
pnpm build        # → dist/ (self-contained installable dir)
```

Then in Quill: **Settings → Plugins → Install from folder…** → pick `dist/`. Reload Quill (or restart) to pick up changes. Test by exercising the contribution you added.

To ship a zip: `cd dist && zip -r ../<name>-<version>.zip .`

## First files to read

- `manifest.json` — declares `id`, `name`, `version`, `quill` compat, `permissions`, `contributes.*` (the contract between plugin and host). Start here when adding a feature.
- `src/index.ts` — plugin entry. The default export is a `PluginModule` whose `handlers` / `exporters` / `containers` / `markdownCodeRenderers` / `editorLanguages` maps mirror the keys in `manifest.json`'s `contributes.*`.
- `build.mjs` — esbuild config. Bundles `src/index.ts` → `dist/index.js` (single-file ESM, all deps inlined), then writes `dist/manifest.json` with `main` rewritten to `index.js`. React stays external (resolved from `window.React` at runtime).
- `README.md` — install + structure overview (human-facing).

## How to add a contribution

1. Add an entry under the matching `contributes.*` array in `manifest.json` (e.g. `fileTypes`, `exporters`, `commands`).
2. Wire the matching key in `src/index.ts`'s default export (`handlers`, `exporters`, `containers`, …). The contribution's entry-ref in the manifest points to this key.
3. Update `permissions` in `manifest.json` if the contribution needs fs / http / clipboard / dialog / window / vault / ai access. Quill enforces these at the trust boundary.
4. `pnpm build` → reinstall `dist/` → reload Quill → test.

## Pitfalls

- **Main-thread-only APIs.** Tray, window, and any Electron-decorated API that touches the UI must run on the main thread. Calling them from a plugin render / worker context can crash the host on reload. If an API is documented as main-thread-only, route the call through the SDK's main-thread bridge — do not call it directly.
- **`manifest.main` rewrite.** Root `manifest.json` says `"main": "dist/index.js"` so the host finds it during dev. `build.mjs` strips the `dist/` prefix when copying into `dist/manifest.json` (→ `"main": "index.js"`). Do not "fix" the prefix in one place without the other — install breaks silently.
- **React is external.** `build.mjs` sets `external: []` but React is resolved via `window.React` at runtime (host exposes it before any trusted plugin is `import()`-ed). Importing React as a normal dep will create a second copy and break hooks. Use the global.
- **Permissions are enforced.** A missing `permissions.fs.scope` / `permissions.http.origins` entry will cause the call to reject at runtime, not at build time. Declare what you use.
- **`tier: "trusted"`** in the manifest means the host loads the plugin with elevated access. Trusted plugins are bundled into the app's process — do not accept untrusted input into plugin code paths without validation.

## Reference

- External repo `quill-plugin-sdk` — SDK types (`PluginModule`, contribution types, permission shapes) and the canonical example plugin `quill-plugin-plantuml`. When in doubt about an SDK type, read the SDK source, not this file.
- Repo-root `AGENTS.md` — engineering principles for this monorepo (remove obsolete paths, simplest implementation, layers, prefer existing deps).

## Working style

- Make the smallest change that works end to end before adding capability. Do not scaffold for hypothetical contributions.
- Keep `manifest.json` and `src/index.ts` in lockstep — every `contributes.*` entry must have a matching handler, and vice versa.
- After any manifest or source change: `pnpm build` → reinstall `dist/` → reload Quill → exercise the contribution. Type errors pass at build time do not prove the plugin runs.
