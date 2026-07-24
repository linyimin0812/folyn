// usePetHostBridge — main-window pet Tauri event-bus hook
// (PRD: extract-pet-host-bridge-from-app).
//
// Owns the four `pet://` listen channels + launch restore + pet icon orphan
// sweep + the petNotifyDispatcher hookup, lifted verbatim from App.tsx
// :167-397. App calls `usePetHostBridge()` once; all unlisten/cleanup lives
// in the effect's return. Currently dormant (App.tsx still holds the inline
// copy — PR2 swaps it for `usePetHostBridge()`). Behavior is identical to the
// inline plumbing this replaces.
//
// Spec: hook-guidelines.md (effect cleanup), tauri-window-patterns.md
// (pet:// channels, window isolation), component-guidelines.md.

import { useEffect } from 'react';
import { isTauri } from '@/utils/platform';
import { usePetStore } from '@/store/petStore';
import { settingsLoadDone } from '@/store/settingsPersistence';
import { dispatchNotification } from '@/services/petNotifyDispatcher';
import { routePetMenuAction, routePetBubbleAction } from '@/services/petHostRouter';
import type { PetMenuAction } from '@/components/pet/PetContextMenu';
import type { PetBubbleActionEvent, PetBubblePayload } from '@/components/pet/PetBubbleApp';

/**
 * Assemble the desktop-pet host bridge in the main window. Wires the
 * `pet://menu-action` / `pet://bubble-action` / `pet://visibility-changed` /
 * `pet://notify` listeners, re-shows the pet window on launch if pet mode
 * was left on, and sweeps orphaned pet-icon files. No-op (returns nothing)
 * outside Tauri.
 */
export function usePetHostBridge(): void {
  // ── Pet icon library reconcile + orphan sweep (PRD: settings-pet-tab-and-custom-icon) ──
  // On startup, reconcile the persisted `petIcons` library + active
  // `petIconPath` with the actual files under appDataDir. Lives in the MAIN
  // window (not PetApp) because the fs plugin calls require ACL permissions
  // the main window has but the pet window does not. Wrapped in isTauri +
  // try/catch so non-Tauri / test envs skip it.
  useEffect(() => {
    if (!isTauri()) return;
    let cancelled = false;
    (async () => {
      try {
        // ponytail: wait for hydration before reading the store — otherwise
        // the default `petIconSource='builtin'` sends this effect down the
        // orphan-sweep branch, which deletes the user's `pet-icon.<ext>`
        // file before hydrate restores the `custom/path` state. The mascot's
        // `<img>` onError then clears the flag, and persistence is lost.
        await settingsLoadDone;
        if (cancelled) return;
        const { exists, remove, readDir } = await import('@tauri-apps/plugin-fs');
        const { appDataDir, join } = await import('@tauri-apps/api/path');
        const appData = await appDataDir();
        const { petIconSource, petIconPath, petIcons } = usePetStore.getState();

        // Verify every library entry + the active path (if custom). Drop
        // any whose file is missing — `removePetIcon` handles the
        // active-fallback (picks first survivor, or reverts to builtin if
        // the library is now empty).
        if (petIconSource === 'custom' && petIconPath) {
          const paths = Array.from(new Set([petIconPath, ...petIcons]));
          for (const p of paths) {
            if (cancelled) break;
            let ok = false;
            try { ok = await exists(p); } catch { ok = false; }
            if (!ok && !cancelled) {
              console.warn('[App] pet custom icon file missing, dropping:', p);
              usePetStore.getState().removePetIcon(p);
            }
          }
        } else if (petIcons.length === 0) {
          // Orphan sweep: only when the library is empty (no entries to
          // preserve — covers the legacy single-icon schema and any reset
          // that failed mid-delete). Matches the old `!(custom && path)`
          // gate, scoped to the new multi-icon library model. Builtin view
          // WITH a non-empty library skips this so saved icons survive.
          try {
            const entries = await readDir(appData);
            for (const e of entries) {
              if (cancelled) break;
              if (!e.name.startsWith('pet-icon')) continue;
              try {
                await remove(await join(appData, e.name));
              } catch {
                // Non-fatal; best-effort cleanup.
              }
            }
          } catch {
            // readDir on appDataDir can fail on permission / platform edge
            // cases — non-fatal, the sweep is best-effort.
          }
        }
      } catch (err) {
        console.warn('[App] pet icon sweep failed:', err);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // ── Desktop Pet Mode bridge (macOS MVP) ──
  // (1) On launch, if the user had pet mode enabled, re-show the pet window.
  // (2) Listen for `pet://menu-action` / `pet://visibility-changed` /
  //     `pet://bubble-action` / `pet://notify` and dispatch to the routers /
  //     dispatcher. All unlisten functions disconnect on cleanup.
  useEffect(() => {
    if (!isTauri()) return;
    let unlisten: (() => void) | null = null;
    let cancelled = false;

    (async () => {
      // Launch restore: only re-show if the user left pet mode on.
      const { petModeEnabled } = usePetStore.getState();
      if (petModeEnabled) {
        try {
          const { invoke } = await import('@tauri-apps/api/core');
          // Idempotent show — never hides. `toggle_pet_mode` would race
          // with `PetApp`'s mount-time position+show, leaving the first
          // frame at the OS-chosen default (off-screen on multi-monitor
          // setups where the primary monitor is at negative global coords).
          // `show_pet_if_hidden` lets `PetApp`'s mount effect own the
          // position+show ordering; if the pet is already visible by the
          // time this runs, it's a no-op.
          await invoke('show_pet_if_hidden');
        } catch {
          // Non-fatal.
        }
      }
      // Event listener for pet → main window actions.
      const { listen } = await import('@tauri-apps/api/event');
      const unAction = await listen<{
        action: PetMenuAction;
        size?: '50' | '75' | '100' | '125' | '150';
        opacity?: '25' | '50' | '75' | '100';
        clickThrough?: boolean;
      }>(
        'pet://menu-action',
        (event) => {
          if (event.payload?.action) {
            void routePetMenuAction(
              event.payload.action,
              event.payload?.size,
              event.payload?.opacity,
              event.payload?.clickThrough,
            );
          }
        },
      );
      // Visibility sync: when the pet is toggled via the menu bar / keyboard
      // shortcut, Rust emits this so the frontend preference stays in sync.
      const unVis = await listen<boolean>('pet://visibility-changed', (event) => {
        usePetStore.getState().setPetModeEnabled(!!event.payload);
      });
      // Bubble jump: the pet-bubble window emits `pet://bubble-action` when
      // the user clicks a bubble title / action button; route the jump.
      const unBubble = await listen<PetBubbleActionEvent>('pet://bubble-action', (event) => {
        if (event.payload) void routePetBubbleAction(event.payload);
      });
      // Unified notification entry: trigger sources emit `pet://notify` with
      // a PetBubblePayload; the dispatcher routes it by
      // `petStore.notificationForm` to the in-app bubble and/or the in-app
      // corner toast. Both re-emit the same `pet://bubble-action` on click
      // → jump, handled by `unBubble` above.
      const unNotify = await listen<PetBubblePayload>('pet://notify', (event) => {
        if (event.payload) void dispatchNotification(event.payload);
      });
      if (cancelled) {
        unAction();
        unVis();
        unBubble();
        unNotify();
      } else {
        unlisten = () => {
          unAction();
          unVis();
          unBubble();
          unNotify();
        };
      }
    })();

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);
}
