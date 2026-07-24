// Main-window notification dispatcher (PRD: pet-popover-corner).
//
// Sits in the MAIN window. Trigger sources emit a single `pet://notify` event
// carrying a `PetBubblePayload`; this dispatcher reads
// `petStore.notificationForm` and routes the payload to:
//   - `'bubble'`  → re-emits `pet://bubble-show` (the `pet-bubble` window shows the in-app Popover card)
//   - `'corner'`  → re-emits `pet://corner-show` (the new `pet-corner` window shows the in-app corner toast stack)
//   - `'off'`     → dropped
//
// The OS-native notification path (`@tauri-apps/plugin-notification`) was
// removed in favor of the in-app corner toast — see Decision Log D1 in
// `.trellis/tasks/07-24-pet-popover-corner/prd.md`. The corner toast reuses
// `pet://bubble-action` for click → jump routing, so App.tsx's existing jump
// router is unchanged.
//
// This module is main-window-only: it imports `usePetStore`. Secondary
// windows must NOT import it (see tauri-window-patterns.md "Common Mistake:
// Per-Session CLI Adapter...").

import { usePetStore, type NotificationForm } from '@/store/petStore';
import type { PetBubblePayload } from '@/components/pet/PetBubbleApp';

/** Whether a given `notificationForm` should surface the in-app bubble / the
 *  in-app corner toast. Pure — unit-tested directly. */
export function decideNotification(
  form: NotificationForm,
): { bubble: boolean; corner: boolean } {
  switch (form) {
    case 'bubble':
      return { bubble: true, corner: false };
    case 'corner':
      return { bubble: false, corner: true };
    case 'off':
      return { bubble: false, corner: false };
  }
}

/** Route a `pet://notify` payload according to `petStore.notificationForm`.
 *  This is the entry point the main-window `pet://notify` listener calls. */
export async function dispatchNotification(payload: PetBubblePayload): Promise<void> {
  if (!payload?.text) return;
  const form = usePetStore.getState().notificationForm;
  const { bubble, corner } = decideNotification(form);
  if (bubble) {
    try {
      const { emit } = await import('@tauri-apps/api/event');
      await emit('pet://bubble-show', payload);
    } catch {
      // Non-fatal — the bubble window may not exist (e.g. pet mode off).
    }
  }
  if (corner) {
    try {
      const { emit } = await import('@tauri-apps/api/event');
      await emit('pet://corner-show', payload);
    } catch {
      // Non-fatal — the corner window may not exist (e.g. pet mode off).
    }
  }
}
