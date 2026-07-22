# Fix Pet Not at Bottom-Right on Startup (Multi-Monitor)

## Goal

On app startup with `petModeEnabled=true` and no saved position (`petPositionX/Y=-1`), the pet should appear at the bottom-right of the primary monitor's work area. Currently it appears at a wrong position on a secondary monitor.

## Root Cause (confirmed via diagnostic task 07-22-diagnose-pet-not-at-bottom-right-on-startup)

Two independent bugs combine:

### Bug A — launch-restore toggle race

`usePetHostBridge.ts:101-110` (main window) calls `toggle_pet_mode` on launch-restore when `petModeEnabled=true`. `toggle_pet_mode` is a *toggle* (flips current visibility), and its show branch calls `panel.show()` (orderFrontRegardless). This promotes the pet to visible BEFORE `PetApp`'s mount effect runs `set_pet_position`. The pet ends up visible at whatever default frame the OS chooses (observed: `(1584, 920)` on a secondary monitor), not at the computed `(1535, -114)`.

### Bug B — set_pet_position ineffective on visible NSPanel after toggle race

Even though `PetApp.tsx:568` calls `set_pet_position(1535, -114)` (correct coords for primary monitor's bottom-right), `outerPosition()` immediately after returns `(1584, 920)`. `set_pet_position` (Tauri's `WebviewWindow::set_position` → NSWindow `setFrameOrigin`) does not move the panel to the negative-coordinate position on the primary monitor. Strongly suspected: Tauri's top-left → bottom-left Y-flip uses the wrong screen height (e.g., `NSScreen.mainScreen.frame.height`) when the panel is currently on a different monitor than `mainScreen`, or the position is being clamped because the panel's current screen doesn't contain the target point.

### Diagnostic evidence (from `<appData>/pet-launch-diag.json`, 2026-07-22 10:00:28)

```
workArea: { x: -281, y: -1020, width: 1920, height: 1050, scale_factor: 1 }  ← primary monitor at negative global coords
saved:    { x: -1, y: -1 }
resolved: { x: 1535, y: -114 }    ← correct math: bottom-right of workArea
actual:   { x: 1584, y: 920 }     ← on a different monitor, mismatch=true
```

## Requirements

- Launch-restore must not race with PetApp's mount-time position+show. Specifically: when `petModeEnabled=true` on launch, the launch-restore path must not make the pet visible before `PetApp` has set its position.
- After `PetApp`'s mount-time `show()`, `set_pet_position` must be re-applied so any frame reset by `show()` is corrected (mirrors the existing post-show `set_pet_size` re-assert at `PetApp.tsx:601-611`).
- The fix must work in the user's multi-monitor setup where the primary monitor is at `(-281, -1020)` in global coords.
- No regression for the single-monitor case.
- No regression for the saved-position case (`petPositionX/Y >= 0`).
- No regression for `petModeEnabled=false` launch (pet must stay hidden).
- Diagnostic patches (task 07-22-diagnose-pet-not-at-bottom-right-on-startup) are removed once the fix lands.

## Acceptance Criteria

- [ ] Cold launch with `petModeEnabled=true` + `petPositionX/Y=-1` + multi-monitor (primary at negative coords): pet appears at bottom-right of primary monitor's work area.
- [ ] Cold launch with `petModeEnabled=false`: pet does NOT appear.
- [ ] Cold launch with saved position: pet appears at saved position (clamped to work area).
- [ ] `toggle_pet_mode` from settings tab still toggles visibility correctly (the toggle semantics are preserved for the user-driven toggle path).
- [ ] `cargo check` + frontend typecheck + `petPosition.test.ts` + `petStore.test.ts` green.
- [ ] Diagnostic patches removed: `apps/desktop/src/utils/petDiag.ts` deleted, imports/calls in `PetApp.tsx` / `usePetHostBridge.ts` reverted.
- [ ] `<appData>/pet-launch-diag.json` no longer written on launch.

## Technical Approach

### Fix A — Idempotent launch-restore (Bug A)

Add a new Rust command `show_pet_if_hidden` in `apps/desktop/src-tauri/src/commands/pet_commands.rs`:
- Reads `pet.is_visible()`.
- If already visible: no-op (returns current visibility). This is the key difference from `toggle_pet_mode` — it never hides.
- If hidden: calls `panel.show()` (orderFrontRegardless) via `run_on_main_thread`, mirroring `toggle_pet_mode`'s show branch.

Register it in `lib.rs::invoke_handler`. Add capability entry for the main window label.

Replace `invoke('toggle_pet_mode')` with `invoke('show_pet_if_hidden')` in `usePetHostBridge.ts:106`. The `petModeEnabled=false` branch stays a no-op (no hide needed — pet starts hidden).

`toggle_pet_mode` stays intact for `PetSettings.tsx` and `petHostRouter.ts` — those are user-driven toggle paths where toggle semantics are correct.

### Fix B — Post-show position re-assert (Bug B)

In `PetApp.tsx` mount effect, after `await getCurrentWindow().show()` (around line 596), re-invoke `set_pet_position` with the same `physicalX` / `physicalY`. Mirrors the existing `set_pet_size` post-show re-assert pattern (lines 601-611). The re-assert handles the case where `show()` resets the frame or the pre-show `set_position` was deferred on a hidden NSWindow.

If `outerPosition()` still mismatches after the re-assert, log a warning (existing pattern) — but don't loop.

### Cleanup — Remove diagnostic patches

- Delete `apps/desktop/src/utils/petDiag.ts`.
- Revert `import { writePetDiag } ...` in `PetApp.tsx`.
- Revert all `writePetDiag({ ... })` calls in `PetApp.tsx` (5 call sites: mount-start, pre-set-position, set-position-failed, post-set-position, after-show, after-topmost).
- Revert `import { writePetDiagToFile } ...` and listener in `usePetHostBridge.ts`.
- Delete `<appData>/pet-launch-diag.json` if present (user can do manually; optional).

## Out of Scope

- Investigating whether Tauri's `WebviewWindow::set_position` has a real Y-flip bug on NSPanel across monitors — the post-show re-assert is a belt-and-suspenders workaround; deeper fix would require patching tauri-nspanel or Tauri core, which is out of scope.
- Tray icon / hover-display (previously rejected by user).
- Other pet windows (`pet-panel`, `pet-bubble`, `voice-orb`) — they don't have the toggle race (no launch-restore call).

## Technical Notes

- `apps/desktop/src/hooks/usePetHostBridge.ts:99-115` — launch-restore path.
- `apps/desktop/src/components/pet/PetApp.tsx:479-630` — mount effect (position + show).
- `apps/desktop/src-tauri/src/commands/pet_commands.rs:124-179` — `toggle_pet_mode` (reference for `show_pet_if_hidden` impl).
- `apps/desktop/src-tauri/src/commands/pet_commands.rs:883-925` — `pet_set_topmost_level` (uncommitted, related task — leave alone).
- `.trellis/tasks/07-22-diagnose-pet-not-at-bottom-right-on-startup/` — diagnostic task (closed by the cleanup portion of this task).
