import { useEffect } from 'react';
import { clampPetPosition, petSizeToPx, type PetSize } from './petPosition';
import type { PetWorkAreaResult } from './petPanelWindow';
import { isTauri } from '@/utils/platform';
import { usePetStore } from '@/store/petStore';
import { hydrateAllStores } from '@/store/settingsPersistence';
import type { Locale } from '@/i18n';

/**
 * Cross-window sync listeners for the `pet` window (settings / icon /
 * locale / size broadcasts from the main window). Extracted from PetApp.tsx.
 * Each listener applies the broadcast payload to this window's OWN store
 * instance — the `pet` Tauri window is a separate JS realm.
 */

/**
 * Re-apply the pet window's size + re-clamp its position for a size level.
 * Called when the pet window's store hydrates a persisted `petSize` AFTER the
 * mount effect already ran: the mount effect sizes the window from the
 * pre-hydration default (`100` → 96×96), so a persisted size > 100% would
 * leave the sprite layer rendering at 120/144px inside a still-96×96 OS
 * window — the window bounds then clip the mascot on relaunch. This
 * re-invokes `set_pet_size` and shifts the window so the larger footprint
 * stays fully on-screen (the same re-clamp the live `pet://size-changed`
 * path performs).
 */
async function applyPetSizeAndClamp(size: PetSize): Promise<void> {
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('set_pet_size', { level: size });

    const workArea = await invoke<PetWorkAreaResult>('pet_get_work_area');
    if (workArea.width <= 0 || workArea.height <= 0) return;

    const sf = workArea.scale_factor || 1;
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    const pos = await getCurrentWindow().outerPosition();
    const x = Math.round(pos.x / sf);
    const y = Math.round(pos.y / sf);
    const clamped = clampPetPosition(
      { x, y },
      { x: workArea.x, y: workArea.y, width: workArea.width, height: workArea.height, scale_factor: sf },
      petSizeToPx(size),
    );
    if (clamped.x !== x || clamped.y !== y) {
      await invoke('set_pet_position', { x: Math.round(clamped.x * sf), y: Math.round(clamped.y * sf) });
      usePetStore.getState().setPetPosition(clamped.x, clamped.y);
    }
  } catch (err) {
    console.warn('[pet] applyPetSizeAndClamp failed:', err);
  }
}

// ── Cross-window settings hydration ──
// The pet window holds its own petStore instance (separate JS realm).
// The main window hydrates from disk and broadcasts
// `pet://settings-updated` after every persist — without this listener the
// pet window would stay at DEFAULTS on every launch
// (`petIconSource='builtin'`), so a persisted custom icon never renders
// after a restart until the user re-touches icon settings (which fires
// `pet://icon-changed`). Hydrate from the broadcast, mirroring the
// pet-bubble / pet-corner / pet-panel / pet-menu windows. The startup
// broadcast can fire before this window's webview registers its listener,
// so emit `pet://settings-request` after registering — the main window
// answers with the current merged blob.

// ── Cross-window icon-change sync ──
// The `pet` Tauri window has its own JS context + its own Zustand store
// instance; `storageClient`'s in-memory cache is per-window with no cross-
// window invalidation. When the main window's PetSettings calls
// `setPetIcon(...)` / `addPetIcon` / `removePetIcon` / `resetPetIcons`,
// only the main window's store updates — this pet window would keep
// rendering the stale icon until next launch. The main window emits
// `pet://icon-changed` after every store mutation; this listener applies
// the payload to the pet window's own store instance so the mascot
// re-renders live. The payload carries `source` + `path` (the active
// selection) and `icons` (the full library) so the thumbnail strip + the
// mascot both stay in sync. Pattern mirrors the `pet://visibility-changed`
// listener in App.tsx. Wrapped in isTauri + try/catch so non-Tauri/test
// envs skip it.

// ── Cross-window locale change sync ──
// The main window's `localeStore.setLocale` emits `locale://changed` so
// other Tauri windows (pet / pet-panel / …) — each a separate JS realm
// with its own i18next + localeStore instance — can apply the new locale
// without a reload. `openPetContextMenu` reads `i18n.language` to pick
// Rust-side menu labels, so without this listener the pet's right-click
// menu would lag the user's last locale switch. Mirrors `pet://icon-changed`.
// Wrapped in isTauri + try/catch so non-Tauri/test envs skip it.

// ── Cross-window size change sync ──
// The main window's `handleAction('set-pet-size')` (App.tsx) calls Rust
// `set_pet_size` (which resizes the pet window) AND emits `pet://size-changed`
// here. This listener applies the new level to this pet window's own store
// instance (so `petSize` re-renders the sprite layer + mascot SVG) and
// re-clamps the position so a larger pet doesn't sit off-screen. Pattern
// mirrors `pet://icon-changed` above. Wrapped in isTauri + try/catch so
// non-Tauri/test envs skip it.

