# Pet panel corner attaches to pet icon

## Goal

When the pet-panel window opens next to the desktop pet, the panel should attach
one of its **four corners** to the pet icon (diagonal attachment). The specific
corner is chosen automatically based on which quadrant of the work area the pet
icon currently sits in, so the panel always extends into the quadrant with the
most room.

This replaces the current behavior in `computePanelPosition`
(`apps/desktop/src/components/pet/petPosition.ts:164`), which centers the panel
horizontally on the pet and picks above/below based on vertical room only.

## What I already know

- `computePanelPosition(petPos, workArea)` is the single source of truth for
  first-open panel placement. Pure function, unit-tested.
- Call sites:
  - `apps/desktop/src/components/pet/PetPanelApp.tsx:188` (first-ever open, no
    saved position).
  - `apps/desktop/src/components/pet/PetApp.tsx:144` (probe-based reposition
    on open).
- Saved panel position (`petPanelX/Y` in `settingsStore`) takes precedence on
  subsequent opens — `computePanelPosition` is only the fallback for first
  open OR when the saved value is `-1`. The new algorithm only changes that
  fallback; saved-position path is untouched.
- Existing unit tests at `petPosition.test.ts:118-210` will need to be
  rewritten for the new corner-attachment behavior (current expectations
  assert centered-X + above/below).
- Spec reference: `.trellis/spec/desktop/frontend/tauri-window-patterns.md:451`
  documents the current "clamp so the 380×520 panel stays fully on-screen"
  contract — will need a spec update note.
- Units contract: `computePanelPosition` operates in **logical points**;
  callers do the ÷/× `scale_factor` boundary conversion (see header comment
  in `petPosition.ts:1-21`). New algorithm preserves this.

## Requirements

- The panel's chosen corner touches the pet icon's diagonally-opposite corner
  with `PET_PANEL_GAP` clearance on BOTH axes (panel corner sits at
  `pet corner - gap` along the panel-ward axis, mirroring the existing
  single-axis gap).
- Quadrant selection: based on the pet's position relative to the work area.
  Four cases:
  - Pet in **bottom-right** quadrant → panel's **bottom-right** corner
    attaches to pet's **top-left** corner (panel extends up-left).
  - Pet in **bottom-left** → panel's **bottom-left** corner attaches to
    pet's **top-right** corner (panel extends up-right).
  - Pet in **top-right** → panel's **top-right** corner attaches to pet's
    **bottom-left** corner (panel extends down-left).
  - Pet in **top-left** → panel's **top-left** corner attaches to pet's
    **bottom-right** corner (panel extends down-right).
- No-overlap invariant preserved: panel NEVER covers the pet icon. The gap
  applies on both X and Y axes between the touching corners.
- Overflow tolerance: when the chosen quadrant doesn't have room for the full
  panel, the panel overflows the work-area edge on that side but still does
  NOT overlap the pet. (Matches current "pick side with more room, accept
  overflow" degenerate-case behavior, extended to 2D.)
- Units unchanged: input/output in logical points; caller does scale_factor
  boundary conversion.

## Open Questions

- None — quadrant criterion confirmed as pet-center vs work-area-center.

## Acceptance Criteria

- [ ] `computePanelPosition` returns a position where the panel's chosen
  corner is exactly `PET_PANEL_GAP` away from the pet's opposite corner on
  both axes, for each of the 4 quadrants.
- [ ] Quadrant selection is deterministic and unit-tested for all 4 cases.
- [ ] Panel never overlaps the pet icon (regression test for the degenerate
  tiny-work-area case preserved).
- [ ] Existing call sites (`PetPanelApp.tsx`, `PetApp.tsx`) require no change
  beyond the algorithm swap (signature unchanged).
- [ ] `petPosition.test.ts` `computePanelPosition` block rewritten to assert
  the 4 corner-attachment cases + degenerate no-overlap case.
- [ ] Spec note in `tauri-window-patterns.md` updated to reflect
  corner-attachment (was: "clamp so panel stays fully on-screen").

## Definition of Done

- Tests added/updated (unit tests for all 4 quadrants + degenerate overflow).
- Lint / typecheck / CI green.
- Spec doc `tauri-window-patterns.md` updated if behavior contract changes.
- Manual smoke test on desktop: open panel with pet in each of the 4 screen
  corners, confirm panel corner touches pet icon and panel extends into the
  open quadrant.

## Out of Scope

- Saved panel position path (`petPanelX/Y != -1`) — unchanged, still
  restored as-is with `clampPanelPosition`.
- Panel resize behavior (`clampPanelSize`) — unchanged.
- Pet default position (`computeDefaultPetPosition`) — unchanged.
- Multi-monitor: pet panel currently opens on the same monitor as the pet;
  cross-monitor quadrant logic is out of scope.

## Technical Notes

- Key file: `apps/desktop/src/components/pet/petPosition.ts:164-203`.
- Test file: `apps/desktop/src/components/pet/petPosition.test.ts:118-210`.
- Call sites: `PetPanelApp.tsx:188`, `PetApp.tsx:144`.
- Spec: `.trellis/spec/desktop/frontend/tauri-window-patterns.md` (panel
  position section).
- Constants: `PET_WINDOW_SIZE=120`, `PET_PANEL_WIDTH=380`,
  `PET_PANEL_HEIGHT=520`, `PET_PANEL_GAP=8`.

## Decision (ADR-lite)

**Context**: Two valid criteria for picking the quadrant.

**Decision**: Option A — pet-center vs work-area-center.
- `petCenter.x = petPos.x + PET_WINDOW_SIZE / 2`
- `workArea.center.x = workArea.x + workArea.width / 2`
- Same for Y.
- `petCenter.x >= workArea.center.x` → pet in right half → panel extends left
  (panel's right edge = pet's left edge - gap). Else extends right.
- `petCenter.y >= workArea.center.y` → pet in bottom half → panel extends up
  (panel's bottom edge = pet's top edge - gap). Else extends down.
- Tie-break (petCenter exactly at work-area center): falls into the
  right/bottom half per `>=`, so panel extends up-left (consistent default).

**Consequences**:
- Simple, deterministic, matches "四象限" literally.
- Suboptimal when pet is barely past center but very close to one edge —
  panel extends into the smaller side and may overflow that edge. Accepted
  per requirement (overflow tolerance, no overlap with pet).
- Degenerate tiny work area still satisfies no-overlap invariant: panel
  corner at `pet opposite corner - gap` on both axes guarantees the panel
  bounding box never intersects the pet's `[petX, petX+120] × [petY, petY+120]`
  rect.
