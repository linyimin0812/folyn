// Main-window notification dispatcher (PRD: pet-popup-bubble-notification).
//
// Sits in the MAIN window. Trigger sources emit a single `pet://notify` event
// carrying a `PetBubblePayload`; this dispatcher reads
// `settingsStore.notificationForm` and routes the payload to:
//   - `'bubble'`  → re-emits `pet://bubble-show` (the `pet-bubble` window shows the in-app bubble)
//   - `'system'`  → `osNotify()` (tauri-plugin-notification, OS native notification)
//   - `'both'`     → bubble + OS notification
//   - `'off'`      → dropped
//
// OS notification click→jump: `tauri-plugin-notification` v2.3.3 exposes
// `onAction(cb: (notification: Options) => void)` (NOT `onNotificationEvent` —
// that name does not exist in this version). We register a single action type
// `pet-notify` with one `view` action so the notification carries a visible
// "查看详情" button; clicking it (or the notification body, where the platform
// fires the default action) invokes `onAction` with the full `Options`,
// including `id`. We use `notification.id` to look up the jump `target` in a
// module-local `Map<id, target>` — NOT the `extra` field — because the
// research established `extra` round-trip is unreliable across platforms, and
// id-lookup is the contract the bubble path already uses. The looked-up target
// is emitted on `pet://bubble-action` so the existing App.tsx jump router
// handles it uniformly.
//
// This module is main-window-only: it imports `@tauri-apps/plugin-notification`
// (a Tauri plugin) and `useSettingsStore`. Secondary windows must NOT import it
// (see tauri-window-patterns.md "Common Mistake: Per-Session CLI Adapter...").

import { isTauri } from '@/utils/platform';
import { useSettingsStore, type NotificationForm } from '@/store/settingsStore';
import type { PetBubblePayload, PetBubbleTarget } from '@/components/pet/PetBubbleApp';

/** The action-type id registered with the OS notification plugin. */
const PET_NOTIFY_ACTION_TYPE_ID = 'pet-notify';
/** The single action button rendered on OS notifications. */
const PET_NOTIFY_VIEW_ACTION_ID = 'view';

/** Whether a given `notificationForm` should surface the in-app bubble / the OS
 *  notification. Pure — unit-tested directly. */
export function decideNotification(
  form: NotificationForm,
): { bubble: boolean; system: boolean } {
  switch (form) {
    case 'bubble':
      return { bubble: true, system: false };
    case 'system':
      return { bubble: false, system: true };
    case 'both':
      return { bubble: true, system: true };
    case 'off':
      return { bubble: false, system: false };
  }
}

/** Module-local id→target map for OS notification click routing. The id is the
 *  `Options.id` we pass to `sendNotification`. Entries are removed on click
 *  (one-shot) and lazily on a 60s timeout (the OS notification itself is
 *  long-lived but the jump intent is not). Lost on process exit, which is fine
 *  — the notification only lives as long as the app does anyway. */
const targetById = new Map<number, PetBubbleTarget>();
let nextId = 1;
let actionTypesRegistered = false;

/** Test-only: reset module-level mutable state (id counter, action-type
 *  registration flag, target map) so tests start from a clean baseline. */
export function __resetForTesting(): void {
  targetById.clear();
  nextId = 1;
  actionTypesRegistered = false;
}

/** Show an OS native notification for the payload. Requests permission on
 *  first use, assigns a numeric id, stashes the target for click lookup, and
 *  sends. Swallows errors (e.g. permission denied, non-Tauri env) so the
 *  dispatcher never throws into the event listener. */
export async function osNotify(payload: PetBubblePayload): Promise<void> {
  if (!isTauri()) return;
  try {
    const {
      isPermissionGranted,
      requestPermission,
      sendNotification,
      registerActionTypes,
    } = await import('@tauri-apps/plugin-notification');
    const granted = await isPermissionGranted();
    if (!granted) {
      const permission = await requestPermission();
      if (permission !== 'granted') return;
    }
    // Register the action type once per process. Re-registering is harmless but
    // unnecessary; the idempotent guard avoids repeated IPC on every notify.
    if (!actionTypesRegistered) {
      try {
        await registerActionTypes([
          {
            id: PET_NOTIFY_ACTION_TYPE_ID,
            actions: [{ id: PET_NOTIFY_VIEW_ACTION_ID, title: '查看详情' }],
          },
        ]);
      } catch {
        // Non-fatal — the notification still shows without the action button;
        // click→jump just becomes best-effort on platforms that fire the
        // default action without a registered action type.
      }
      actionTypesRegistered = true;
    }
    const id = nextId++;
    if (payload.target) {
      targetById.set(id, payload.target);
      // Lazy cleanup so the map doesn't grow unbounded for notifications the
      // user never clicks. 60s matches the OS notification's effective lifetime
      // for our purposes.
      setTimeout(() => targetById.delete(id), 60_000);
    }
    sendNotification({
      id,
      title: payload.title ?? '通知',
      body: payload.text,
      actionTypeId: PET_NOTIFY_ACTION_TYPE_ID,
      extra: payload.target ? { target: payload.target } : undefined,
    });
  } catch {
    // Non-fatal — a denied permission or plugin error must not break the
    // bubble path (which the dispatcher may also fire for `'both'`).
  }
}

/** Route a `pet://notify` payload according to `settingsStore.notificationForm`.
 *  This is the entry point the main-window `pet://notify` listener calls. */
export async function dispatchNotification(payload: PetBubblePayload): Promise<void> {
  if (!payload?.text) return;
  const form = useSettingsStore.getState().notificationForm;
  const { bubble, system } = decideNotification(form);
  if (bubble) {
    try {
      const { emit } = await import('@tauri-apps/api/event');
      await emit('pet://bubble-show', payload);
    } catch {
      // Non-fatal — the bubble window may not exist (e.g. pet mode off).
    }
  }
  if (system) {
    await osNotify(payload);
  }
}

/** Register the OS notification click listener. Returns an unlisten function
 *  for the caller's effect cleanup. On a click, looks up the target by
 *  `notification.id` and emits `pet://bubble-action` so App.tsx's existing
 *  jump router handles it. No-op (returns a no-op unlisten) in non-Tauri envs
 *  so tests / web mode don't hit the plugin. */
export async function startNotificationClickListener(): Promise<() => void> {
  if (!isTauri()) return () => {};
  try {
    const { onAction } = await import('@tauri-apps/plugin-notification');
    const listener = await onAction((notification) => {
      const id = notification.id;
      if (id === undefined) return;
      const target = targetById.get(id);
      if (target) {
        targetById.delete(id);
        void import('@tauri-apps/api/event').then(({ emit }) => {
          emit('pet://bubble-action', { type: 'navigate' as const, target });
        });
      }
    });
    return () => {
      listener.unregister();
    };
  } catch {
    return () => {};
  }
}
