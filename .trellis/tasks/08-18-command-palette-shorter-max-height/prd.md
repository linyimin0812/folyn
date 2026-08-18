# Command Palette: Shorter Max Height

## Background

Previous task pinned the panel's top edge at `12vh` from the viewport top. With `maxHeight: 70vh` still on the panel and `calc(70vh - 48px)` on the inner list, the palette grows very tall for empty-query (50 files) or wide matches — the user flagged it as "面板弹窗太高了". Pinning the top means the panel only grows downward, so a tall panel eats more vertical space than it did when centered.

## Requirement

- **R1 — Shorter panel.** Reduce panel `maxHeight` from `70vh` to `50vh` and inner list `maxHeight` from `calc(70vh - 48px)` to `calc(50vh - 48px)` so the panel stays compact even with many results. Inner list scrolls when results exceed the new cap.
- **R2 — Top offset unchanged.** `12vh` top offset stays so the panel's top edge stays pinned (previous task's behavior preserved).
- **R3 — Localized.** Inline style only on `CommandPalette.tsx`. No change to shared CSS.

## Implementation

File: `apps/desktop/src/components/shell/CommandPalette.tsx`.

Two inline-style edits:
1. Panel `<div>` `style`: change `maxHeight: '70vh'` → `maxHeight: '50vh'`.
2. Inner list container `style`: change `maxHeight: 'calc(70vh - 48px)'` → `maxHeight: 'calc(50vh - 48px)'`.

## Verification

- Open palette with empty query (up to 50 files) → panel caps at ~50vh, list scrolls if results overflow.
- Top edge still at 12vh.
- Bottom edge max at 12vh + 50vh = 62vh.
