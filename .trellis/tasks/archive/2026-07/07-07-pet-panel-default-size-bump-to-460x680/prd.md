# Pet panel: size bump to 600×840 + gap=2 + corner attaches to icon (not window)

## Goal

Three panel-positioning fixes from iterative user feedback:

1. **Size**: bump default from 380×520 → 600×840 (user said "还是太小了" after 460×680).
2. **Gap**: tighten `PET_PANEL_GAP` 8 → 2 (user wanted "微缝").
3. **Corner attaches to ICON, not WINDOW** (the key fix): the pet window is
   120×120 but the visible mascot icon is only 88×88, centered with a 16px
   transparent margin on each side (`pet.css:66-71`). The previous
   implementation positioned the panel corner at the pet WINDOW's corner
   minus gap, leaving a 16px+gap visual gap between the panel and the
   visible icon. Fix: position relative to the ICON's bounds, not the
   window's bounds.

## Requirements

- `PET_PANEL_WIDTH` / `PET_PANEL_HEIGHT` in `petPosition.ts`: 380/520 → 600/840.
- `PET_PANEL_GAP` in `petPosition.ts`: 8 → 2.
- New constant `PET_MASCOT_SIZE = 88` in `petPosition.ts` (must match
  `.pet-mascot` width/height in `pet.css:70-71` — add a comment cross-
  referencing the CSS).
- `computePanelPosition` math uses the icon's bounds (offset by
  `(PET_WINDOW_SIZE - PET_MASCOT_SIZE) / 2 = 16` from the window's bounds)
  instead of the window's bounds. The panel corner now sits `PET_PANEL_GAP`
  away from the icon's corner, not the window's corner.
- `pet-panel` window `width`/`height` in `tauri.conf.json`: 380/520 → 600/840.
- `minWidth:280` / `minHeight:360` unchanged.
- Saved panel size path unchanged.

## Acceptance Criteria

- [ ] `PET_PANEL_WIDTH === 600`, `PET_PANEL_HEIGHT === 840`, `PET_PANEL_GAP === 2`,
      `PET_MASCOT_SIZE === 88`.
- [ ] `tauri.conf.json` `pet-panel` window `width: 600, height: 840`.
- [ ] `computePanelPosition` returns a position where the panel's chosen
      corner is exactly `PET_PANEL_GAP` away from the **icon's** corner
      (offset by 16px from the window's corner), for each of the 4 quadrants.
- [ ] Tests updated to assert icon-corner attachment (not window-corner).
- [ ] Spec doc + stale comments updated.

## Out of Scope

- Min size, resize behavior, saved-size path — unchanged.
- CSS mascot size (88px) — unchanged; `PET_MASCOT_SIZE` is the TS mirror.

## Technical Notes

- Mascot CSS: `apps/desktop/src/components/pet/pet.css:66-71` — `.pet-mascot`
  is 88×88 centered in the 120×120 `.pet-root` window. Inset = 16px.
- Constants: `apps/desktop/src/components/pet/petPosition.ts:121-130`.
- Tauri config: `apps/desktop/src-tauri/tauri.conf.json:59-62`.
- Algorithm: `computePanelPosition` in `petPosition.ts` — currently uses
  `petPos.x` / `petPos.y` (window top-left) directly. New math:
  - `iconLeft = petPos.x + (PET_WINDOW_SIZE - PET_MASCOT_SIZE) / 2`
  - `iconRight = petPos.x + (PET_WINDOW_SIZE + PET_MASCOT_SIZE) / 2`
  - `iconTop = petPos.y + (PET_WINDOW_SIZE - PET_MASCOT_SIZE) / 2`
  - `iconBottom = petPos.y + (PET_WINDOW_SIZE + PET_MASCOT_SIZE) / 2`
  - X: pet in right half → panel right = iconLeft - gap; else panel left = iconRight + gap.
  - Y: pet in bottom half → panel bottom = iconTop - gap; else panel top = iconBottom + gap.
- Quadrant detection still uses pet CENTER vs work-area center (unchanged) —
  the icon is centered in the window so pet center == icon center.
