import { useEffect } from 'react';
import { clampPetPosition, computeDefaultPetPosition, petSizeToPx } from './petPosition';
import type { PetWorkAreaResult } from './petPanelWindow';
import { isTauri } from '@/utils/platform';

/**
 * Launch-time show for the `pet` window: resolve the saved-or-default
 * position, apply it, then `show()` — position-first so the first visible
 * frame is already at the right spot. Extracted verbatim from PetApp.tsx's
 * mount effect.
 */

// ── Show the pet window on launch (position-first) ──
// The pet window is created `visible: false` (tauri.conf.json) and relies on
// the frontend to show it when it mounts. The previous fullscreen-auto-hide
// probe's `else` branch used to call `win.show()` — that probe was removed
// for "always visible", so this mount effect now owns the launch-time show.
// Idempotent: `show()` on an already-visible window is a no-op. The pet
// window's capability file (`capabilities/pet.json`) grants
// `core:window:allow-show`, so this call is ACL-allowed. Do NOT re-add
// fullscreen hide logic — the pet must stay visible at all times.
//
// ORDERING: resolve and `set_pet_position` BEFORE `show()`. tauri.conf.json
// uses `center: true` (no hardcoded `x`/`y`) so the window is CREATED
// off-screen-center as a transient — the runtime position-set corrects to
// the exact saved-or-default position before the first visible frame. The
// previous layout had a separate position-restore useEffect running in
// PARALLEL with this show effect, which raced: `show()` could land before
// `set_pet_position`, briefly flashing the window at the conf default
// (centered) position. Merging them into one async chain guarantees the
// position is applied first. Both calls are non-fatal if they fail — the
// window still shows at the conf default (centered, never off-screen).
//
// Unit boundary: the work area from `pet_get_work_area` is in LOGICAL points
// (plus `scale_factor`); the saved position is also logical. The math here
// (`computeDefaultPetPosition` / `clampPetPosition`) runs in logical space.
// `set_pet_position` / `outerPosition()` / `setPosition` operate in PHYSICAL
// px, so multiply by `sf` before calling them and divide by `sf` after
// reading `outerPosition()`.
//
// `show()` resets the NSWindow level to Floating (Tauri's alwaysOnTop
// default), which lets other always-on-top apps (VS Code, etc.) cover the
// pet. Re-apply `pet_set_topmost_level` immediately after `show()` so the
// ScreenSaver level is restored in the same frame — the ~800ms poll would
// otherwise leave a window where the pet sits at Floating for up to 800ms.

