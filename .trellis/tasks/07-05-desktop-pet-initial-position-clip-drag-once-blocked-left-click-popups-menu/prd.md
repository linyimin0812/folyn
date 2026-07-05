# Desktop pet: initial position clip, drag-once-blocked, left-click popups menu

## Goal

Fix three regressions in the macOS desktop-pet MVP that survived the previous fix (commit 8d94f03):

1. **Bug 1**: Pet is still partially clipped when shown at the bottom-right default position.
2. **Bug 2**: After dragging the pet once, it cannot be dragged again.
3. **Bug 3**: Left-click on the pet does nothing — user expects it to pop up the same native quick-action menu that right-click does.

## What I already know

- Pet window: 120×120 px, transparent, alwaysOnTop, skipTaskbar, `visible:false` at creation (tauri.conf.json:38-53).
- Sprite (ink-drop + quill) occupies the center 80×80; a 20 px transparent border surrounds it (PetApp.tsx:25-28).
- Default position math: `computeDefaultPetPosition` in `apps/desktop/src/components/pet/petPosition.ts` uses `monitor.size.width/height` (physical px) with `PET_RIGHT_MARGIN=20`, `PET_BOTTOM_MARGIN=80`, `PET_MIN_TOP=40`.
- Initial restore (PetApp.tsx:262-291): if `petPositionX/Y >= 0` (saved), invoke `set_pet_position` with the saved value, NO clamping. Otherwise compute default and persist it.
- Drag: `handlePointerDown` (PetApp.tsx:64-143) records pre-drag window position, sets `draggingRef=true`, calls `startDragging()` (native, blocks until mouseup), then `draggingRef=false`, proactively sets `setIgnoreCursorEvents(false)`, compares pre/post position to decide click vs drag.
- Click-through probe (PetApp.tsx:156-221) runs every 60 ms: invokes `pet_cursor_probe`, computes whether cursor is over the 80×80 sprite (in window-relative coords); if not and not dragging, sets `setIgnoreCursorEvents(true)` so transparent regions pass clicks through to apps behind.
- Left-click current behavior (PetApp.tsx:127-131): if `wasClick` (movement < 5 px), `setState('click')` and `emitAction('show-main')` → App.tsx:185-187 focuses the main window. Does NOT pop up the quick menu.
- Right-click (PetApp.tsx:145-153): `openPetContextMenu()` → invokes `pet_show_context_menu` (commands.rs:525-578) → native popup → selection fires `on_menu_event` (lib.rs:60-65) → emits `pet://menu-action` → App.tsx:222-224 dispatches.
- `settingsStore.petPositionX/Y` defaults to `-1` (settingsStore.ts:243-244); `setPetPosition(x, y)` just `set({ petPositionX: x, petPositionY: y })` with no validation.

## Assumptions (temporary)

- **Bug 1 root cause**: a previously-saved `petPositionX/Y` from before the margin fix (or from a drag to the bottom) is restored without clamping, so the persisted off-screen value overrides the new default-margin math. Possibly compounded by Dock-on-right or taller Dock configurations that `PET_BOTTOM_MARGIN=80` doesn't clear.
- **Bug 2 root cause**: after `startDragging()` returns, the next probe tick (within 60 ms) sees the cursor outside the 80×80 sprite (e.g. in the 20 px transparent border, which is likely if the user dragged by moving the cursor to the window edge) and flips `setIgnoreCursorEvents(true)` again. The "proactive re-enable" in PetApp.tsx:102-110 races with the probe and loses. The next click then passes through the window, so `handlePointerDown` never fires.
- **Bug 3**: expected behavior is left-click → pop up the same native quick-action menu as right-click (user confirmed). Current left-click only emits `show-main`. Need to change left-click to call `openPetContextMenu()` (or both?).

## Decisions (so far)

- **Bug 1**: investigate BOTH root causes — (a) clamp saved position on restore + fall back to default if still off-screen, AND (b) query macOS work area (`NSScreen.visibleFrame`, excludes Dock + menu bar) via a new Rust command for a robust default position. (User chose "both".)
- **Bug 2**: cancel click-through entirely. Remove the `setIgnoreCursorEvents(true)` toggling from the probe; keep the probe only for fullscreen detection. The whole 120×120 window stays mouse-event-active, so transparent border regions no longer pass clicks through to apps behind. Trade-off: the 20 px transparent border eats clicks (small UX cost), but drag + click become 100% reliable. (User chose this.)

## Decisions (so far)

