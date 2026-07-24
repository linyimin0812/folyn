import { describe, it, expect, beforeEach, vi } from 'vitest';

// Tauri APIs are aliased to vi.fn mocks via vitest.workspace.ts (run from the
// monorepo root so the workspace file is discovered).
import { emit } from '@tauri-apps/api/event';
import { usePetStore } from '@/store/petStore';
import { decideNotification, dispatchNotification } from './petNotifyDispatcher';
import type { PetBubblePayload } from '@/components/pet/PetBubbleApp';

const emitMock = emit as unknown as import('vitest').Mock;

const samplePayload: PetBubblePayload = {
  title: '提醒',
  text: '这是一条气泡通知示例',
  kind: 'info',
  target: { kind: 'schedule', id: 'demo' },
  actions: [{ id: 'view', label: '查看详情', kind: 'primary' }],
};

describe('decideNotification', () => {
  it('routes bubble-only for bubble', () => {
    expect(decideNotification('bubble')).toEqual({ bubble: true, corner: false });
  });
  it('routes corner-only for corner', () => {
    expect(decideNotification('corner')).toEqual({ bubble: false, corner: true });
  });
  it('routes both for both', () => {
    expect(decideNotification('both')).toEqual({ bubble: true, corner: true });
  });
  it('routes neither for off', () => {
    expect(decideNotification('off')).toEqual({ bubble: false, corner: false });
  });
});

describe('dispatchNotification', () => {
  beforeEach(() => {
    emitMock.mockClear();
  });

  it('emits pet://bubble-show and no corner when form is bubble', async () => {
    usePetStore.setState({ notificationForm: 'bubble' });
    await dispatchNotification(samplePayload);
    expect(emitMock).toHaveBeenCalledWith('pet://bubble-show', samplePayload);
    expect(emitMock).not.toHaveBeenCalledWith('pet://corner-show', samplePayload);
  });

  it('emits pet://corner-show and no bubble when form is corner', async () => {
    usePetStore.setState({ notificationForm: 'corner' });
    await dispatchNotification(samplePayload);
    expect(emitMock).toHaveBeenCalledWith('pet://corner-show', samplePayload);
    expect(emitMock).not.toHaveBeenCalledWith('pet://bubble-show', samplePayload);
  });

  it('emits both bubble and corner when form is both', async () => {
    usePetStore.setState({ notificationForm: 'both' });
    await dispatchNotification(samplePayload);
    expect(emitMock).toHaveBeenCalledWith('pet://bubble-show', samplePayload);
    expect(emitMock).toHaveBeenCalledWith('pet://corner-show', samplePayload);
  });

  it('drops the payload when form is off', async () => {
    usePetStore.setState({ notificationForm: 'off' });
    await dispatchNotification(samplePayload);
    expect(emitMock).not.toHaveBeenCalled();
  });

  it('drops payloads with empty text', async () => {
    usePetStore.setState({ notificationForm: 'both' });
    await dispatchNotification({ ...samplePayload, text: '' });
    expect(emitMock).not.toHaveBeenCalled();
  });
});
