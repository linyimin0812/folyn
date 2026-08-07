# Fix PlantUML container icon shows literal SVG source in slash menu

## Goal

When the user opens the `/` slash menu in the Markdown editor, the PlantUML entry shows literal `<svg>...</svg>` text as its icon instead of a rendered icon glyph. Fix it.

## What I already know

- Slash menu UI: `apps/desktop/src/components/editor/SlashMenu.tsx:138` renders `<span ...>{plugin.icon}</span>` — React treats the string as a text node, no SVG parsing.
- All builtin container plugins (`packages/container-plugins/src/plugins/*.tsx`) use emoji strings for `icon` (e.g. `💡`, `📊`, `📄`, `🔽`, `🃏`, `🟦`, `✦`, `📝`, `⊞`). This is the established convention.
- PlantUML plugin manifest (`plugins/quill-plugin-plantuml/manifest.json`) sets the container `icon` to a raw SVG string `"<svg width=\"16\" ...>...</svg>"` — taken from the file-type handler's `makeIcon()` which returns a React element (correct for `FileTypeHandler.icon: ReactNode`, wrong for `ContainerContribution.icon: string`).
- `FeatureContribution.icon` (a different contribution point) explicitly supports raw SVG strings (rendered via `IconFromSvg` host-side). `ContainerContribution.icon` does not — it's rendered as plain text by the slash menu.

## Requirements

- PlantUML container `icon` in `plugins/quill-plugin-plantuml/manifest.json` changed to an emoji, parity with other container plugins.
- Pick an emoji distinct from existing ones (avoid `📊` — used by mermaid). Use a glyph that conveys "diagram/UML" — `📐` (triangular ruler) or `🪴` (potted plant, pun on "plant"). Recommend `📐` for font-coverage safety.

## Acceptance Criteria

- [ ] Opening the `/` slash menu shows the PlantUML entry with a rendered emoji icon (not literal `<svg>...</svg>` text).
- [ ] Other container plugins' icons unaffected.
- [ ] PlantUML file-type handler icon (`.puml` tab icon, rendered via `makeIcon()`) unchanged — it still uses the SVG element.

## Definition of Done

- `pnpm -F quill-plugin-plantuml typecheck` + `build` + `test` green.
- Manual: open `/` slash menu, PlantUML entry shows an emoji.

## Out of Scope

- `extractText` newline-stripping issue in `PlantUmlContainerBlock` (directive body loses `\n` between `@startuml` / body / `@enduml`) — separate bug; if the user reports it explicitly, fix in a follow-up.
- Generalizing `ContainerContribution.icon` to support SVG strings via `IconFromSvg` — YAGNI; emoji convention works.

## Technical Approach

One-line change: `plugins/quill-plugin-plantuml/manifest.json` container `icon` field → emoji string. No source code changes.

## Technical Notes

- `apps/desktop/src/components/editor/SlashMenu.tsx:138` — icon rendering site (don't change; preserve text-render behavior for emoji icons).
- `plugins/quill-plugin-plantuml/manifest.json` — container declaration with the SVG-string icon.
- Builtin emoji icons: see `packages/container-plugins/src/plugins/*.tsx` `icon:` field.
