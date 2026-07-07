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
 * Visible mascot icon size. The pet window is `PET_WINDOW_SIZE` (120×120)
 * but the actual mascot SVG is smaller and centered (see `.pet-mascot` in
 * `pet.css` — `width: 88px; height: 88px`). Panel positioning uses the
 * icon's bounds, not the window's, so the panel corner visually touches
 * the mascot — the 16px transparent margin around the icon would otherwise
 * read as a gap between the panel and the pet.
 *
 * MUST stay in sync with `.pet-mascot` width/height in `pet.css`.
 */
export const PET_MASCOT_SIZE = 88;

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
export const PET_PANEL_WIDTH = 440;
export const PET_PANEL_HEIGHT = 620;

/**
 * Monotonically-increasing version of the default panel size. Bump this
 * whenever `PET_PANEL_WIDTH` / `PET_PANEL_HEIGHT` change — the open gesture
 * and mount-restore ignore any saved `petPanelWidth/Height` whose persisted
 * `petPanelSizeVersion` doesn't match, so a default-size bump auto-applies
 * on next open instead of being shadowed by the old default saved from a
 * previous install. The new default + new version are then persisted, so
 * subsequent opens are stable until the next bump.
 *
 * `0` is reserved for "unset / pre-versioning" — any existing user whose
 * persisted value predates this field defaults to `0` and therefore
 * mismatches the current constant, triggering a one-time migration to the
 * new default on next open.
 */
export const PET_PANEL_SIZE_VERSION = 1;

/** Minimum panel size (matches `tauri.conf.json` `minWidth`/`minHeight`). */
export const PET_PANEL_MIN_WIDTH = 280;
export const PET_PANEL_MIN_HEIGHT = 360;

/** Gap between the pet window and the panel when the panel opens next to it. */
export const PET_PANEL_GAP = 2;

/**
 * Compute the pet-panel position (logical points, absolute screen coords) given
 * the pet's current position and the work area. The panel attaches one of its
 * **four corners** to the pet **icon's** diagonally-opposite corner (NOT the
 * window's corner — the visible mascot is `PET_MASCOT_SIZE` (88×88) centered
 * inside the 120×120 `PET_WINDOW_SIZE`, leaving a 16px transparent margin on
 * each side; attaching to the window corner would put a 16px+gap visual gap
 * between the panel and the visible mascot). The corner is `PET_PANEL_GAP`
 * away from the icon's corner on BOTH axes, and the corner is chosen by
 * quadrant: compare the pet's center to the work area's center on each axis
 * independently.
 *
 * Quadrant map (pet center vs work-area center, per axis; `>=` falls into the
 * right/bottom half):
 * - bottom-right quadrant → panel's **bottom-right** corner at icon's **top-left**
 *   corner − gap on both axes (panel extends up-left).
 * - bottom-left  → panel's **bottom-left**  corner at icon's **top-right** − gap
 *   (panel extends up-right).
 * - top-right     → panel's **top-right**    corner at icon's **bottom-left** − gap
 *   (panel extends down-left).
 * - top-left      → panel's **top-left**     corner at icon's **bottom-right** − gap
 *   (panel extends down-right).
 *
 * Tie-break: a pet center exactly at the work-area center falls into the
 * right/bottom half on each axis (via `>=`), so the panel extends up-left — a
 * deterministic default that matches the most common "pet at bottom-right"
 * placement.
 *
 * No-overlap invariant: because the panel's pet-ward edge is exactly
 * `PET_PANEL_GAP` away from the **icon's** opposite edge on each axis, the
 * panel bounding box never intersects the icon's
 * `[iconLeft, iconRight] × [iconTop, iconBottom]` rect. The panel CAN overlap
 * the window's transparent 16px margin around the icon — that margin is
 * transparent and click-through, so the visual overlap is harmless. This holds
 * even in the degenerate case where the work area is smaller than the panel —
 * the panel overflows the work-area edge on the diagonal side but still does
 * not cover the icon.
 *
 * The pet window's outer position (`petPos`) and the returned panel position
 * are both in logical points. The caller must divide `petPos` by
 * `scale_factor` if it came from `outerPosition()` / `pet_cursor_probe`
 * (physical px), and multiply the result by `scale_factor` before calling
 * `pet_panel_set_position` (physical px).
 *
 * `panelSize` is the **actual** panel size in LOGICAL points (matches the
 * work area). The caller must pass the actual size — default constants for
 * first-ever open, the clamped saved size for subsequent opens — so a
 * user-resized panel's corner still tracks the pet. Passing the hardcoded
 * `PET_PANEL_WIDTH`/`PET_PANEL_HEIGHT` here when the panel has been resized
 * larger would place the corner at the wrong spot (the corner drifts off the
 * pet). This mirrors the `clampPanelPosition` contract which already takes
 * the actual panel size for the same reason.
 */
