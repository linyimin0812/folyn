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
export const PET_WINDOW_SIZE = 80;

/** User-selectable pet size levels (percentage of the 96px base footprint).
 *  Synced with Rust `set_pet_size` command and `PET_CTX_MENU_SIZE_*` menu ids.
 *  `100` matches the default `PET_WINDOW_SIZE` (96) so existing users keep
 *  their layout. */
export type PetSize = '50' | '75' | '100' | '125' | '150';

/** Pixel footprint for each `PetSize` (logical points, matches the work-area
 *  unit). The mascot SVG and the sprite layer both scale to this value via
 *  inline styles in `PetMascot` / `PetApp`. The `pet` Tauri window itself is
 *  resized Rust-side by `set_pet_size`. MUST stay in sync with the Rust
 *  `pet_size_to_px` mapping in `commands.rs`. */
export const PET_SIZE_TO_PX: Record<PetSize, number> = {
  '50': 40,
  '75': 60,
  '100': 80,
  '125': 100,
  '150': 120,
};

/** Default pet size level (used when the persisted value is missing / invalid
 *  on hydrate). Matches `PET_WINDOW_SIZE` so the pre-size-feature layout is
 *  preserved. */
export const PET_SIZE_DEFAULT: PetSize = '100';

/**
 * Resolve a `PetSize` to its pixel footprint. Falls back to the default for
 * unknown values (defensive — a corrupt persisted string would otherwise crash
 * the renderer). */
export function petSizeToPx(size: PetSize | string | undefined): number {
  if (size === '50' || size === '75' || size === '100' || size === '125' || size === '150') {
    return PET_SIZE_TO_PX[size];
  }
  return PET_SIZE_TO_PX[PET_SIZE_DEFAULT];
}

/**
 * Visible mascot icon size. The pet window is `PET_WINDOW_SIZE` (96×96)
 * but the actual mascot SVG is smaller and centered (see `.pet-mascot` in
 * `pet.css` — `width: 72px; height: 72px`). Panel positioning uses the
 * icon's bounds, not the window's, so the panel corner visually touches
 * the mascot — the transparent margin around the icon would otherwise
 * read as a gap between the panel and the pet.
 *
 * The mascot is 75% of the window (72/96), leaving a ~12% transparent
 * margin on each side for the breathing `scale` self-pulse. The ratio is
 * preserved across all `PetSize` levels — `mascotSizeForPetSize(s)`
 * returns `PET_SIZE_TO_PX[s] * 0.75`.
 *
 * MUST stay in sync with `.pet-mascot` width/height in `pet.css` for the
 * default (medium) size; other sizes override via inline style in
 * `PetMascot.tsx`.
 */
export const PET_MASCOT_SIZE = 72;

/** Mascot icon pixel size for a given `PetSize` (75% of the window footprint).
 *  Used by `computePanelPosition` (icon-bounds attachment) and `PetMascot`
 *  (inline SVG/img size). */
export function mascotSizeForPetSize(size: PetSize | string | undefined): number {
  return Math.round(petSizeToPx(size) * 0.75);
}

/**
 * Monotonically-increasing version of the default pet window size. Bump this
 * whenever `PET_WINDOW_SIZE` / `PET_MASCOT_SIZE` change — the settings-store
 * hydrate path discards any saved `petPositionX/Y` whose persisted
 * `petSizeVersion` doesn't match, so a default-size bump auto-applies on next
 * launch (the saved position was computed against the OLD window size and may
 * now leave the smaller/larger window overlapping the screen edge by the size
 * delta; re-running the default-position branch with the new size is safer
 * than re-clamping, which only slides the window to fit but doesn't account
 * for the user's intentional placement relative to the old bounds).
 *
 * `0` is reserved for "unset / pre-versioning" — any existing user whose
 * persisted value predates this field defaults to `0` and therefore
 * mismatches the current constant, triggering a one-time migration on next
 * launch. The new version is then persisted, so subsequent launches are
 * stable until the next bump.
 *
 * History: `1` = the original 120×120 window / 88×88 mascot era. `2` = the
 * shrunk 96×96 window / 72×72 mascot (PRD `settings-pet-tab-and-custom-icon`).
 * `3` = size levels switched from small/medium/large (64/96/128) to
 * percentage-based 50/75/100/125/150 (48/72/96/120/144); old persisted
 * `petSize` strings (`small`/`medium`/`large`) no longer validate and fall
 * back to `100` on hydrate.
 */