- **Bug 1**: investigate BOTH root causes — (a) clamp saved position on restore + fall back to default if still off-screen, AND (b) query macOS work area (`NSScreen.visibleFrame`, excludes Dock + menu bar) via a new Rust command for a robust default position. (User chose "both".)
- **Bug 2**: cancel click-through entirely. Remove the `setIgnoreCursorEvents(true)` toggling from the probe; keep the probe only for fullscreen detection. The whole 120×120 window stays mouse-event-active, so transparent border regions no longer pass clicks through to apps behind. Trade-off: the 20 px transparent border eats clicks (small UX cost), but drag + click become 100% reliable. (User chose this.)
- **Bug 3**: left-click on the sprite (movement < 5 px) opens the native quick-action menu only — do NOT emit `show-main`. The menu already contains a "Show Main Window" entry, so users wanting focus can pick that. (User chose this.)

## Open Questions

- None blocking implementation.

## Requirements

- (R1) Pet's initial position on first launch is fully on-screen, computed from the macOS work area (`NSScreen.visibleFrame`, excludes Dock + menu bar) — not the full monitor size.
- (R2) Pet's restored position from `settingsStore` is clamped to the current monitor's on-screen rect; if the saved position would still clip after clamping (e.g. saved on a different monitor), fall back to the default and persist the corrected value.
- (R3) The click-through `setIgnoreCursorEvents(true)` path is removed. The probe continues to run only for fullscreen detection (hide pet while main window is fullscreen).
- (R4) After dragging the pet once, the user can immediately drag it again — no grace period, no cursor-wiggle needed — because `setIgnoreCursorEvents` is no longer toggled.
- (R5) Left-click (movement < 5 px) on the sprite opens the native quick-action menu at the cursor, identical to right-click. No `show-main` emission on left-click.

## Acceptance Criteria

- [x] AC1: code-level — `computeDefaultPetPosition` now takes the work-area size (post-Dock, post-menu-bar) returned by `pet_get_work_area` (Rust `NSScreen.visibleFrame`); default position math + unit tests updated. **Manual verification pending** (run `pnpm tauri dev`).
- [x] AC2: code-level — `clampPetPosition` helper + test coverage for off-right/bottom/top/left, degenerate work area, non-zero origin. Initial restore persists clamped value when saved was off-screen. **Manual verification pending**.
- [x] AC3: code-level — `setIgnoreCursorEvents` toggling removed; `ignoreRef` removed; `handlePointerDown` no longer races with the probe. **Manual verification pending**.
- [x] AC4: code-level — left-click (wasClick) now calls `openPetContextMenu()` instead of `emitAction('show-main')`. **Manual verification pending**.
- [x] AC5: code-level — right-click path unchanged (`handleContextMenu` still calls `openPetContextMenu()`).
- [x] AC6: code-level — fullscreen detection path preserved in the simplified probe.
- [ ] Manual smoke (user runs `pnpm tauri dev`): verify all 3 bugs are gone.

## Definition of Done

- Tests added/updated:
  - `petPosition.test.ts`: extend for `clampPetPosition` helper (saved off-screen → clamped on-screen).
  - Manual smoke for drag/click-menu/fullscreen (involve native window APIs).
- `pnpm typecheck` / `cargo check` / lint green.
- Spec `tauri-window-patterns.md` updated: click-through section replaced with "no click-through; whole window receives events" + work-area command note.
- Manual smoke: launch app, enable pet mode, verify all 3 bugs fixed + no regressions.

## Out of Scope (explicit)

- Multi-monitor handling (position saved on monitor A, restored on monitor B with different size) — best-effort clamp only, no per-monitor migration logic.
- Windows / Linux pet mode (macOS MVP).
- Changing the sprite size (80×80) or window size (120×120).
- Pet animation/state-machine changes beyond what's required for left-click menu.
- Restoring click-through via a finer-grained mechanism (e.g. per-element CSS `pointer-events` with `setIgnoreCursorEvents(false)` always) — explicitly deferred; transparent border eats clicks for now.

## Technical Approach

### Bug 1: default position + clamp on restore

1. **New Rust command** `pet_get_work_area` in `commands.rs`:
   - On macOS, return `NSScreen::mainScreen().visibleFrame` (origin at bottom-left in NS coords — convert to top-left physical px).
   - Returns `{ x, y, width, height }` in physical px, already excluding Dock + menu bar.
   - Cross-platform fallback (non-macOS): return `currentMonitor().size()` + `position()` as a best-effort rect.
