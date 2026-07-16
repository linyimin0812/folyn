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
import {
  dispatchNotification,
  startNotificationClickListener,
} from '@/services/petNotifyDispatcher';
import { routePetMenuAction, routePetBubbleAction } from '@/services/petHostRouter';
import type { PetMenuAction } from '@/components/pet/PetContextMenu';
import type { PetBubbleActionEvent, PetBubblePayload } from '@/components/pet/PetBubbleApp';

/**
 * Assemble the desktop-pet host bridge in the main window. Wires the
 * `pet://menu-action` / `pet://bubble-action` / `pet://visibility-changed` /
 * `pet://notify` listeners, re-shows the pet window on launch if pet mode
 * was left on, sweeps orphaned pet-icon files, and starts the OS
 * notification click listener. No-op (returns nothing) outside Tauri.
 */
export function usePetHostBridge(): void {
  // ── Pet icon orphan sweep + fallback (PRD: settings-pet-tab-and-custom-icon) ──
  // On startup, reconcile the persisted `petIconSource` / `petIconPath` with
  // the actual files under appDataDir. Lives in the MAIN window (not PetApp)
  // because the fs plugin calls require ACL permissions the main window has
  // but the pet window does not. Wrapped in isTauri + try/catch so non-Tauri
  // / test envs skip it.
  useEffect(() => {
    if (!isTauri()) return;
    let cancelled = false;
    (async () => {
      try {
        const { exists, remove, readDir } = await import('@tauri-apps/plugin-fs');
        const { appDataDir, join } = await import('@tauri-apps/api/path');
        const appData = await appDataDir();
        const { petIconSource, petIconPath } = usePetStore.getState();

        if (petIconSource === 'custom' && petIconPath) {
          // Fallback: custom flag set but file missing → clear flag.
          let fileExists = false;
          try {
            fileExists = await exists(petIconPath);
          } catch {
            // exists() can throw on permission errors; treat as "missing"
            // so the flag clears and the pet doesn't render a broken icon.
            fileExists = false;
          }
          if (!fileExists && !cancelled) {
            console.warn('[App] pet custom icon file missing, clearing flag:', petIconPath);
            usePetStore.getState().setPetIcon('builtin');
          }
        } else {
          // Orphan sweep: delete any leftover pet-icon.<ext> files in
          // appDataDir so they don't accumulate across reset cycles.
          try {
            const entries = await readDir(appData);
            for (const e of entries) {
              if (cancelled) break;
              if (!e.name.startsWith('pet-icon.')) continue;
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
          // The pet window starts hidden; toggle → show.
          await invoke('toggle_pet_mode');
        } catch {
          // Non-fatal.
        }
      }
      // Event listener for pet → main window actions.
      const { listen } = await import('@tauri-apps/api/event');
      const unAction = await listen<{ action: PetMenuAction; size?: 'small' | 'medium' | 'large' }>(
        'pet://menu-action',
        (event) => {
          if (event.payload?.action) void routePetMenuAction(event.payload.action, event.payload?.size);
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
      // `petStore.notificationForm` to the in-app bubble and/or an OS native
      // notification. The OS notification click→jump reuses
      // `pet://bubble-action` above.
      const unNotify = await listen<PetBubblePayload>('pet://notify', (event) => {
        if (event.payload) void dispatchNotification(event.payload);
      });
      // OS notification click listener: maps `notification.id` → target →
      // emits `pet://bubble-action` (handled by `unBubble` above). Registered
      // once for the main window's lifetime.
      const unNotifClick = await startNotificationClickListener();
      if (cancelled) {
        unAction();
        unVis();
        unBubble();
        unNotify();
        unNotifClick();
      } else {
        unlisten = () => {
          unAction();
          unVis();
          unBubble();
          unNotify();
          unNotifClick();
        };
      }
    })();

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);
}
