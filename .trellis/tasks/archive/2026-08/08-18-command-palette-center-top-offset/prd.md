# Command Palette: Center Panel at Max Height

## Background

Panel top is currently pinned at `16vh` (overlay `paddingTop: '16vh'`, `alignItems: 'flex-start'`), with `maxHeight: '50vh'`. Max bottom = `16vh + 50vh = 66vh` — sits in the upper half of the viewport, not visually centered. User wants it visually centered.

Centering via `align-items: center` on the overlay was rejected earlier because the top edge slides as content shrinks. The acceptable middle ground: pin top at `25vh` so a max-height (50vh) panel's vertical center lands at `25vh + 25vh = 50vh` = viewport center. Shorter panels still have a fixed top (no slide), but the typical/max case reads as centered.

## Requirement

- **R1 — Visually centered at max height.** With `maxHeight: 50vh` and `paddingTop: 25vh`, a full-height panel's vertical center = viewport center. Max bottom = `75vh`, leaving 25vh bottom margin.
- **R2 — Top still pinned.** `alignItems: 'flex-start'` stays — top edge doesn't move when content shrinks (previous task's behavior preserved).
- **R3 — Localized.** Inline style only on `CommandPalette.tsx`.

## Implementation

File: `apps/desktop/src/components/shell/CommandPalette.tsx`.

Change `paddingTop: '16vh'` → `paddingTop: '25vh'` in the overlay inline `style`.

## Verification

- Open palette with empty query (up to 50 files → panel hits 50vh cap) → panel visually centered.
- Type a query that narrows results → panel top stays at 25vh, bottom rises (no slide).