2. `petPosition.ts`:
   - Add `clampPetPosition(pos, workArea)` — clamp `x` to `[workArea.x, workArea.x + workArea.width - PET_WINDOW_SIZE]`, `y` to `[workArea.y, workArea.y + workArea.height - PET_WINDOW_SIZE]`.
   - Update `computeDefaultPetPosition` to take the work-area rect (not full monitor size) and compute bottom-right inside it. Margins (`PET_RIGHT_MARGIN`, `PET_BOTTOM_MARGIN`, `PET_MIN_TOP`) become additional insets on top of the work area.
3. `PetApp.tsx` initial restore:
   - Always fetch work area via `pet_get_work_area`.
   - If saved position exists, clamp it to the work area; if clamp would still be invalid (work area smaller than window), fall back to default.
   - Persist the resolved (possibly clamped) position to `settingsStore`.

### Bug 2: remove click-through toggling

1. `PetApp.tsx` probe (`useEffect` at line 156):
   - Drop the `overSprite` / `wantIgnore` / `setIgnoreCursorEvents` logic.
   - Keep the fullscreen detection path (hide/show pet based on `main_fullscreen`).
   - Remove `ignoreRef` and the proactive re-enable block in `handlePointerDown` (lines 102-110) — no longer needed.
2. The probe interval can stay at 60 ms (fullscreen transitions) or relax to e.g. 250 ms (no longer latency-sensitive). Keep 60 ms to avoid scope creep.
3. The `pet_cursor_probe` Rust command stays unchanged (still returns `main_fullscreen`); cursor/window fields become unused on the JS side but are cheap to keep.

### Bug 3: left-click → open menu

1. `PetApp.tsx` `handlePointerDown`:
   - Replace the `if (wasClick) { setState('click'); ... void emitAction('show-main'); }` branch with `if (wasClick) { setState('click'); window.setTimeout(...); void openPetContextMenu(); }`.
   - Import `openPetContextMenu` from `./PetContextMenu` (already imported).
2. The state machine's `'click'` visual state still fires (brief flash). Optional: skip the state change since the menu is the feedback. Keep for now (small).
3. Right-click path unchanged.

### Spec update

- `.trellis/spec/desktop/frontend/tauri-window-patterns.md`:
  - Replace the click-through section: "Pet window does NOT use `setIgnoreCursorEvents` toggling. The whole 120×120 window receives pointer events; the transparent border eats clicks (accepted trade-off for reliable drag/click). Rationale: the prior 60 ms probe + 80×80 hit-test raced with native drag end, causing 'drag-once-then-stuck' (commit history)."
  - Add a note on the work-area command: "Use `pet_get_work_area` (Rust, macOS `NSScreen.visibleFrame`) for default position math; `monitor.size` includes the Dock area and clips the mascot."

## Decision (ADR-lite)

**Context**: Three pet bugs survived the previous fix (8d94f03). The click-through probe + 80×80 sprite hit-test created a race with native drag end; saved positions weren't clamped on restore so old off-screen values overrode the new margin math; left-click's `show-main` action didn't match the user's expectation of a quick-action menu.

**Decision**:
1. Bug 1 — clamp saved positions on restore + use macOS work area (`NSScreen.visibleFrame`) for the default.
2. Bug 2 — remove click-through entirely; whole window receives events.
3. Bug 3 — left-click opens the native quick-action menu, no `show-main`.

**Consequences**:
- + Drag and click become reliable (no probe race).
- + Default position is robust to Dock size/position.
- - Transparent border (20 px) no longer passes clicks through to apps behind the pet — minor UX regression.
- + Adds a new Rust command `pet_get_work_area` (macOS-specific; cross-platform fallback returns full monitor rect).

## Technical Notes

- Files:
  - `apps/desktop/src/components/pet/PetApp.tsx` — handlePointerDown (left-click → menu), probe (drop click-through), initial restore (clamp).
  - `apps/desktop/src/components/pet/petPosition.ts` — `clampPetPosition`, `computeDefaultPetPosition` taking work-area rect.
  - `apps/desktop/src/components/pet/petPosition.test.ts` — extend tests.
  - `apps/desktop/src-tauri/src/commands.rs` — `pet_get_work_area` (macOS `NSWindow`/`NSScreen` FFI via `cocoa`/`objc` crates, or `tauri::window` helpers if available).
  - `apps/desktop/src-tauri/src/lib.rs` — register `pet_get_work_area` in `invoke_handler`.
  - `.trellis/spec/desktop/frontend/tauri-window-patterns.md` — spec update.
- Spec: `.trellis/spec/desktop/frontend/tauri-window-patterns.md` documents the physical-px contract.
- Prior fix: commit 8d94f03 — insufficient; this task supersedes parts of it.
- macOS `NSScreen.visibleFrame` returns NSRect in bottom-left-origin coords; convert to top-left physical px to match Tauri's `PhysicalPosition`.