export const PET_SIZE_VERSION = 3;

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
 * have dragged the pet still keep their saved position (petStore clamp
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
 * Compute the panel position (logical points, absolute screen coords) so the
 * panel opens **centered in the work area** — used by the global-shortcut
 * toggle path. The click-open path uses `computePanelPosition` (pet-adjacent
 * corner); the shortcut path uses this so the panel lands mid-screen instead
 * of next to the (possibly obscured) pet icon.
 *
 * The result is clamped so the whole panel stays inside the work area on
 * either axis: when the panel is larger than the work area (degenerate case),
 * it is placed at the work-area top-left and overflows downward/rightward.
 */
export function computeCenteredPanelPosition(
  workArea: PetWorkArea,
  panelSize: { width: number; height: number },
): PetPosition {
  const x = workArea.x + Math.max(0, (workArea.width - panelSize.width) / 2);
  const y = workArea.y + Math.max(0, (workArea.height - panelSize.height) / 2);
  return { x: Math.round(x), y: Math.round(y) };
}

/**
 * Clamp a saved pet position (absolute logical screen points) so the whole
 * window stays inside the work area. If the saved position would clip on any
 * edge, it is moved inward to the nearest valid position. The caller should
 * persist the clamped value back to `petStore` so a subsequent launch
 * doesn't need to re-clamp.
 *
 * `petWindowSize` defaults to `PET_WINDOW_SIZE` (96) for backward
 * compatibility, but callers that persist `petSize` should pass the resolved
 * pixel footprint so a large (128) or small (64) pet is clamped by its actual
 * bounds — otherwise a 128px pet saved at the small-size position could clip
 * off-screen.
 *
 * If the work area is smaller than the pet window (degenerate case), the pet
 * is placed at the work area's top-left — the window will overflow but at
 * least its anchor stays on-screen.
 */
export function clampPetPosition(
  saved: PetPosition,
  workArea: PetWorkArea,
  petWindowSize: number = PET_WINDOW_SIZE,
): PetPosition {
  const maxX = workArea.x + Math.max(0, workArea.width - petWindowSize);
  const maxY = workArea.y + Math.max(0, workArea.height - petWindowSize);
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
  petSize: PetSize = PET_SIZE_DEFAULT,
): PetPosition {
  const petWindowSize = petSizeToPx(petSize);
  const mascotSize = mascotSizeForPetSize(petSize);
  const petCenterX = petPos.x + petWindowSize / 2;
  const petCenterY = petPos.y + petWindowSize / 2;
  const workCenterX = workArea.x + workArea.width / 2;
  const workCenterY = workArea.y + workArea.height / 2;

  // The visible mascot icon is `mascotSize` centered inside the `petWindowSize`
  // window — compute the icon's bounding box so the panel corner attaches to
  // the icon, not to the (transparent) window corner.
  const inset = (petWindowSize - mascotSize) / 2;
  const iconLeft = petPos.x + inset;
  const iconRight = petPos.x + petWindowSize - inset;
  const iconTop = petPos.y + inset;
  const iconBottom = petPos.y + petWindowSize - inset;

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

// ────────────────────────────────────────────────────────────────────────────
// Pet bubble notification window (`pet-bubble`).
//
// The bubble is a transparent NSPanel window that pops a speech bubble ABOVE
// the pet on `pet://bubble-show`. The math here runs in LOGICAL points (same
// unit as the work area); the caller divides `get_pet_position` (physical px)
// by `scale_factor` before passing `petPos`, and multiplies the result by
// `scale_factor` before `pet_bubble_set_position` (physical px). See
// `tauri-window-patterns.md` for the unit contract.
// ────────────────────────────────────────────────────────────────────────────

/** Bubble window footprint (matches `tauri.conf.json` `pet-bubble` size). */
export const PET_BUBBLE_WIDTH = 320;
export const PET_BUBBLE_HEIGHT = 120;

/** Gap between the pet window's top edge and the bubble's bottom edge. */
export const PET_BUBBLE_GAP = 6;

/**
 * Placement of the bubble relative to the pet (antd-style 12 placements).
 *
 * - `top`/`bottom`/`left`/`right` — single direction, centered on cross-axis,
 *   auto-shift (clamp) into the work area when the pet is near the edge.
 * - `topLeft`/`topRight`/`bottomLeft`/`bottomRight` — corner-aligned, NO
 *   auto-shift; if the cross-axis overflows, flip to the opposite corner
 *   (preserving the primary axis).
 * - `leftTop`/`leftBottom`/`rightTop`/`rightBottom` — side + vertical-align,
 *   same flip rule as corner placements.
 *
 * Default `'top'` preserves the legacy 2-direction behavior (above → flip
 * below when no room); existing callers that omit `placement` see no change.
 */
export type Placement =
  | 'top' | 'topLeft' | 'topRight'
  | 'bottom' | 'bottomLeft' | 'bottomRight'
  | 'left' | 'leftTop' | 'leftBottom'
  | 'right' | 'rightTop' | 'rightBottom';

/** Internal: per-placement decomposition into primary axis + cross-alignment. */
interface PlacementSpec {
  /** Axis the bubble extends from the pet on. */
  primaryAxis: 'v' | 'h';
  /** Direction on the primary axis: `before` = top/left, `after` = bottom/right. */
  primaryDir: 'before' | 'after';
  /** Alignment on the cross-axis. `center` = single direction (auto-shift);
   *  `start`/`end` = corner placement (flip on overflow, no auto-shift). */
  crossAlign: 'start' | 'center' | 'end';
}

/** Placement → spec lookup. `crossAlign: 'center'` marks the four single
 *  directions; `start`/`end` mark the eight corner/side-aligned placements. */
const PLACEMENT_SPEC: Record<Placement, PlacementSpec> = {
  top:         { primaryAxis: 'v', primaryDir: 'before', crossAlign: 'center' },
  topLeft:     { primaryAxis: 'v', primaryDir: 'before', crossAlign: 'start' },
  topRight:    { primaryAxis: 'v', primaryDir: 'before', crossAlign: 'end' },
  bottom:      { primaryAxis: 'v', primaryDir: 'after',  crossAlign: 'center' },
  bottomLeft:  { primaryAxis: 'v', primaryDir: 'after',  crossAlign: 'start' },
  bottomRight: { primaryAxis: 'v', primaryDir: 'after',  crossAlign: 'end' },
  left:        { primaryAxis: 'h', primaryDir: 'before', crossAlign: 'center' },
  leftTop:     { primaryAxis: 'h', primaryDir: 'before', crossAlign: 'start' },
  leftBottom:  { primaryAxis: 'h', primaryDir: 'before', crossAlign: 'end' },
  right:       { primaryAxis: 'h', primaryDir: 'after',  crossAlign: 'center' },
  rightTop:    { primaryAxis: 'h', primaryDir: 'after',  crossAlign: 'start' },
  rightBottom: { primaryAxis: 'h', primaryDir: 'after',  crossAlign: 'end' },
};

/**
 * Compute the bubble position (logical points, absolute screen coords) for the
 * given `placement` relative to the pet. See `Placement` doc for the 12
 * placements + flip + auto-shift rules.
 *
 * `petPos` is the pet window's top-left in LOGICAL points (caller converts
 * from `get_pet_position`'s physical px via `÷ scale_factor`). `petSize`
 * defaults to `PET_SIZE_DEFAULT` so the bubble tracks the actual mascot
 * bounds. `bubbleSize` defaults to the legacy 320×120 — templates that
 * declare their own `size` pass it here so the flip/clamp math tracks the
 * actual card. `placement` defaults to `'top'` (legacy behavior).
 */
export function computeBubblePosition(
  petPos: PetPosition,
  workArea: PetWorkArea,
  petSize: PetSize = PET_SIZE_DEFAULT,
  bubbleSize: { width: number; height: number } = {
    width: PET_BUBBLE_WIDTH,
    height: PET_BUBBLE_HEIGHT,
  },
  placement: Placement = 'top',
): PetPosition {
  const petWindowSize = petSizeToPx(petSize);
  const bubbleW = bubbleSize.width;
  const bubbleH = bubbleSize.height;
  const petLeft = petPos.x;
  const petRight = petPos.x + petWindowSize;
  const petTop = petPos.y;
  const petBottom = petPos.y + petWindowSize;
  const petCenterX = petPos.x + petWindowSize / 2;
  const petCenterY = petPos.y + petWindowSize / 2;
  const waLeft = workArea.x;
  const waRight = workArea.x + workArea.width;
  const waTop = workArea.y;
  const waBottom = workArea.y + workArea.height;

  const spec = PLACEMENT_SPEC[placement];

  // Primary axis: compute the bubble's position for BOTH directions, check
  // fit for both, then pick the preferred if it fits, else flip if the
  // other fits, else keep the preferred (degenerate — overflow sticks to
  // the pet, mirroring the legacy fallback for tiny work areas).
  const beforePos = spec.primaryAxis === 'v'
    ? petTop - PET_BUBBLE_GAP - bubbleH
    : petLeft - PET_BUBBLE_GAP - bubbleW;
  const afterPos = spec.primaryAxis === 'v'
    ? petBottom + PET_BUBBLE_GAP
    : petRight + PET_BUBBLE_GAP;
  const fitsBefore = spec.primaryAxis === 'v'
    ? beforePos >= waTop
    : beforePos >= waLeft;
  const fitsAfter = spec.primaryAxis === 'v'
    ? afterPos + bubbleH <= waBottom
    : afterPos + bubbleW <= waRight;
  let primaryDir = spec.primaryDir;
  if (spec.primaryDir === 'before' && !fitsBefore && fitsAfter) {
    primaryDir = 'after';
  } else if (spec.primaryDir === 'after' && !fitsAfter && fitsBefore) {
    primaryDir = 'before';
  }
  const primaryPos = primaryDir === 'before' ? beforePos : afterPos;

  // Initialize both axes; the primary-axis assignment + cross-axis assignment
  // below will overwrite exactly one of them, leaving the other to be set by
  // the cross-axis branch. TS can't prove exhaustiveness across the two
  // branches, so we initialize to 0 and let later assignments win.
  let x = 0;
  let y = 0;
  if (spec.primaryAxis === 'v') {
    y = primaryPos;
  } else {
    x = primaryPos;
  }

  // Cross-axis: depends on the (possibly flipped) primary axis + cross-align.
  if (spec.primaryAxis === 'v') {
    // Cross = X.
    if (spec.crossAlign === 'center') {
      // Single direction (top/bottom): centered + auto-shift (clamp).
      const maxX = Math.max(waLeft, waRight - bubbleW);
      x = Math.min(Math.max(waLeft, petCenterX - bubbleW / 2), maxX);
    } else if (spec.crossAlign === 'start') {
      // Corner (topLeft/bottomLeft): left edge aligns to pet left. If the
      // bubble would overflow the right edge, flip to 'end' (right-aligned).
      const tryX = petLeft;
      x = tryX + bubbleW > waRight ? petRight - bubbleW : tryX;
    } else {
      // 'end' (topRight/bottomRight): right edge aligns to pet right. Flip
      // to 'start' if overflow on the left.
      const tryX = petRight - bubbleW;
      x = tryX < waLeft ? petLeft : tryX;
    }
  } else {
    // Cross = Y, primary axis horizontal.
    if (spec.crossAlign === 'center') {
      // Single direction (left/right): centered + auto-shift.
      const maxY = Math.max(waTop, waBottom - bubbleH);
      y = Math.min(Math.max(waTop, petCenterY - bubbleH / 2), maxY);
    } else if (spec.crossAlign === 'start') {
      // leftTop/rightTop: top edge aligns to pet top. Flip to 'end' on overflow.
      const tryY = petTop;
      y = tryY + bubbleH > waBottom ? petBottom - bubbleH : tryY;
    } else {
      // leftBottom/rightBottom: bottom edge aligns to pet bottom. Flip on overflow.
      const tryY = petBottom - bubbleH;
      y = tryY < waTop ? petTop : tryY;
    }
  }

  return { x: Math.round(x), y: Math.round(y) };
}

// ────────────────────────────────────────────────────────────────────────────
// Pet corner toast stack (`pet-corner`).
//
// A transparent NSPanel window that stacks up to N toasts at one of the four
// screen corners. Position math runs in LOGICAL points (same unit as the work
// area); the caller multiplies the result by `scale_factor` before
// `pet_corner_set_position` (physical px). See `tauri-window-patterns.md` for
// the unit contract.
// ────────────────────────────────────────────────────────────────────────────

/** Corner toast card width (logical points). Matches the `pet-corner`
 *  window's declared `width` in `tauri.conf.json`. Fixed — the card
 *  never wraps horizontally (text uses `-webkit-line-clamp`). */
export const PET_CORNER_CARD_WIDTH = 320;
/** Card min height (logical points). Floor so a card with only a short
 *  single-line text still has tap area. The actual card height is
 *  content-driven (`height: auto` in CSS) and measured at runtime by
 *  `PetCornerApp`'s ResizeObserver; this constant is only the floor. */
export const PET_CORNER_CARD_MIN_HEIGHT = 48;
/** Gap between stacked toasts (logical points). */
export const PET_CORNER_CARD_GAP = 8;
/** Margin from the screen corner to the first toast's outer edge (logical
 *  points). Sits inside the work area (which already excludes Dock + menu
 *  bar) as a small breathing inset. */
export const PET_CORNER_MARGIN = 16;
/** Max simultaneously-visible toasts. Overflow hides the oldest. PRD
 *  pet-popover-corner, Decision D5. */
export const PET_CORNER_MAX_VISIBLE = 3;

/** Screen corner the toast stack attaches to. Mirrors
 *  `petStore.cornerPlacement`. */
export type CornerPlacement = 'topLeft' | 'topRight' | 'bottomLeft' | 'bottomRight';

/** Compute the pet-corner window's top-left position (logical points,
 *  absolute screen coords) for a stack of total height `stackHeight`
 *  (logical points, already including per-card heights + inter-card
 *  gaps — caller measures the rendered stack). Window width is constant
 *  (`PET_CORNER_CARD_WIDTH`). For `stackHeight = 0` the window is hidden
 *  by the caller (no position math needed).
 *
 *  `bottomRight`: x = workArea.right − width − margin; y = workArea.bottom
 *  − stackHeight − margin (stack grows upward from the bottom corner).
 *  `topLeft`: x = workArea.left + margin; y = workArea.top + margin
 *  (stack grows downward from the top corner).
 *  `topRight`/`bottomLeft` mix the X/Y of the above. */
export function computeCornerToastPosition(
  corner: CornerPlacement,
  workArea: PetWorkArea,
  stackHeight: number,
): PetPosition {
  if (stackHeight <= 0) {
    // Caller should hide the window; return the work-area origin as a safe
    // fallback so a stray show with stackHeight=0 doesn't flash mid-screen.
    return { x: workArea.x, y: workArea.y };
  }
  const width = PET_CORNER_CARD_WIDTH;
  const waLeft = workArea.x;
  const waRight = workArea.x + workArea.width;
  const waTop = workArea.y;
  const waBottom = workArea.y + workArea.height;

  const x =
    corner === 'topLeft' || corner === 'bottomLeft'
      ? waLeft + PET_CORNER_MARGIN
      : waRight - width - PET_CORNER_MARGIN;
  const y =
    corner === 'topLeft' || corner === 'topRight'
      ? waTop + PET_CORNER_MARGIN
      : waBottom - stackHeight - PET_CORNER_MARGIN;

  return { x: Math.round(x), y: Math.round(y) };
}