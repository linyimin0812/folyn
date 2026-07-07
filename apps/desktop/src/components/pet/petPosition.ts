/**
 * Default-position math for the desktop pet window.
 *
 * Extracted as a pure function so it can be unit-tested without mounting
 * PetApp (which spins up Tauri-window effect loops impractical to test).
 *
 * Units: **logical points** throughout the math in this file. The Rust
 * `pet_get_work_area` command returns `NSScreen.visibleFrame` (logical points
 * on macOS, excludes Dock + menu bar) plus a `scale_factor` field
 * (`backingScaleFactor`, 2.0 on Retina). `set_pet_position` (Rust) and
 * `getCurrentWindow().outerPosition()` operate in **physical pixels**
 * (`PhysicalPosition`). The caller is responsible for the boundary conversion:
 * multiply logical → physical (`* scale_factor`) before calling
 * `set_pet_position` / `setPosition(new PhysicalPosition(...))`, and divide
 * physical → logical (`/ scale_factor`) after reading `outerPosition()` or
 * `pet_cursor_probe`'s `window_x/window_y`. The math functions here never
 * touch `scale_factor` — they stay in logical space where the work-area rect
 * and the window-size/margin constants (which match `tauri.conf.json`'s logical
 * sizes) are directly comparable. See `tauri-window-patterns.md` for the
 * full unit contract.
 */

/** Pet window footprint (matches `tauri.conf.json` `pet` window size). */
export const PET_WINDOW_SIZE = 120;

/**
 * Margins kept between the pet window's edges and the work-area's physical
 * edges so the mascot isn't clipped off-screen. Applied IN ADDITION to the
 * OS work area (`NSScreen.visibleFrame` on macOS, which already excludes the
 * Dock and menu bar) — these are a small safety inset so the mascot doesn't
 * sit flush against the Dock's edge.
 *
 * The bottom margin is intentionally larger than the right: the default
 * position is "bottom-right, slightly lifted" so the mascot clears the
 * Dock + the rounded screen corner with visible breathing room. Users who
 * have dragged the pet still keep their saved position (settingsStore clamp
 * branch); this margin only sets the first-launch default.
 */
export const PET_RIGHT_MARGIN = 8;
export const PET_BOTTOM_MARGIN = 48;

/**
 * Minimum top-edge position so the pet stays below the macOS menu bar on
 * very small / oddly sized monitors. The work area's `y` already accounts
 * for the menu bar, but this floor protects against a work area that
 * underreports the menu-bar height.
 */
export const PET_MIN_TOP = 25;

export interface MonitorSizePhysical {
  width: number;
  height: number;
}

export interface PetPosition {
  x: number;
  y: number;
}

/**
 * Work-area rect in logical points, top-left origin. Returned by the Rust
 * `pet_get_work_area` command. On macOS this is `NSScreen.visibleFrame`
 * (excludes Dock + menu bar); on other platforms it's the full monitor rect
 * as a best-effort fallback. `scale_factor` is the physical-px-per-logical-
 * point ratio (`backingScaleFactor`, 2.0 on Retina) — present on the Rust
 * payload but OPTIONAL here because the math functions in this file never
 * touch it (they run purely in logical space). Callers read `scale_factor`
 * off the raw `invoke` result (typed as `PetWorkAreaResult` in PetApp) and
 * do the ×/÷ boundary conversion themselves.
 */
export interface PetWorkArea {
  x: number;
  y: number;
  width: number;
  height: number;
  scale_factor?: number;
}

/**
 * Compute the default pet position (logical points) for the bottom-right of the
 * given monitor size. The result is **relative to the work area's top-left**;
 * the caller must add the work area's `(x, y)` origin to get an absolute
 * logical screen position, then multiply by `scale_factor` before passing it
 * to `set_pet_position` (which takes a `PhysicalPosition`).
 *
 * Always clamps `x >= 0` and `y >= PET_MIN_TOP` so a tiny / oddly sized
 * monitor cannot push the default off-origin or behind the menu bar.
 */
export function computeDefaultPetPosition(
  monitorSize: MonitorSizePhysical,
): PetPosition {
  const x = Math.max(0, Math.round(monitorSize.width - PET_WINDOW_SIZE - PET_RIGHT_MARGIN));
  const y = Math.max(PET_MIN_TOP, Math.round(monitorSize.height - PET_WINDOW_SIZE - PET_BOTTOM_MARGIN));
  return { x, y };
}

