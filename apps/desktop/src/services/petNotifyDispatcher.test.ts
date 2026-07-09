import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Tauri APIs are aliased to vi.fn mocks via vitest.workspace.ts (run from the
// monorepo root so the workspace file is discovered). Mirrors the
// PetBubbleApp.test.tsx mock usage.
import { emit } from '@tauri-apps/api/event';
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
  registerActionTypes,
  onAction,
  __fireAction,
} from '@tauri-apps/plugin-notification';
import { useSettingsStore } from '@/store/settingsStore';
import {
  decideNotification,
  osNotify,
  dispatchNotification,
  startNotificationClickListener,
  __resetForTesting,
} from './petNotifyDispatcher';
import type { PetBubblePayload } from '@/components/pet/PetBubbleApp';

const emitMock = emit as unknown as import('vitest').Mock;
const isPermissionGrantedMock = isPermissionGranted as unknown as import('vitest').Mock;
const requestPermissionMock = requestPermission as unknown as import('vitest').Mock;
const sendNotificationMock = sendNotification as unknown as import('vitest').Mock;
const registerActionTypesMock = registerActionTypes as unknown as import('vitest').Mock;
const onActionMock = onAction as unknown as import('vitest').Mock;

const samplePayload: PetBubblePayload = {
  title: '提醒',
  text: '这是一条气泡通知示例',
  kind: 'info',
  target: { kind: 'schedule', id: 'demo' },
  actions: [{ id: 'view', label: '查看详情', kind: 'primary' }],
};

describe('decideNotification', () => {
  it('routes bubble-only for bubble', () => {
    expect(decideNotification('bubble')).toEqual({ bubble: true, system: false });
  });
  it('routes system-only for system', () => {
    expect(decideNotification('system')).toEqual({ bubble: false, system: true });
  });
  it('routes both for both', () => {
    expect(decideNotification('both')).toEqual({ bubble: true, system: true });
  });
  it('routes neither for off', () => {
    expect(decideNotification('off')).toEqual({ bubble: false, system: false });
  });
});

describe('dispatchNotification', () => {
  beforeEach(() => {
    emitMock.mockClear();
    sendNotificationMock.mockClear();
    isPermissionGrantedMock.mockClear();
    requestPermissionMock.mockClear();
    isPermissionGrantedMock.mockResolvedValue(true);
  });

  it('emits pet://bubble-show and no OS notification when form is bubble', async () => {
    useSettingsStore.setState({ notificationForm: 'bubble' });
    await dispatchNotification(samplePayload);
    expect(emitMock).toHaveBeenCalledWith('pet://bubble-show', samplePayload);
    expect(sendNotificationMock).not.toHaveBeenCalled();
  });

  it('sends an OS notification and no bubble when form is system', async () => {
    useSettingsStore.setState({ notificationForm: 'system' });
    await dispatchNotification(samplePayload);
    expect(emitMock).not.toHaveBeenCalled();
    expect(sendNotificationMock).toHaveBeenCalledTimes(1);
    const opts = sendNotificationMock.mock.calls[0][0] as Record<string, unknown>;
    expect(opts.title).toBe('提醒');
    expect(opts.body).toBe('这是一条气泡通知示例');
    expect(typeof opts.id).toBe('number');
  });

  it('sends both bubble and OS notification when form is both', async () => {
    useSettingsStore.setState({ notificationForm: 'both' });
    await dispatchNotification(samplePayload);
    expect(emitMock).toHaveBeenCalledWith('pet://bubble-show', samplePayload);
    expect(sendNotificationMock).toHaveBeenCalledTimes(1);
  });

  it('drops the payload when form is off', async () => {
    useSettingsStore.setState({ notificationForm: 'off' });
    await dispatchNotification(samplePayload);
    expect(emitMock).not.toHaveBeenCalled();
    expect(sendNotificationMock).not.toHaveBeenCalled();
  });
});

describe('osNotify + click→jump', () => {
  beforeEach(() => {
    __resetForTesting();
    sendNotificationMock.mockClear();
    emitMock.mockClear();
    isPermissionGrantedMock.mockClear();
    requestPermissionMock.mockClear();
    registerActionTypesMock.mockClear();
    isPermissionGrantedMock.mockResolvedValue(true);
  });

  it('requests permission when not granted', async () => {
    isPermissionGrantedMock.mockResolvedValue(false);
    requestPermissionMock.mockResolvedValue('granted');
    await osNotify(samplePayload);
    expect(requestPermissionMock).toHaveBeenCalled();
    expect(sendNotificationMock).toHaveBeenCalledTimes(1);
  });

  it('skips sending when permission is denied', async () => {
    isPermissionGrantedMock.mockResolvedValue(false);
    requestPermissionMock.mockResolvedValue('denied');
    await osNotify(samplePayload);
    expect(sendNotificationMock).not.toHaveBeenCalled();
  });

  it('registers the action type once, then reuses on subsequent calls', async () => {
    await osNotify(samplePayload);
    await osNotify(samplePayload);
    expect(registerActionTypesMock).toHaveBeenCalledTimes(1);
  });

  it('click listener looks up target by notification id and emits pet://bubble-action', async () => {
    // Start the click listener.
    const unlisten = await startNotificationClickListener();
    expect(onActionMock).toHaveBeenCalledTimes(1);

    // Send a notification (this stashes the target under the assigned id).
    await osNotify(samplePayload);
    const opts = sendNotificationMock.mock.calls[0][0] as { id: number };
    const id = opts.id;

    // Simulate the OS firing a click action for that notification id.
    emitMock.mockClear();
    __fireAction({ id });
    // The click handler does a dynamic `import('@tauri-apps/api/event')` then
    // emits — flush the microtask chain.
    await vi.waitFor(() => {
      expect(emitMock).toHaveBeenCalledWith(
        'pet://bubble-action',
        expect.objectContaining({
          type: 'navigate',
          target: { kind: 'schedule', id: 'demo' },
        }),
      );
    });

    // A second click for the same id finds nothing (one-shot lookup).
    emitMock.mockClear();
    __fireAction({ id });
    await Promise.resolve();
    await Promise.resolve();
    expect(emitMock).not.toHaveBeenCalled();

    await unlisten();
  });
});
