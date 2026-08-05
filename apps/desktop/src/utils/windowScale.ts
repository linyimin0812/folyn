/**
 * Resolve the CURRENT window's own backing scale factor (physical px per
 * logical point).
 *
 * Window-frame commands (`*_set_size` / `*_set_position`) interpret their
 * physical values against the WINDOW's own scale factor — NOT the pet
 * screen's `scale_factor` from `pet_get_work_area`. On a mixed-DPI setup the
 * two differ while the window is still on its old display: the first
 * bubble/menu/panel show after the pet moves to another screen converts
 * logical → physical with the target screen's scale (e.g. 1x) while Tauri
 * converts back with the window's current scale (e.g. 2x), landing the
 * popup at half size and half the intended offset. The second show is
 * correct because by then the window has moved and its scale matches.
 *
 * Resolved via the custom `pet_window_scale` command (bypasses the ACL):
 * the pet windows' capabilities deliberately grant only `core:event`, so
 * the standard `getCurrentWindow().scaleFactor()` would be rejected.
 *
 * Callers keep `workArea.scale_factor` for the PET position → logical
 * conversion (the pet's screen scale) and use this for the window frame
 * conversions.
 */
export async function currentWindowScaleFactor(fallback = 1): Promise<number> {
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    const scale = await invoke<number>('pet_window_scale');
    return scale || fallback;
  } catch {
    // Non-Tauri (tests) or failed invoke — use the caller's fallback.
    return fallback;
  }
}
