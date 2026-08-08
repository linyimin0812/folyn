# Plugin Settings — Installed Plugins Show Their Icon

## Goal

`Settings → Plugins` rows currently fall back to a first-letter avatar for
most plugins because the row icon is sourced **only** from the top-level
`manifest.icon` field, which the in-repo sample plugins never set. The row
should display the plugin's real icon.

## Root cause

`apps/desktop/src/store/pluginStore.ts` `fetchRows()` reads `manifest.icon`
only. Sample plugins (feature-panel-sample, ai-chat-demo, hello-tool,
markdown-todo, …) express their identity icon inside `contributes.*.icon`
(features / tools / containers / commands / fileTemplates), so the settings
row shows a letter avatar instead of the icon the plugin actually ships.

## Approach

1. **Store** — `apps/desktop/src/store/pluginStore.ts`:
   - Extract a pure `resolveManifestIcon(manifest)` helper: top-level
     `manifest.icon` wins; otherwise scan `contributes` in priority order
     (`features` → `tools` → `containers` → `commands` → `fileTemplates`)
     and return the first non-empty `icon`.
   - `fetchRows()` uses the helper for `icon` and keeps the existing `.svg`
     path → inline-SVG inlining for whatever icon it resolves.
2. **UI** — `apps/desktop/src/components/settings/PluginsSettings.tsx`,
   `renderPluginIcon`:
   - Keep inline-`<svg>` → `IconFromSvg`.
   - Add `hasIcon(name)` → `ThemeIcon` (mirrors `featureAdapter.tsx` — a
     feature icon may be a host `ThemeIcon` name, not just inline SVG).
   - Keep emoji/short-text → text, first-letter → avatar fallbacks.

## Files touched

- `apps/desktop/src/store/pluginStore.ts`
- `apps/desktop/src/components/settings/PluginsSettings.tsx`
- `apps/desktop/src/store/pluginStore.test.ts` (new — unit tests for
  `resolveManifestIcon`)

## Acceptance

- A plugin whose icon lives in `contributes.features[0].icon` (inline SVG)
  shows that icon in its settings row.
- A plugin with only emoji icons (`tools`/`commands`/`containers`) shows the
  emoji.
- A plugin with a top-level `manifest.icon` still shows it (unchanged).
- A plugin with no icon anywhere still renders the first-letter avatar.
- `.svg`-path icons (top-level or contribution) are inlined via
  `read_plugin_file` as before.
- Existing lifecycle buttons / install flows unaffected.
