# table cell bg color submenu

## Goal

Replace the flat "Background color" item in the table cell right-click
menu with a submenu that shows a palette of 10 common colors plus a
"Custom color…" entry at the bottom that opens the native color
picker. Lets users pick a cell bg in one or two clicks without
waiting on the OS picker.

## Requirements

- Cell right-click menu exposes "Background color" with a submenu arrow.
- Submenu shows 10 swatches in a grid: white, light gray, mid gray,
  dark gray, black, red, orange, yellow, green, blue, purple (see
  Technical Notes for concrete hex).
- Clicking a swatch applies the color via
  `editor.chain().focus().setCellAttribute('background', value).run()`
  and closes all menus.
- "Custom color…" item at the bottom of the submenu opens the existing
  native `<input type="color">` picker (the `bgPicker` popover already
  in `RichTextEditor.tsx`).
- "Clear background" stays as a top-level item (same level as
  "Background color"). No change to its behavior.
- Submenu opens to the side of the parent item, flipping to fit the
  viewport.

## Acceptance Criteria

- [ ] Right-click a cell → "Background color" shows submenu arrow.
- [ ] Submenu shows 10 color swatches.
- [ ] Click a swatch → cell bg changes, menus close.
- [ ] "Custom color…" opens native picker; selecting a color applies
      and closes all menus.
- [ ] "Clear background" still works as a top-level item.
- [ ] Submenu flips to the left when there's no room on the right.
- [ ] Submenu closes on click-outside / Esc / parent menu close.

## Definition of Done

- Tests added/updated: at least a render test that the submenu opens
  and a swatch click calls `setCellAttribute` with the right value.
- Lint / typecheck / CI green.
- i18n key for "Custom color…" label added to en + zh `editor.json`.

## Technical Approach

- **Extend `TableMenuItem`** with an optional `submenu?: TableMenuItem[]`
  field. `TableMenu` renders items with a submenu as a hover/click
  trigger; on hover (with a small delay to allow diagonal mouse travel)
  it renders a nested `TableMenu`-style dropdown to the side. Close
  cascade: closing the parent closes the child.
- **Background color item** becomes a submenu item in `cellCtxItems`:
  swatches as flat items (label = hex, no icon, swatch rendered via a
  new `swatch?: string` field on `TableMenuItem`), then a separator,
  then "Custom color…" which sets `bgPicker` state.
- **"Clear background"** stays a top-level item in `cellCtxItems`,
  unchanged.
- **Palette** (concrete hex, not CSS vars — `setCellAttribute` stores
  the literal value, CSS vars would persist as `var(--acc)` and break
  if the theme changes):
  - Neutrals: `#ffffff`, `#f4f4f5`, `#a1a1aa`, `#52525b`, `#000000`
  - Hues: `#ef4444` (red), `#f97316` (orange), `#facc15` (yellow),
    `#22c55e` (green), `#3b82f6` (blue), `#a855f7` (purple)
- **Viewport flip**: reuse the existing `TableMenu` ref callback
  pattern — measure the submenu rect, flip left if no room on right.

## Out of Scope

- Custom palette persistence (remembering user's recent colors).
- Gradient / pattern backgrounds.
- Per-row or per-column bg (cell-level only).
- Submenu keyboard navigation (arrow keys) — defer to a follow-up.

## Technical Notes

- `RichTextEditor.tsx` — `cellCtxItems`, `bgPicker` state,
  `ctxMenuPosRef`, `pendingSnapshot` for cell selection.
- `TableMenu.tsx` — needs `submenu` + `swatch` support.
- `RichTextTableCell.ts` — `background` attr already wired; no change.
- i18n: `apps/desktop/src/i18n/locales/{en,zh}/editor.json` — add
  `editor:table.cellMenu.customColor` key.
- Existing palette reference: `COLUMN_COLOR_PALETTE` in
  `apps/desktop/src/features/schedule/types.ts` uses CSS vars — we use
  concrete hex instead (see Technical Approach).