export function usePetWindowLaunch() {
  useEffect(() => {
    if (!isTauri()) return;
    (async () => {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      const { invoke } = await import('@tauri-apps/api/core');

      // ponytail: hoist the resolved physical position so the post-show
      // re-assert (step 2) can re-invoke `set_pet_position` after `show()`.
      // `show()` can reset the NSWindow frame to the conf default on a
      // hidden panel, and `set_position` on a hidden NSWindow can be
      // deferred — re-asserting after show mirrors the existing
      // `set_pet_size` post-show re-assert below. On multi-monitor setups
      // where the primary monitor sits at negative global coords, the
      // pre-show `set_position` may not move the panel off its current
      // screen; the post-show re-assert corrects it.
      let physicalX: number | null = null;
      let physicalY: number | null = null;

      // 1. Resolve and apply the initial position BEFORE show() so the first
      //    visible frame is already at the right spot (no centered flash).
      try {
        const { usePetStore } = await import('@/store/petStore');
        const workArea = await invoke<PetWorkAreaResult>('pet_get_work_area');
        const sf = workArea.scale_factor || 1;
        const { petPositionX, petPositionY, petSize } = usePetStore.getState();
        const petWindowSize = petSizeToPx(petSize);

        // Restore the persisted pet window size BEFORE positioning so a large
        // / small pet's bounds are correct when the position is clamped. The
        // `pet` Tauri window starts at the medium (96) default from
        // tauri.conf.json; `set_pet_size` resizes it to the saved level. If
        // this fails the medium default still applies, which is never
        // off-screen.
        try {
          await invoke('set_pet_size', { level: petSize });
        } catch (err) {
          console.warn('[pet] set_pet_size on mount failed:', err);
        }

        // Work-area guard: if the OS returns a zero-sized work area (e.g.
        // NSScreen.mainScreen is nil during early launch), the default-branch
        // math would compute x=0, y=PET_MIN_TOP (top-left) — visibly wrong.
        // Skip the position-set entirely and let Tauri's `center: true` conf
        // default apply (centered, never off-screen). The ~800ms poller below
        // will persist the actual (centered) position; on the next launch the
        // saved-position branch will restore it. The user can drag the pet to
        // overwrite. This is an edge case; on most launches workArea is valid.
        if (workArea.width <= 0 || workArea.height <= 0) {
          console.warn('[pet] work area is zero, skipping position-set:', workArea);
        } else {
          let resolved: { x: number; y: number };
          let source: 'saved' | 'default' = 'default';
          if (petPositionX >= 0 && petPositionY >= 0) {
            // Saved position (logical): clamp to the current work area, using
            // the actual pet window size so a size change between launches
            // still keeps the whole window on-screen. If the saved value is
            // off-screen, the clamped value is persisted back so subsequent
            // launches skip the re-clamp.
            source = 'saved';
            const clamped = clampPetPosition(
              { x: petPositionX, y: petPositionY },
              { x: workArea.x, y: workArea.y, width: workArea.width, height: workArea.height, scale_factor: sf },
              petWindowSize,
            );
            if (clamped.x !== petPositionX || clamped.y !== petPositionY) {
              usePetStore.getState().setPetPosition(clamped.x, clamped.y);
            }
            resolved = clamped;
          } else {
            // First-launch default: bottom-right of the work area, lifted by
            // PET_BOTTOM_MARGIN. Persist so the next launch restores it.
            const rel = computeDefaultPetPosition({
              width: workArea.width,
              height: workArea.height,
            });
            resolved = { x: workArea.x + rel.x, y: workArea.y + rel.y };
            usePetStore.getState().setPetPosition(resolved.x, resolved.y);
          }

          // Diagnostic: log the saved + work-area + resolved values so a
          // "still centered" report can be traced to a saved localStorage
          // position vs. a work-area fallback vs. a set_pet_position failure.
          console.info('[pet] launch position:', {
            source,
            saved: { x: petPositionX, y: petPositionY },
            workArea,
            sf,
            resolved,
          });

          // Apply via the custom Rust command first (ACL-safe custom invoke).
          // `set_pet_position` takes PHYSICAL px, so multiply the logical
          // resolved value by `sf`. Then verify with `outerPosition()` (also
          // physical — divide by `sf` to compare with the logical resolved);
          // if the OS didn't honor the custom command (some builds race the
          // WebviewWindow creation), fall back to the standard `setPosition()`
          // API — both are valid paths, belt-and-suspenders so a silent invoke
          // failure cannot leave the window centered.
          physicalX = Math.round(resolved.x * sf);
          physicalY = Math.round(resolved.y * sf);
          try {
            await invoke('set_pet_position', { x: physicalX, y: physicalY });
          } catch (err) {
            console.warn('[pet] set_pet_position invoke failed, falling back to setPosition:', err);
          }
          try {
            const actual = await getCurrentWindow().outerPosition();
            const actualLogicalX = Math.round(actual.x / sf);
            const actualLogicalY = Math.round(actual.y / sf);
            if (actualLogicalX !== resolved.x || actualLogicalY !== resolved.y) {
              console.warn('[pet] position mismatch after invoke, retrying via setPosition:', {
                actual: { x: actualLogicalX, y: actualLogicalY },
                expected: resolved,
              });
              const { PhysicalPosition } = await import('@tauri-apps/api/dpi');
              await getCurrentWindow().setPosition(new PhysicalPosition(physicalX, physicalY));
            }
          } catch (err) {
            console.warn('[pet] position verify/retry failed:', err);
          }
        }
      } catch (err) {
        // Non-fatal; the window falls back to the Tauri `center: true` conf
        // default (centered), which is never off-screen.
        console.warn('[pet] launch position resolve failed:', err);
      }

      // 2. Show the window at the now-correct position.
      try {
        await getCurrentWindow().show();
        // Re-assert the position AFTER show(). `show()` can reset the
        // NSWindow frame to the conf default, and `set_position` on a hidden
        // NSWindow may be deferred — re-invoke `set_pet_position` so a
        // pre-show position set on the wrong screen (multi-monitor setups
        // where the primary monitor is at negative global coords) is
        // corrected once the window is visible. Mirrors the existing
        // `set_pet_size` post-show re-assert below.
        if (physicalX !== null && physicalY !== null) {
          try {
            await invoke('set_pet_position', { x: physicalX, y: physicalY });
          } catch (err) {
            console.warn('[pet] set_pet_position post-show re-assert failed:', err);
          }
        }
        // Re-assert the pet size AFTER show(). macOS can defer `set_size` on
        // a HIDDEN NSWindow and `show()` may reset the frame to the conf
        // default (96×96, i.e. the `100` level). If the user saved a non-100
        // size, the pre-show `set_pet_size` (step 1) may have been clobbered
        // by show() — re-assert here so a non-default size reliably takes
        // effect on first launch. Mirrors the pet-panel post-show re-assert
        // pattern (see tauri-window-patterns.md "Secondary Opaque Panel Window").
        const { petSize: savedSize } = (await import('@/store/petStore')).usePetStore.getState();
        if (savedSize !== '100') {
          try {
            await invoke('set_pet_size', { level: savedSize });
          } catch (err) {
            console.warn('[pet] set_pet_size post-show re-assert failed:', err);
          }
        }
        // Re-apply persisted pet opacity + click-through. These are
        // window-level effects (NSWindow alpha, cursor-events ignore) so
        // the Rust command finds the `pet` window by label and applies
        // directly; the main window's settings page invokes the same
        // commands, but if the pet was hidden at the time, the calls were
        // no-ops on a missing window — re-assert here on mount so the
        // persisted values reliably take effect on first launch.
        const {
          petOpacity: savedOpacity,
          petClickThrough: savedClickThrough,
        } = (await import('@/store/petStore')).usePetStore.getState();
        if (savedOpacity !== '100') {
          try {
            await invoke('set_pet_opacity', { level: savedOpacity });
          } catch (err) {
            console.warn('[pet] set_pet_opacity post-show re-assert failed:', err);
          }
        }
        if (savedClickThrough) {
          try {
            await invoke('set_pet_click_through', { enabled: true });
          } catch (err) {
            console.warn('[pet] set_pet_click_through post-show re-assert failed:', err);
          }
        }
        await invoke('pet_set_topmost_level', { label: 'pet' });
        // Native transparency: Tauri's `transparent: true` config doesn't
        // reliably disable the macOS WKWebView's opaque background on all
        // builds, leaving a white rect around the circular mascot. The
        // `pet_make_transparent` command flips NSWindow opaque=NO +
        // backgroundColor=clear + WKWebView drawsBackground=NO on the main
        // thread so transparent CSS regions finally show the desktop. Called
        // once on mount, after show(). Pet-panel is opaque by design and is
        // NOT made transparent.
        try {
          await invoke('pet_make_transparent', { label: 'pet' });
        } catch (err) {
          console.warn('[pet] pet_make_transparent failed:', err);
        }
      } catch (err) {
        console.warn('[pet] initial show / set_topmost_level failed:', err);
      }
    })();
  }, []);
}
