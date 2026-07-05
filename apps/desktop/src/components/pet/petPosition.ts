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
 * Margin kept between the pet window's bottom-right edge and the monitor's
 * physical edge so the mascot isn't clipped off-screen on first launch.
 */
export const PET_DEFAULT_MARGIN = 20;

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
 * given monitor. Always returns values clamped to `>= 0` so a tiny / oddly
 * sized monitor can never push the default off the origin.
 */
export function computeDefaultPetPosition(
  monitorSize: MonitorSizePhysical,
): PetPosition {
  const offset = PET_WINDOW_SIZE + PET_DEFAULT_MARGIN;
  const x = Math.max(0, Math.round(monitorSize.width - offset));
  const y = Math.max(0, Math.round(monitorSize.height - offset));
  return { x, y };
}