export function usePetWindowSync() {
  useEffect(() => {
    if (!isTauri()) return;
    let unlisten: (() => void) | undefined;
    (async () => {
      try {
        const { listen, emit } = await import('@tauri-apps/api/event');
        unlisten = await listen<Record<string, unknown>>(
          'pet://settings-updated',
          (event) => {
            if (!event.payload) return;
            const prevSize = usePetStore.getState().petSize;
            hydrateAllStores(event.payload);
            const nextSize = usePetStore.getState().petSize;
            // The pet window's store hydrates from this broadcast AFTER the
            // mount effect already sized the Tauri window to the default
            // (100%). A persisted non-default size must be re-applied here,
            // otherwise the larger sprite renders inside the still-96×96
            // window and the OS clips the mascot (size > 100% → occluded icon
            // on relaunch). Gated on an actual change: the broadcast also
            // fires for unrelated setting writes, and re-invoking
            // set_pet_size + re-clamping on every one would jitter position.
            if (nextSize !== prevSize) {
              void applyPetSizeAndClamp(nextSize);
            }
          },
        );
        await emit('pet://settings-request', {});
      } catch (err) {
        console.warn('[pet] settings-updated listener setup failed:', err);
      }
    })();
    return () => {
      if (unlisten) unlisten();
    };
  }, []);

  useEffect(() => {
    if (!isTauri()) return;
    let unlisten: (() => void) | undefined;
    (async () => {
      try {
        const { listen } = await import('@tauri-apps/api/event');
        const { usePetStore } = await import('@/store/petStore');
        unlisten = await listen<{
          source: 'builtin' | 'custom';
          path: string;
          icons?: unknown;
        }>(
          'pet://icon-changed',
          (event) => {
            const { source, path, icons } = event.payload ?? {};
            if (source !== 'builtin' && source !== 'custom') return;
            const cur = usePetStore.getState().petIcons;
            const nextIcons = Array.isArray(icons)
              ? icons.filter((p: unknown): p is string => typeof p === 'string')
              : cur;
            usePetStore.setState({
              petIconSource: source,
              petIconPath: typeof path === 'string' ? path : '',
              petIcons: nextIcons,
            });
          },
        );
      } catch (err) {
        console.warn('[pet] icon-changed listener setup failed:', err);
      }
    })();
    return () => {
      if (unlisten) unlisten();
    };
  }, []);

  useEffect(() => {
    if (!isTauri()) return;
    let unlisten: (() => void) | undefined;
    (async () => {
      try {
        const { listen } = await import('@tauri-apps/api/event');
        const i18n = (await import('@/i18n')).default;
        const { useLocaleStore } = await import('@/store/localeStore');
        unlisten = await listen<{ locale: Locale }>(
          'locale://changed',
          (event) => {
            const lg = event.payload?.locale;
            if (!lg) return;
            void i18n.changeLanguage(lg);
            useLocaleStore.setState({ locale: lg });
          },
        );
      } catch (err) {
        console.warn('[pet] locale-changed listener setup failed:', err);
      }
    })();
    return () => {
      if (unlisten) unlisten();
    };
  }, []);

  useEffect(() => {
    if (!isTauri()) return;
    let unlisten: (() => void) | undefined;
    (async () => {
      try {
        const { listen } = await import('@tauri-apps/api/event');
        const { invoke } = await import('@tauri-apps/api/core');
        const { getCurrentWindow } = await import('@tauri-apps/api/window');
        unlisten = await listen<{ size: '50' | '75' | '100' | '125' | '150' }>(
          'pet://size-changed',
          async (event) => {
            const size = event.payload?.size;
            if (size !== '50' && size !== '75' && size !== '100' && size !== '125' && size !== '150') return;
            const { usePetStore } = await import('@/store/petStore');
            usePetStore.setState({ petSize: size });
            // Re-clamp the current position with the new size so a larger
            // pet stays fully on-screen. Non-fatal if the work-area probe
            // fails — the saved position is unchanged and the user can
            // drag the pet back on-screen.
            try {
              const workArea = await invoke<PetWorkAreaResult>('pet_get_work_area');
              if (workArea.width > 0 && workArea.height > 0) {
                const sf = workArea.scale_factor || 1;
                const pos = await getCurrentWindow().outerPosition();
                const x = Math.round(pos.x / sf);
                const y = Math.round(pos.y / sf);
                const clamped = clampPetPosition(
                  { x, y },
                  { x: workArea.x, y: workArea.y, width: workArea.width, height: workArea.height, scale_factor: sf },
                  petSizeToPx(size),
                );
                if (clamped.x !== x || clamped.y !== y) {
                  await invoke('set_pet_position', { x: Math.round(clamped.x * sf), y: Math.round(clamped.y * sf) });
                  usePetStore.getState().setPetPosition(clamped.x, clamped.y);
                }
              }
            } catch (err) {
              console.warn('[pet] size-changed re-clamp failed:', err);
            }
          },
        );
      } catch (err) {
        console.warn('[pet] size-changed listener setup failed:', err);
      }
    })();
    return () => {
      if (unlisten) unlisten();
    };
  }, []);
}