/**
 * Clamp a saved pet position (absolute logical screen points) so the whole
 * 120×120 window stays inside the work area. If the saved position would clip
 * on any edge, it is moved inward to the nearest valid position. The caller
 * should persist the clamped value back to `settingsStore` so a subsequent
 * launch doesn't need to re-clamp.
 *
 * If the work area is smaller than the pet window (degenerate case), the
 * pet is placed at the work area's top-left — the window will overflow but
 * at least its anchor stays on-screen.
 */
export function clampPetPosition(saved: PetPosition, workArea: PetWorkArea): PetPosition {
  const maxX = workArea.x + Math.max(0, workArea.width - PET_WINDOW_SIZE);
  const maxY = workArea.y + Math.max(0, workArea.height - PET_WINDOW_SIZE);
  const x = Math.min(Math.max(saved.x, workArea.x), maxX);
  const y = Math.min(Math.max(saved.y, workArea.y), maxY);
  return { x, y };
}

/**
 * Pet-panel window footprint (matches `tauri.conf.json` `pet-panel` window
 * size). Used by `computePanelPosition` and `clampPanelPosition` so the
 * panel stays fully on-screen.
 */
export const PET_PANEL_WIDTH = 380;
export const PET_PANEL_HEIGHT = 520;

/** Minimum panel size (matches `tauri.conf.json` `minWidth`/`minHeight`). */
export const PET_PANEL_MIN_WIDTH = 280;
export const PET_PANEL_MIN_HEIGHT = 360;

/** Gap between the pet window and the panel when the panel opens next to it. */
export const PET_PANEL_GAP = 8;

/**
 * Compute the pet-panel position (logical points, absolute screen coords) given
 * the pet's current position and the work area. The panel opens ABOVE the pet
 * by default (panel bottom edge = pet top edge - gap); if there isn't room
 * above (pet near the top of the screen), the panel opens BELOW the pet
 * instead (panel top edge = pet bottom edge + gap).
 *
 * The panel's X is centered on the pet's X (panel.x = pet.x + PET_WINDOW_SIZE/2
 * - PET_PANEL_WIDTH/2), then clamped to the work area's horizontal extent so
 * the whole panel stays on-screen even when the pet is near the left/right
 * edge.
 *
 * No-overlap invariant: the panel NEVER covers the pet icon. The chosen
 * vertical position always leaves at least `PET_PANEL_GAP` between the panel
 * and the pet. Vertical Y is NOT clamped to the work area — when neither
 * above nor below has enough room to fit the full panel (degenerate tiny
 * work area, or pet in the middle of a short screen), the panel is placed
 * on the side with more room at its non-overlapping position
 * (aboveTop = petTop - gap - panelHeight, or belowTop = petBottom + gap),
 * accepting that the panel overflows the work-area edge on that side. The
 * previous implementation clamped Y to the work area and then fell back to
 * `belowTop` if the clamp pushed the panel onto the pet — but that fallback
 * could push the panel off the bottom edge when the pet was in the lower
 * half of a short work area. Picking the side with more room (and accepting
 * overflow) is strictly better: the panel never overlaps the pet, and it
 * overflows the edge that has the least visual cost.
 *
 * The pet window's outer position (`petPos`) and the returned panel position
 * are both in logical points. The caller must divide `petPos` by
 * `scale_factor` if it came from `outerPosition()` / `pet_cursor_probe`
 * (physical px), and multiply the result by `scale_factor` before calling
 * `pet_panel_set_position` (physical px).
 */
