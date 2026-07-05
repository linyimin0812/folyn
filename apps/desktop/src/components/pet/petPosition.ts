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
 * Margins kept between the pet window's edges and the monitor's physical
 * edges so the mascot isn't clipped off-screen on first launch.
 *
 * These are SEPARATE per axis because macOS `monitor.size.height` (from
 * `currentMonitor()`) is the **full screen height including the Dock area**
 * (~50–70px at the bottom) and the menu bar at the top. A single 20px margin
 * left the bottom of the mascot hidden behind the Dock. The bottom margin is
 * larger to clear the Dock; the right margin stays small.
 */
export const PET_RIGHT_MARGIN = 20;
export const PET_BOTTOM_MARGIN = 80;

/**
 * Minimum top-edge position so the pet stays below the macOS menu bar on
 * very small / oddly sized monitors.
 */
export const PET_MIN_TOP = 40;

export interface MonitorSizePhysical {
  width: number;
  height: number;
}

export interface PetPosition {
  x: number;
  y: number;
}

/**
 * Compute the default pet position (physical px) for the bottom-right of the
 * given monitor. Uses separate right/bottom margins so the macOS Dock does
 * not occlude the mascot. Always clamps `x >= 0` and `y >= PET_MIN_TOP` so
 * a tiny / oddly sized monitor cannot push the default off-origin or behind
 * the menu bar.
 */
export function computeDefaultPetPosition(
  monitorSize: MonitorSizePhysical,
): PetPosition {
  const x = Math.max(0, Math.round(monitorSize.width - PET_WINDOW_SIZE - PET_RIGHT_MARGIN));
  const y = Math.max(PET_MIN_TOP, Math.round(monitorSize.height - PET_WINDOW_SIZE - PET_BOTTOM_MARGIN));
  return { x, y };
}
