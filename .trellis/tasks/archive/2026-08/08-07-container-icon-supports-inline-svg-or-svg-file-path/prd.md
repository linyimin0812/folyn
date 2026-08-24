# Container icon: support inline SVG or SVG file path

## Goal

Generalize `ContainerContribution.icon` so plugin authors can ship a container directive icon as either:
- an emoji (current convention, keep working), OR
- an inline `<svg>...</svg>` string (rendered via host's `IconFromSvg`), OR
- an SVG file path (resolved by the host).

Parity with `FeatureContribution.icon` which already supports inline-SVG-string OR ThemeIcon-name (resolved against host `assets/icons/*.svg`).

## What I already know

- `apps/desktop/src/components/icons/IconFromSvg.tsx` — existing host component that normalizes a raw `<svg>...</svg>` string (size injection) and inlines via `dangerouslySetInnerHTML`. Already used by `featureAdapter.tsx` for `FeatureContribution.icon`.
- `apps/desktop/src/services/plugin-host/featureAdapter.tsx:44-52` — `renderIcon(icon)` pattern: if `icon.trim().startsWith('<svg')` → `<IconFromSvg>`, else → `<ThemeIcon name={icon}>` (resolves against host `assets/icons/*.svg`).
- `apps/desktop/src/components/editor/SlashMenu.tsx:138` — currently renders `{plugin.icon}` as plain text. This is the bug surface; container icons never had the SVG/ThemeIcon handling that feature icons have.
- `ContainerContribution.icon: string` in `packages/plugin-sdk/src/types.ts` — the SDK type. No constraint on what string shape.
- Builtin container plugins (`packages/container-plugins/src/plugins/*.tsx`) all use emoji for `icon`. So the existing convention is preserved as long as the new render path falls through to text for emoji strings.
- PlantUML plugin manifest currently uses `📐` emoji (the just-shipped fix). Reverting to an inline `<svg>` string OR an SVG file path is the user's intended use case.
- Trusted plugins load via blob URL (`trustedLoader.ts:6-7`); their bundle assets aren't directly fetchable from the host realm by relative path.

## Open Questions

- ~~(Q1) "SVG file path" — relative to plugin origin (need host-side fetch from plugin bundle), OR a ThemeIcon name resolved against host `assets/icons/*.svg` (existing `FeatureContribution.icon` behavior)?~~ **Resolved**: plugin-bundled SVG file path — host calls `readPluginFile(manifest.id, path)` at activate time. Matches the user's literal request and reuses the existing Tauri command (`trustedLoader.ts:218`).

## Requirements

- `ContainerContribution.icon` accepts three forms (detected by prefix/suffix):
  - **Inline SVG string** (`<svg>...</svg>`) → rendered via host's `IconFromSvg` directly.
  - **`.svg` file path** (relative to the plugin's install directory) → host calls `readPluginFile(manifest.id, path)` at activate, gets the SVG string, stores it resolved in the registry.
  - **Emoji / short string** (fallback) → rendered as plain text (preserves the existing builtin convention).
- `SlashMenu.tsx` renders the icon via a small dispatcher: `<svg`-prefix → `IconFromSvg`; else → text span.
- `registerPluginContainers` becomes async: pre-resolves `.svg` paths before registering the `ContainerPlugin` so the registry only holds resolved strings.
- `trustedLoader.activate` awaits the now-async `registerPluginContainers`.
- SDK docstring for `ContainerContribution.icon` updated to document the three forms.
- PlantUML plugin manifest reverted from the `📐` emoji back to the inline SVG string (the original two-rects-arrow SVG) — exercises the inline-SVG path. The file-path path is exercised by an additional optional `assets/container-icon.svg` if we choose to demonstrate it; default to inline-SVG for the smaller diff.

## Acceptance Criteria

- [ ] A container `icon: "<svg>...</svg>"` renders as a real SVG glyph in the slash menu (not literal text).
- [ ] A container `icon: "assets/diagram.svg"` (file path) — host reads the file at activate, renders as real SVG glyph. Missing file → warn + fall back to empty (no crash, no literal text).
- [ ] A container `icon: "💡"` (emoji) still renders as text glyph (no regression).
- [ ] All builtin container plugin icons still render correctly.
- [ ] PlantUML plugin manifest's container `icon` is the inline SVG string (revert of the previous emoji fix); slash menu shows the SVG glyph.

## Definition of Done

- `pnpm -F @folyn/plugin-sdk typecheck` + `build` green.
- `pnpm -F @folyn/desktop typecheck` + lint green.
- `pnpm -F folyn-plugin-plantuml typecheck` + `build` + `test` green.
- New unit test: `registerPluginContainers` with a `.svg`-path icon resolves via `readPluginFile` mock and stores the resolved SVG string; missing file → fallback.
- New unit test (or extend existing): `SlashMenu` renders inline-SVG icon via `IconFromSvg` (snapshot or DOM assertion on the `<span>` from `IconFromSvg`).
- Manual: open `/` slash menu, PlantUML entry shows the SVG glyph.

## Technical Approach

**Icon dispatcher in `SlashMenu.tsx`** (small inline helper, no new file unless reuse makes sense):

```tsx
function renderContainerIcon(icon: string): ReactNode {
  if (icon.trim().startsWith('<svg')) {
    return <IconFromSvg svg={icon} size={16} />;
  }
  return <span>{icon}</span>;
}
```

(If `featureAdapter.tsx:44` `renderIcon` is extracted to a shared util, reuse it. Otherwise inline.)

**`registerPluginContainers` async resolution**:

```ts
async function resolveIcon(manifest, icon): Promise<string> {
  if (icon.endsWith('.svg')) {
    try { return await readPluginFile(manifest.id, icon); }
    catch (e) { console.warn(...); return ''; }
  }
  return icon; // emoji or inline SVG string
}

export async function registerPluginContainers(manifest, module): Promise<Disposable> {
  const containers = manifest.contributes?.containers ?? [];
  const resolved = await Promise.all(containers.map(async (c) => ({
    ...c,
    icon: await resolveIcon(manifest, c.icon ?? ''),
  })));
  // register `resolved` into ContainerRegistry as before
}
```

`trustedLoader.activate` change: `const containerDisp = await registerPluginContainers(manifest, module);` — push into `adapterDisposables` after.

## Out of Scope

- ThemeIcon-name resolution for container icons (host `assets/icons/*.svg` lookup). The user picked option 2 (plugin-bundled file path). Emoji + inline-SVG + plugin-bundled-`.svg`-path cover the use cases.
- Non-SVG image formats (`.png`, `.jpg`). The user said SVG.
- Per-container icon theming (light/dark variants). YAGNI.
- Caching `readPluginFile` results across activate/deactivate cycles. Activate is rare; no cache needed.

## Technical Notes

- `apps/desktop/src/components/icons/IconFromSvg.tsx` — reuse for inline SVG strings.
- `apps/desktop/src/services/plugin-host/featureAdapter.tsx:44` — `renderIcon()` is the canonical dispatcher; consider extracting to a shared util in `apps/desktop/src/components/icons/` so both feature and container adapters share it.
- `apps/desktop/src/components/editor/SlashMenu.tsx:138` — the rendering site to change.
- `apps/desktop/src/services/plugin-host/contributionAdapters.ts` — `registerPluginContainers` to become async.
- `apps/desktop/src/services/plugin-host/trustedLoader.ts:118` — await the async adapter.
- `apps/desktop/src/services/plugin-host/trustedLoader.ts:218` — `readPluginFile(id, path)` Tauri command for fetching SVG file content from the plugin install dir.
- `packages/plugin-sdk/src/types.ts` — `ContainerContribution.icon` docstring update.
- `plugins/folyn-plugin-plantuml/manifest.json` — revert `icon` to the inline SVG string.
- `packages/create-folyn-plugin/template/manifest.json` — doc-only (no change needed; the existing empty `containers: []` is fine).
- Docs: `docs/plugin-development.md` + `docs/plugin-development.zh.md` — note the three icon forms in the `### containers` section.
