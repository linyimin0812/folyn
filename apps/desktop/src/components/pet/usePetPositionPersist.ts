import { useEffect } from 'react';
import { isTauri } from '@/utils/platform';

/**
 * Position persistence + topmost re-apply for the `pet` window (R5, AC7).
 * Extracted from PetApp.tsx: the ~800ms position-persist poll (which also
 * re-asserts the ScreenSaver-level topmost), the mount-time topmost raise,
 * and the blur-triggered topmost re-assert.
 */

const POSITION_PERSIST_INTERVAL_MS = 800;

// ── Position persistence + topmost re-apply (R5, AC7) ──
// Periodically read the window's outer position and persist it to
// petStore when it changes. Native drag doesn't deliver JS pointerup
// reliably, so polling is the robust path.
//
// Unit boundary: `outerPosition()` returns PHYSICAL px; the saved position
// is stored in LOGICAL points (display-resolution-independent, matches the
// work-area math used at launch). `scaleFactor()` is cached once per poller
// lifetime — it only changes when the window moves to a monitor with a
// different DPI, which for the pet is effectively never (single primary-
// monitor macOS MVP); if it ever does, the launch effect re-resolves from
// `pet_get_work_area.scale_factor` on the next startup and the saved logical
// value is still correct.
//
// Topmost re-apply: Tauri's `alwaysOnTop: true` config only sets the
// Floating NSWindow level (5), which other always-on-top apps (VS Code,
// etc.) can cover. `pet_set_topmost_level` raises the pet to
// `kCGScreenSaverWindowLevelKey` (13) so it stays visible everywhere. The
// OS can reset the level after a `show()` (e.g. when `toggle_pet_mode`
// re-shows the pet), so re-invoke it on this ~800ms poll — it is idempotent
// and cheap. Wrapped in isTauri + try/catch so non-Tauri/test envs skip it.

// ── Topmost level (visible over all always-on-top apps) ──
// Tauri's `alwaysOnTop: true` config only sets the Floating NSWindow
// level (5), which other always-on-top apps (VS Code, etc.) can cover.
// Raise the pet to `kCGScreenSaverWindowLevelKey` (13) so it stays
// visible everywhere. The level persists for the window's lifetime, so
// calling once on mount is sufficient. Non-fatal if it fails.

// ── Re-assert topmost level on window blur (Issue 2 diagnostic + fix) ──
// Tauri/macOS may reset the always-on-top level when the pet window loses
// focus (app deactivation — user switched to another app). Re-invoke
// `pet_set_topmost_level('pet')` on the `tauri://blur` event so the
// ScreenSaver level is re-asserted immediately when the user switches away.
// Without this, switching to another app can hide the pet behind it.
// Wrapped in isTauri + try/catch so non-Tauri/test envs skip it. The
// unlisten callback is returned from `listen` for cleanup.

export function usePetPositionPersist() {
  useEffect(() => {
    if (!isTauri()) return;
    let cancelled = false;
    let lastX = -1;
    let lastY = -1;
    let sf = 1;

    const persist = async () => {
      if (cancelled) return;
      try {
        const { getCurrentWindow } = await import('@tauri-apps/api/window');
        // Cache the scale factor once; it doesn't change for a single-
        // monitor pet window. (If it ever does, the launch effect re-
        // resolves from pet_get_work_area on next startup.)
        if (sf === 1) {
          sf = await getCurrentWindow().scaleFactor() || 1;
        }
        const pos = await getCurrentWindow().outerPosition();
        const x = Math.round(pos.x / sf);
        const y = Math.round(pos.y / sf);
        if (x !== lastX || y !== lastY) {
          lastX = x;
          lastY = y;
          const { usePetStore } = await import('@/store/petStore');
          usePetStore.getState().setPetPosition(x, y);
        }
      } catch {
        // Non-fatal; try again next tick.
      }

      // Re-apply the ScreenSaver-level topmost so the OS never demotes the
      // pet below other always-on-top apps after a show().
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        await invoke('pet_set_topmost_level', { label: 'pet' });
      } catch (err) {
        console.warn('[pet] pet_set_topmost_level poll failed:', err);
      }
    };

    const id = window.setInterval(persist, POSITION_PERSIST_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        await invoke('pet_set_topmost_level', { label: 'pet' });
      } catch (err) {
        console.warn('[pet] set_topmost_level failed:', err);
      }
    })();
  }, []);

  useEffect(() => {
    if (!isTauri()) return;
    let unlisten: (() => void) | undefined;
    (async () => {
      try {
        const { getCurrentWindow } = await import('@tauri-apps/api/window');
        const { invoke } = await import('@tauri-apps/api/core');
        unlisten = await getCurrentWindow().listen('tauri://blur', () => {
          invoke('pet_set_topmost_level', { label: 'pet' }).catch((err) =>
            console.warn('[pet] topmost re-apply on blur failed:', err),
          );
        });
      } catch (err) {
        console.warn('[pet] blur listener setup failed:', err);
      }
    })();
    return () => {
      if (unlisten) unlisten();
    };
  }, []);
}
