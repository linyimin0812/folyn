# Rename folyn-plugin-plantuml → plantuml-plugin

## Goal

Rename `~/project/folyn-plugin-sdk/folyn-plugin-plantuml/` to `~/project/folyn-plugin-sdk/plantuml-plugin/`. The folder name must match the plugin's manifest `id` (Rust `install_plugin` derives the id from the source folder name and cross-checks against `manifest.id`; mismatch fails install). So the rename is two coupled changes:

1. Directory rename.
2. `manifest.json` `id`: `folyn-plugin-plantuml` → `plantuml-plugin`.
3. Test assertion `test/handler.test.ts:12`: `expect(manifest.id).toBe('folyn-plugin-plantuml')` → `'plantuml-plugin'`.

## Non-goals

- Do NOT change `package.json` `name` (`@folyn/plugin-plantuml`) — that's the npm package name, not the plugin id; it's already fine.
- Do NOT touch `build.mjs`, `tsconfig.json`, `vite.config.ts` — none reference the plugin id.
- Do NOT change the `description` or `icon` fields we just added.

## Approach

```
mv ~/project/folyn-plugin-sdk/folyn-plugin-plantuml ~/project/folyn-plugin-sdk/plantuml-plugin
```

Then edit the renamed dir's `manifest.json` and `test/handler.test.ts`.

## Files touched

- `~/project/folyn-plugin-sdk/folyn-plugin-plantuml/` → `~/project/folyn-plugin-sdk/plantuml-plugin/` (directory rename)
- `~/project/folyn-plugin-sdk/plantuml-plugin/manifest.json` — `id` field
- `~/project/folyn-plugin-sdk/plantuml-plugin/test/handler.test.ts` — line 12 assertion

## Acceptance

- `~/project/folyn-plugin-sdk/plantuml-plugin/manifest.json` exists with `"id": "plantuml-plugin"`.
- `cd plantuml-plugin && pnpm test` passes (20/20).
- The plugin still installs cleanly into `~/.folyn/plugins/plantuml-plugin/` (manual verification deferred — no rebuild needed for manifest id change).

## Test plan

`cd ~/project/folyn-plugin-sdk/plantuml-plugin && pnpm test` — all 20 tests pass.
