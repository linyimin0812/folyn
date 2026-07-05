/**
 * Default-position math for the desktop pet window.
 *
 * Extracted as a pure function so it can be unit-tested without mounting
 * PetApp (which spins up Tauri-window effect loops impractical to test).
 *
 * Units: **physical px** throughout. `set_pet_position` (Rust) takes a
 * `PhysicalPosition`, and `monitor.size` from `@tauri-apps/api/window` is
 * already physical px — so the default calc must NOT divide by `scaleFactor`
 * (that would produce logical px and place the window at the wrong spot on
 * retina displays). See `tauri-window-patterns.md` for the unit contract.
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
 * The bottom margin stays larger than the right so even on a setup where the
 * work area underreports the Dock (e.g. auto-hide Dock), the mascot's lower
 * portion still clears the screen bottom.
 */
export const PET_RIGHT_MARGIN = 8;
export const PET_BOTTOM_MARGIN = 12;

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
 * Work-area rect in physical px, top-left origin (matches Tauri's
 * `PhysicalPosition`). Returned by the Rust `pet_get_work_area` command.
 * On macOS this is `NSScreen.visibleFrame` (excludes Dock + menu bar); on
 * other platforms it's the full monitor rect as a best-effort fallback.
 */
export interface PetWorkArea {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Compute the default pet position (physical px) for the bottom-right of the
 * given monitor size. The result is **relative to the work area's top-left**;
 * the caller must add the work area's `(x, y)` origin to get an absolute
 * screen position for `set_pet_position`.
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
 * Clamp a saved pet position (absolute screen px) so the whole 120×120
 * window stays inside the work area. If the saved position would clip on
 * any edge, it is moved inward to the nearest valid position. The caller
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

/** Gap between the pet window and the panel when the panel opens next to it. */
export const PET_PANEL_GAP = 8;

/**
 * Compute the pet-panel position (physical px, absolute screen coords) given
 * the pet's current position and the work area. The panel opens to the
 * right of the pet by default; if that would overflow the right edge it
 * opens to the left instead. Likewise the panel opens below the pet, but if
 * that would overflow the bottom edge it opens above. Both axes are clamped
 * to the work area so the whole panel stays on-screen.
 *
 * The pet window's outer position is its top-left in physical px (matches
 * Tauri's `PhysicalPosition`), so `petPos` must be the same kind of value
 * returned by `get_pet_position` / `outerPosition()`.
 */
export function computePanelPosition(
  petPos: PetPosition,
  workArea: PetWorkArea,
): PetPosition {
  const rightOpen = petPos.x + PET_WINDOW_SIZE + PET_PANEL_GAP + PET_PANEL_WIDTH;
  const opensRight = rightOpen <= workArea.x + workArea.width;
  const x = opensRight
    ? petPos.x + PET_WINDOW_SIZE + PET_PANEL_GAP
    : petPos.x - PET_PANEL_GAP - PET_PANEL_WIDTH;

  const belowOpen = petPos.y + PET_PANEL_HEIGHT;
  const opensBelow = belowOpen <= workArea.y + workArea.height;
  const y = opensBelow
    ? petPos.y
    : Math.max(workArea.y, petPos.y + PET_WINDOW_SIZE - PET_PANEL_HEIGHT);

  return clampPanelPosition({ x, y }, workArea);
}

/**
 * Clamp a panel position (absolute screen px) so the whole panel stays inside
 * the work area. Generalized sibling of `clampPetPosition` for the larger
 * panel window. If the work area is smaller than the panel (degenerate case)
 * the panel is placed at the work area's top-left.
 */
export function clampPanelPosition(
  saved: PetPosition,
  workArea: PetWorkArea,
): PetPosition {
  const maxX = workArea.x + Math.max(0, workArea.width - PET_PANEL_WIDTH);
  const maxY = workArea.y + Math.max(0, workArea.height - PET_PANEL_HEIGHT);
  const x = Math.min(Math.max(saved.x, workArea.x), maxX);
  const y = Math.min(Math.max(saved.y, workArea.y), maxY);
  return { x, y };
}
