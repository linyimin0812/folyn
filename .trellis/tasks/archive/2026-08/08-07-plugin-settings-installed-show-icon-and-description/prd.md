# Plugin Settings — Installed Plugins Show Icon & Description

## Goal

In `Settings → Plugins`, each installed-plugin row currently shows only `name / version / state badge / tier badge / trusted badge / id / action buttons`. Add the plugin's **icon** and **description** to the row, sourced from the plugin's `manifest.json`.

## Non-goals (deferred)

- Manifest field validation — `validateManifest` already accepts unknown top-level keys; adding optional `icon?`/`description?` to the SDK type is purely DX-typing, not enforcement.

## Approach (lazy ladder)

1. **SDK type** — add `icon?: string` and `description?: string` to `PluginManifest` in `packages/plugin-sdk/src/types.ts`. Same semantics as `ContainerContribution.icon` (inline SVG / `.svg` path / emoji). Forward-compatible — plugin authors can opt in.

2. **Store** — `apps/desktop/src/store/pluginStore.ts`:
   - Extend `PluginRow` with `icon?: string` and `description?: string`.
   - In `fetchRows()`, after pulling entries, `Promise.all` over each entry to fetch its manifest and pull `icon`/`description`. Best-effort: a manifest-read failure leaves the row with `icon/description` undefined (existing row data still renders). Refresh is rare and plugin count is small, so the N extra IPCs are acceptable.
   - If `icon` is a `.svg` file path (ends with `.svg`, doesn't start with `<svg`), fetch its content via `read_plugin_file(id, icon)` and replace `icon` with the SVG string so the UI can render it inline. Failed fetch → leave `icon` undefined (falls back to first-letter avatar in UI).

3. **UI** — `apps/desktop/src/components/settings/PluginsSettings.tsx`, `PluginRowCard`:
   - Insert an icon slot at the left of the name/version/badges block.
   - Render logic (reuse the precedent in `services/plugin-host/featureAdapter.tsx:44–52`):
     - `icon && icon.trim().startsWith('<svg')` → `<IconFromSvg svg={icon} size={20} />`
     - else if `icon` is non-empty → render as text (emoji/short string) in a fixed-size box
     - else → fallback to first letter of `entry.name` uppercased, in a styled box
   - Add description line below the id line (or wrap id + description together). Truncate to one line with `truncate`; show full text on hover via `title` attr.
   - Layout: the icon slot is `shrink-0`, fixed `20×20` (or `24×24` to match the rest of the settings density). The existing flex layout already supports this — just prepend the icon container.

## Files touched

- `packages/plugin-sdk/src/types.ts` — add 2 optional fields to `PluginManifest`.
- `apps/desktop/src/store/pluginStore.ts` — extend `PluginRow`, parallel-fetch manifest in `fetchRows`.
- `apps/desktop/src/components/settings/PluginsSettings.tsx` — add icon + description in `PluginRowCard`.
- i18n: optional. If we want a "no description" placeholder, add `settings:plugins.noDescription`. Default: just leave the description line empty when absent (no placeholder text). Lazy.

## Acceptance

- A plugin with `icon` + `description` in its manifest shows both in its settings row.
- A plugin without either still renders cleanly (icon falls back to first-letter avatar, description line omitted).
- Refresh, install-from-folder, approve, activate/deactivate, uninstall all still work.
- No Rust rebuild required — Rust `PluginEntry` and `plugin_commands.rs` unchanged.

## Test plan

Manual:
1. `pnpm dev` (or whatever the desktop dev script is).
2. Install a plugin whose manifest has `icon` + `description` (e.g. an example plugin updated for this).
3. Install a plugin whose manifest has neither.
4. Verify both render correctly; verify lifecycle buttons still work.

No new unit tests — the logic is small and pure rendering; existing Rust tests cover the manifest field round-trip surface (and we're not touching Rust).
