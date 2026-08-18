# Command Palette: Lower Top Offset

## Background

Panel top is currently pinned at `12vh` (overlay `paddingTop: '12vh'`, set in a previous task). The user wants the panel shifted down a bit. Max bottom with current `50vh` panel cap = `12vh + 50vh = 62vh`; bumping top to `16vh` gives max bottom `16vh + 50vh = 66vh`, still leaves `34vh` bottom margin.

## Requirement

- **R1 — Move panel down.** Bump overlay `paddingTop` from `12vh` to `16vh`. Panel `maxHeight: 50vh` unchanged.
- **R2 — Localized.** Inline style only on `CommandPalette.tsx`.

## Implementation

File: `apps/desktop/src/components/shell/CommandPalette.tsx`.

Change `paddingTop: '12vh'` → `paddingTop: '16vh'` in the overlay inline `style`.

## Verification

- Open palette → panel top now at ~16vh from viewport top.
- Max bottom = 66vh, still fits.