export function computePanelPosition(
  petPos: PetPosition,
  workArea: PetWorkArea,
  panelSize: { width: number; height: number },
): PetPosition {
  const petCenterX = petPos.x + PET_WINDOW_SIZE / 2;
  const petCenterY = petPos.y + PET_WINDOW_SIZE / 2;
  const workCenterX = workArea.x + workArea.width / 2;
  const workCenterY = workArea.y + workArea.height / 2;

  // The visible mascot icon is PET_MASCOT_SIZE centered inside the
  // PET_WINDOW_SIZE window — compute the icon's bounding box so the panel
  // corner attaches to the icon, not to the (transparent) window corner.
  const inset = (PET_WINDOW_SIZE - PET_MASCOT_SIZE) / 2; // = 16
  const iconLeft = petPos.x + inset;
  const iconRight = petPos.x + PET_WINDOW_SIZE - inset; // = petPos.x + PET_MASCOT_SIZE + inset
  const iconTop = petPos.y + inset;
  const iconBottom = petPos.y + PET_WINDOW_SIZE - inset;

  // X axis: pet in right half → panel extends left (panel right edge = icon
  // left edge − gap); else panel extends right (panel left edge = icon right
  // edge + gap).
  const x =
    petCenterX >= workCenterX
      ? iconLeft - PET_PANEL_GAP - panelSize.width
      : iconRight + PET_PANEL_GAP;

  // Y axis: pet in bottom half → panel extends up (panel bottom edge = icon
  // top edge − gap); else panel extends down (panel top edge = icon bottom
  // edge + gap).
  const y =
    petCenterY >= workCenterY
      ? iconTop - PET_PANEL_GAP - panelSize.height
      : iconBottom + PET_PANEL_GAP;

  return { x, y };
}

/**
 * Clamp a panel position (absolute logical screen points) so the whole panel
 * stays inside the work area. Generalized sibling of `clampPetPosition` for
 * the larger panel window. Unlike `clampPetPosition` (which uses the fixed
 * 120×120 pet size), this takes the **actual panel size** as a parameter so
 * the clamp respects a user-resized panel — a panel grown to 600×700 must be
 * clamped by 600/700, not by the default 440×620, or the bottom-right corner
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
 * Resolve the panel size to apply on open, given the saved size + version.
 * If the saved version matches `PET_PANEL_SIZE_VERSION`, the saved size is
 * clamped to the work area and returned. Otherwise (version mismatch or
 * first-ever open with `saved.width <= 0`), the current default is returned.
 * The caller is responsible for persisting the resolved size + current
 * version when the saved values were stale (see PetApp.tsx open gesture +
 * PetPanelApp.tsx mount restore).
 *
 * Extracted as a pure function so the version-gate logic is unit-testable
 * without mounting the panel component (which spins up Tauri-window effect
 * loops impractical to test). Mirrors the existing `clampPanelSize` pattern.
 */
export function resolvePanelSize(
  saved: PetPanelSize,
  savedVersion: number,
  workArea: PetWorkArea,
): PetPanelSize {
  if (saved.width > 0 && saved.height > 0 && savedVersion === PET_PANEL_SIZE_VERSION) {
    return clampPanelSize(saved, workArea);
  }
  return { width: PET_PANEL_WIDTH, height: PET_PANEL_HEIGHT };
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