export function computePanelPosition(
  petPos: PetPosition,
  workArea: PetWorkArea,
): PetPosition {
  // Center the panel on the pet horizontally, then clamp to the work area.
  const centeredX = petPos.x + (PET_WINDOW_SIZE - PET_PANEL_WIDTH) / 2;
  const minX = workArea.x;
  const maxX = workArea.x + Math.max(0, workArea.width - PET_PANEL_WIDTH);
  const x = Math.min(Math.max(centeredX, minX), maxX);

  // Vertical: prefer ABOVE the pet; if there isn't room, go BELOW. If neither
  // fits cleanly, pick the side with more room and accept overflow on that
  // side — the panel still does NOT overlap the pet (panel bottom = petTop -
  // gap for above; panel top = petBottom + gap for below).
  const aboveTop = petPos.y - PET_PANEL_GAP - PET_PANEL_HEIGHT;
  const belowTop = petPos.y + PET_WINDOW_SIZE + PET_PANEL_GAP;
  // Vertical space available above the pet (down to workArea.y) and below the
  // pet (up to workArea.y + workArea.height). Both exclude PET_PANEL_GAP so
  // the no-overlap clearance is baked into the room calc.
  const roomAbove = petPos.y - PET_PANEL_GAP - workArea.y;
  const roomBelow =
    workArea.y + workArea.height - (petPos.y + PET_WINDOW_SIZE) - PET_PANEL_GAP;

  let y: number;
  if (roomAbove >= PET_PANEL_HEIGHT) {
    // Above fits cleanly → panel top at aboveTop, panel bottom at petTop - gap.
    y = aboveTop;
  } else if (roomBelow >= PET_PANEL_HEIGHT) {
    // Below fits cleanly → panel top at petBottom + gap.
    y = belowTop;
  } else {
    // Neither side fits the full panel. Pick the side with more room; the
    // panel overflows the work-area edge on that side but never overlaps the
    // pet. Tie-break goes to ABOVE so the panel drops from above (matches the
    // default preferred side).
    y = roomAbove >= roomBelow ? aboveTop : belowTop;
  }

  return { x, y };
}

/**
 * Clamp a panel position (absolute logical screen points) so the whole panel
 * stays inside the work area. Generalized sibling of `clampPetPosition` for
 * the larger panel window. Unlike `clampPetPosition` (which uses the fixed
 * 120×120 pet size), this takes the **actual panel size** as a parameter so
 * the clamp respects a user-resized panel — a panel grown to 600×700 must be
 * clamped by 600/700, not by the default 380×520, or the bottom-right corner
 * would slide off-screen after a resize → close → reopen cycle.
 *
 * `panelSize` is in LOGICAL points (matches the work area). The caller is
 * responsible for the unit boundary: pass the same logical size you computed
 * via `clampPanelSize` (which also runs in logical space). If the work area is
 * smaller than the panel (degenerate case) the panel is placed at the work
 * area's top-left.
 */
export function clampPanelPosition(
  saved: PetPosition,
  workArea: PetWorkArea,
  panelSize: { width: number; height: number },
): PetPosition {
  const maxX = workArea.x + Math.max(0, workArea.width - panelSize.width);
  const maxY = workArea.y + Math.max(0, workArea.height - panelSize.height);
  const x = Math.min(Math.max(saved.x, workArea.x), maxX);
  const y = Math.min(Math.max(saved.y, workArea.y), maxY);
  return { x, y };
}

/** Panel size payload (logical points). Mirrors the Rust `PetPanelSize` struct
 *  returned by `pet_panel_get_size` (which returns PHYSICAL px) — the caller
 *  divides by `scale_factor` before constructing/reading this type so the math
 *  here stays in logical space, directly comparable to the logical work area. */
export interface PetPanelSize {
  width: number;
  height: number;
}

/**
 * Clamp a saved panel size (LOGICAL points) so the panel never exceeds the work
 * area (also logical) and never drops below `PET_PANEL_MIN_*` (logical). A size
 * that was saved on a larger monitor is shrunk to fit the current work area; a
 * degenerate work area falls back to the minimum. The `tauri.conf.json`
 * `minWidth`/`minHeight` already enforce a floor at the OS level — this is the
 * JS-side mirror so `setSize` calls don't fight the clamp. The caller is
 * responsible for the unit boundary: divide by `scale_factor` after
 * `pet_panel_get_size` (physical → logical) before passing `saved`, and
 * multiply by `scale_factor` before `pet_panel_set_size` (logical → physical).
 */
export function clampPanelSize(
  saved: PetPanelSize,
  workArea: PetWorkArea,
): PetPanelSize {
  const width = Math.min(
    Math.max(saved.width, PET_PANEL_MIN_WIDTH),
    Math.max(PET_PANEL_MIN_WIDTH, workArea.width),
  );
  const height = Math.min(
    Math.max(saved.height, PET_PANEL_MIN_HEIGHT),
    Math.max(PET_PANEL_MIN_HEIGHT, workArea.height),
  );
  return { width, height };
}
