# Command Palette: Fix Top Border Discontinuity at Corners

## Background

Previous task (`08-18-command-palette-remove-backdrop-and-open-flicker`) dropped the panel's heavy box-shadow to make the palette read as a floating panel rather than a native window. With the shadow gone, a pre-existing geometry issue became visible: the inner `<input>` carries `.dlg-input`'s `background: var(--inp)` (light: `#f4f5f8`, slightly darker than `--panel: #fff`), and `.dlg-body` has `padding: 0` so the input sits flush against the panel's 1px border. The `.dlg` panel uses `border-radius: 14px` but does NOT clip overflow. The input is a rectangle whose top-left and top-right corners extend into the panel's curved corner region, so the input's `--inp` background pokes past the panel's curved border, producing a visible break in the top-left and top-right border arc.

Dark theme is unaffected (`--panel` and `--inp` are both `#0f1219`), so the bug only shows in light mode.

## Requirement

- **R1 — Continuous top border.** The panel's rounded border must read as a single unbroken arc at all four corners; the input's background must not paint outside the panel's rounded shape.
- **R2 — Localized.** Override only at the `CommandPalette` component level via inline style on the panel `<div>`. Do not touch the shared `.dlg` rule (other dialogs depend on `overflow: visible` for shadow/decoration overflow).
- **R3 — No regressions.** Inner scrollable list (`overflow-y-auto` on the list container) must still scroll. Input focus ring, row hover, and selection visuals unchanged.

## Implementation

File: `apps/desktop/src/components/shell/CommandPalette.tsx`.

Add `overflow: 'hidden'` to the existing inline `style` on the panel `<div>` (currently `{ width: 560, maxHeight: '70vh', boxShadow: 'none', animation: 'none' }`). The inner list container keeps its own `overflow-y-auto`, so scrolling is unaffected.

## Verification

- Light mode: open palette with Cmd+P → top-left and top-right border corners are continuous arcs, no `--inp` rectangle poking out.
- Dark mode: unchanged.
- Type a query → list still scrolls inside the panel.
- Click outside → closes (unchanged).
