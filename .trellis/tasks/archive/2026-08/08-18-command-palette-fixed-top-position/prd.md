# Command Palette: Pin Top Position While List Shrinks

## Background

`.dlg-overlay` uses `display: flex; align-items: center; justify-content: center` (shared CSS in `apps/desktop/src/index.css`), so the palette panel is vertically centered. When the user types a query and the result list shrinks, the panel's height shrinks symmetrically — both the top and bottom edges move toward the viewport center. The top edge visibly slides DOWN as content reduces, which the user flagged as a bad UX ("整体下移").

The panel currently has `maxHeight: '70vh'` and the inner list has its own `overflow-y-auto` with `maxHeight: 'calc(70vh - 48px)'`, so the panel grows up to 70vh and then scrolls. The fix is to anchor the panel's TOP edge at a fixed viewport offset so the bottom edge absorbs all height changes.

## Requirement

- **R1 — Top edge fixed.** When the result list shrinks (e.g., typing narrows matches), the panel's top edge stays at the same viewport Y. Only the bottom edge moves up as content reduces.
- **R2 — Still fits when tall.** With `maxHeight: 70vh` and a top offset of `12vh`, the panel's max bottom = `12vh + 70vh = 82vh`, leaving `18vh` bottom margin — fine.
- **R3 — Localized.** Override only at the `CommandPalette` overlay via inline style. Do not touch shared `.dlg-overlay` (other dialogs need vertical centering).
- **R4 — Horizontal centering preserved.** Panel stays horizontally centered (`justify-content: center` untouched).

## Implementation

File: `apps/desktop/src/components/shell/CommandPalette.tsx`.

Extend the existing inline `style` on the overlay `<div>` (currently `{ background: 'transparent', backdropFilter: 'none', animation: 'none' }`) to add `alignItems: 'flex-start'` and `paddingTop: '12vh'`. The panel keeps `maxHeight: '70vh'`.

## Verification

- Open palette with empty query → panel top sits ~12vh from viewport top.
- Type a query that narrows to 1 match → panel top stays put, bottom edge rises.
- Clear query → panel grows back downward, top still fixed.
- Many results (>70vh) → inner list scrolls, panel top still at 12vh.
