# PlantUML Plugin Manifest — Add Top-Level `icon` + `description`

## Goal

The folyn plugin SDK now supports optional top-level `icon` and `description` on `PluginManifest` (landed in feat(plugins): show icon and description for installed plugins). The PlantUML plugin's manifest currently only sets `icon` on the `containers[0]` entry — the top-level fields are absent, so the Settings → Plugins row falls back to first-letter avatar and no description line.

Add top-level `icon` and `description` to `/Users/yiminlin/project/folyn-plugin-sdk/folyn-plugin-plantuml/manifest.json` so the plugin renders properly in the new settings UI.

## Approach

- `icon`: reuse the same inline SVG already defined on `containers[0].icon` (the PlantUML container icon — a small box-arrow-box diagram glyph). Keep them in sync; no separate artwork.
- `description`: one-line Chinese summary matching the plugin's purpose: "PlantUML 图表查看器（puml/pu 文件预览、Markdown 代码块、容器块渲染）。"
- No code changes — manifest-only edit. Rebuild is not required for the manifest field to take effect (host reads manifest.json fresh on each refresh), but rebuild the dist bundle is not needed since we're only touching manifest.

## Files touched

- `/Users/yiminlin/project/folyn-plugin-sdk/folyn-plugin-plantuml/manifest.json` — add 2 fields at top level (after `name`/`version` block, before `tier`).

## Acceptance

- Settings → Plugins shows the PlantUML glyph icon instead of the "P" first-letter fallback.
- Description line appears below the id line.
- No behavioral change to the plugin itself (icons in containers/features unchanged).

## Test plan

Manual: open Settings → Plugins in dev (after `pnpm dev` in the folyn repo). If the plugin isn't installed locally, install from folder. Verify icon + description render.
