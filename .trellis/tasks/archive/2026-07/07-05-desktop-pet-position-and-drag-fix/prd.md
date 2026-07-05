# Desktop Pet Position & Drag Fix

## Goal

Fix two bugs found when manually verifying the desktop pet after the visibility fix (commit
`943e6f2`): the pet is partially clipped at the bottom-right (behind the macOS Dock), and the
pet cannot be dragged.

## Root Causes (confirmed by code inspection)

### Bug A — Pet clipped at bottom-right (behind Dock)
* `apps/desktop/src/components/pet/petPosition.ts::computeDefaultPetPosition` uses
  `PET_DEFAULT_MARGIN = 20` for BOTH right and bottom edges.
* On macOS, `monitor.size.height` (from `currentMonitor()`) is the **full screen height
  including the Dock area** at the bottom (~50–70px) and the menu bar at the top.
* The window is positioned with its bottom edge at `height - 20` — i.e. 20px from the physical
  screen bottom, which is **behind the Dock**. The lower portion of the mascot is occluded.
* There is no accounting for the Dock / menu bar / work-area insets.

### Bug B — Pet cannot be dragged
* `apps/desktop/src/components/pet/PetApp.tsx` click-through probe runs every
  `PROBE_INTERVAL_MS = 250`. On each tick it sets `setIgnoreCursorEvents(true)` when the cursor
  is outside the 80x80 sprite rect.
* On launch the cursor is not over the pet → `ignore=true`. When the user moves the cursor onto
  the sprite, `ignore` is only flipped to `false` on the **next probe tick** — up to 250ms later.
* If the user presses to drag before that tick fires, the `pointerdown` is passed through to the
  desktop (`setIgnoreCursorEvents(true)` makes the whole window non-interactive), so
  `handlePointerDown` never runs and `startDragging()` is never called.
* Bug A compounds this: the visible interactive sprite area is reduced because the lower portion
  is behind the Dock, so the user's clicks are even more likely to miss the live hit region.

## Requirements

* R-F1. The default pet position places the ENTIRE 120x120 window fully on-screen, clear of the
  macOS Dock (bottom) and menu bar (top). Use a larger bottom margin (≈80px) than the right
  margin (≈20px), so the Dock does not occlude the mascot.
* R-F2. The pet must be draggable immediately when the user presses the mascot — no perceptible
  delay. The click-through polling must not block drag initiation.
* R-F3. Click-through on transparent regions (R6 of the original feature) must still work —
  clicks on transparent areas still pass through to the desktop.
* R-F4. No regression: cargo/tsc/pet tests pass; main editor unchanged; the visibility fix
  (transparency) is preserved.

## Acceptance Criteria

* [ ] AC1: On first launch (no saved position), the entire mascot is visible at the bottom-right
  — no part is hidden behind the Dock.
* [ ] AC2: Moving the cursor onto the mascot and pressing to drag works immediately (no need to
  hover-and-wait); the window follows the cursor.
* [ ] AC3: After dragging, releasing and relaunching restores the last position (consistent
  physical-px units, no jump).
* [ ] AC4: Clicks on the transparent area around the mascot still pass through to the desktop.
* [ ] AC5: `cargo check`, `tsc -b`, pet tests pass.

## Technical Approach

* Bug A fix: in `petPosition.ts`, use **separate** right and bottom margins:
  `PET_RIGHT_MARGIN = 20`, `PET_BOTTOM_MARGIN = 80` (clears the Dock). Update
  `computeDefaultPetPosition` to subtract each margin from the corresponding axis. Update the
  unit tests. Consider also clamping so the window's top edge stays below the menu bar on very
  small screens (y >= 40).
* Bug B fix: reduce `PROBE_INTERVAL_MS` from 250 to ~60ms so `ignore` flips to `false` within
  one frame of the cursor entering the sprite, making drag responsive. (60ms is cheap: the
  probe is a single `invoke` returning 5 numbers.) Additionally, as a belt-and-suspenders
  measure: when `draggingRef.current` is true, the probe already keeps `ignore=false` — keep
  that. Optionally, also set `ignore=false` proactively at the end of a drag so the window stays
  interactive for follow-up clicks.
* No Rust changes expected.

## Out of Scope

* Arbitrary-foreground-app fullscreen detection.
* Position clamp on monitor disconnect.
* Windows/Linux.
* Replacing the polling-based click-through with native hit-testing (deferred; current approach
  is sufficient once the interval is reduced).

## Technical Notes

* Files: `apps/desktop/src/components/pet/petPosition.ts`, `petPosition.test.ts`,
  `apps/desktop/src/components/pet/PetApp.tsx`.
* Spec: `tauri-window-patterns.md` click-through section notes the polling latency trade-off —
  update the "best-effort" note to reflect the reduced interval (60ms) if it mentions 250ms.
