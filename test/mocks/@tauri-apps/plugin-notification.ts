import { vi } from 'vitest';

// Minimal mock of @tauri-apps/plugin-notification for the dispatcher tests.
// `sendNotification` captures the options so tests can assert on them;
// `onAction` captures the callback so tests can simulate a click.

export const isPermissionGranted = vi.fn(async () => true);
export const requestPermission = vi.fn(async () => 'granted' as const);
export const sendNotification = vi.fn((options: unknown) => undefined);
export const registerActionTypes = vi.fn(async () => undefined);

let actionCb: ((notification: { id?: number }) => void) | null = null;
export const onAction = vi.fn(async (cb: (notification: { id?: number }) => void) => {
  actionCb = cb;
  return {
    plugin: 'notification',
    event: 'action',
    channelId: 1,
    unregister: vi.fn(async () => undefined),
  } as unknown as import('@tauri-apps/api/core').PluginListener;
});

/** Test helper: simulate the OS firing a notification action (click). Exposed
 *  via the mock so the dispatcher test can drive `onAction`'s callback. */
export function __fireAction(notification: { id?: number }): void {
  if (actionCb) actionCb(notification);
}

export const __internals = {
  reset() {
    isPermissionGranted.mockClear();
    requestPermission.mockClear();
    sendNotification.mockClear();
    registerActionTypes.mockClear();
    onAction.mockClear();
    actionCb = null;
    isPermissionGranted.mockResolvedValue(true);
    requestPermission.mockResolvedValue('granted' as const);
  },
};
