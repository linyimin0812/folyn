# Command Palette Scroll Fixes

## Problem

The command palette (`apps/desktop/src/components/shell/CommandPalette.tsx`) scrolls erratically in three scenarios:

1. **Hover feedback loop** — moving the mouse across rows causes the list to jump continuously. Root cause: `onMouseEnter` calls `select(idx)` → `selectedIndex` changes → scroll effect runs → content shifts under the fixed cursor → a different row now sits under the cursor → its `mouseenter` fires → repeat.
2. **Typing filter** — typing in the input re-runs the scroll effect (deps include `items.length`) even though the user didn't navigate, so the list jumps as the filter narrows.
3. **Open jumps** — opening the palette can immediately scroll because the cursor happens to sit over a row whose `mouseenter` fires on mount.

A separate latent bug compounds all three: the scroll math uses `row.offsetTop` (body-relative, since the list container is not positioned) compared against `container.scrollTop` (container-relative). The math is wrong in either coordinate system.

## Fix

Two changes in `CommandPalette.tsx`:

1. Replace the manual scroll math with `row.scrollIntoView({ block: 'nearest' })`. Native, correct regardless of `offsetParent`, minimal-scroll semantics already match intent.
2. Track the selection source via a ref (`'keyboard' | 'other'`). Set it to `'keyboard'` in the ArrowUp/ArrowDown handler before `moveSelection`; set it to `'other'` in the mouse `onSelect` wrapper. The scroll effect returns early unless the source is `'keyboard'`.

Net: scroll only happens on keyboard navigation, and only enough to bring the selected row into view.

## Non-Goals

- No change to `commandPaletteStore.ts` behavior (clamp, reset-on-open, etc. all stay).
- No change to row styling, hover affordance, or mouse-click-to-run.
- No change to the `selected` state model — hover still selects (so click and Enter still operate on the hovered row); the scroll effect is just gated.
- No new tests, no new abstractions.

## Verification

Manual: open palette, hover across rows (no jump), type filter (no jump), ArrowUp/Down (row scrolls into view minimally).
