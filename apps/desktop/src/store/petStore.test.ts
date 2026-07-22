import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { usePetStore } from './petStore';
import { storageClient } from '@/utils/storageClient';
import { PET_SIZE_VERSION, PET_SIZE_DEFAULT } from '@/components/pet/petPosition';

beforeEach(() => {
  storageClient.__resetForTesting();
  vi.useFakeTimers();
  usePetStore.setState({
    petModeEnabled: false,
    petPositionX: -1,
    petPositionY: -1,
    petPanelX: -1,
    petPanelY: -1,
    petPanelWidth: -1,
    petPanelHeight: -1,
    petPanelSizeVersion: 0,
    petPosVersion: 1,
    petIconSource: 'builtin',
    petIconPath: '',
    petSizeVersion: 0,
    petSize: PET_SIZE_DEFAULT,
    notificationForm: 'bubble',
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('usePetStore setters', () => {
  it('setPetModeEnabled updates + persists', () => {
    const setSpy = vi.spyOn(storageClient, 'set');
    usePetStore.getState().setPetModeEnabled(true);
    expect(usePetStore.getState().petModeEnabled).toBe(true);
    vi.advanceTimersByTime(400);
    const payload = setSpy.mock.calls[setSpy.mock.calls.length - 1][1] as Record<string, unknown>;
    expect(payload.petModeEnabled).toBe(true);
    setSpy.mockRestore();
  });

  it('setPetPosition updates X/Y', () => {
    usePetStore.getState().setPetPosition(120, 340);
    expect(usePetStore.getState().petPositionX).toBe(120);
    expect(usePetStore.getState().petPositionY).toBe(340);
  });

  it('setPetPanelSize updates W/H', () => {
    usePetStore.getState().setPetPanelSize(420, 600);
    expect(usePetStore.getState().petPanelWidth).toBe(420);
    expect(usePetStore.getState().petPanelHeight).toBe(600);
  });

  it('setPetPanelSizeVersion updates', () => {
    usePetStore.getState().setPetPanelSizeVersion(7);
    expect(usePetStore.getState().petPanelSizeVersion).toBe(7);
  });

  it('setPetIcon builtin clears path', () => {
    usePetStore.getState().setPetIcon('builtin');
    expect(usePetStore.getState().petIconSource).toBe('builtin');
    expect(usePetStore.getState().petIconPath).toBe('');
  });

  it('setPetIcon custom sets path', () => {
    usePetStore.getState().setPetIcon('custom', '/abs/path/icon.png');
    expect(usePetStore.getState().petIconSource).toBe('custom');
    expect(usePetStore.getState().petIconPath).toBe('/abs/path/icon.png');
  });

  it('setPetIcon custom without path keeps existing', () => {
    usePetStore.getState().setPetIcon('custom', '/abs/path/icon.png');
    usePetStore.getState().setPetIcon('custom');
    expect(usePetStore.getState().petIconPath).toBe('/abs/path/icon.png');
  });

  it('setPetSize updates', () => {
    usePetStore.getState().setPetSize('150');
    expect(usePetStore.getState().petSize).toBe('150');
  });

  it('setNotificationForm updates', () => {
    usePetStore.getState().setNotificationForm('system');
    expect(usePetStore.getState().notificationForm).toBe('system');
  });
});

describe('usePetStore.hydrate', () => {
  it('discards stale physical-pixel positions when petPosVersion !== 1', () => {
    usePetStore.getState().hydrate({
      petPosVersion: 0,
      petPositionX: 500,
      petPositionY: 600,
      petPanelX: 100,
      petPanelY: 200,
    });
    const s = usePetStore.getState();
    expect(s.petPositionX).toBe(-1);
    expect(s.petPositionY).toBe(-1);
    expect(s.petPanelX).toBe(-1);
    expect(s.petPanelY).toBe(-1);
    expect(s.petPosVersion).toBe(1);
  });

  it('discards pet window position when petSizeVersion mismatches', () => {
    usePetStore.getState().hydrate({
      petPosVersion: 1,
      petSizeVersion: 0,
      petPositionX: 300,
      petPositionY: 400,
    });
    const s = usePetStore.getState();
    expect(s.petPositionX).toBe(-1);
    expect(s.petPositionY).toBe(-1);
    expect(s.petSizeVersion).toBe(PET_SIZE_VERSION);
  });

  it('coerces invalid petIconSource to builtin', () => {
    usePetStore.getState().hydrate({ petIconSource: 'bogus', petIconPath: '/x' });
    expect(usePetStore.getState().petIconSource).toBe('builtin');
    expect(usePetStore.getState().petIconPath).toBe('');
  });

  it('coerces invalid petSize to default', () => {
    usePetStore.getState().hydrate({ petSize: 'bogus' });
    expect(usePetStore.getState().petSize).toBe(PET_SIZE_DEFAULT);
  });

  it('coerces invalid notificationForm to bubble', () => {
    usePetStore.getState().hydrate({ notificationForm: 'bogus' });
    expect(usePetStore.getState().notificationForm).toBe('bubble');
  });

  it('keeps valid persisted pet position when versions match', () => {
    usePetStore.getState().hydrate({
      petPosVersion: 1,
      petSizeVersion: PET_SIZE_VERSION,
      petPositionX: 250,
      petPositionY: 350,
      petPanelX: 10,
      petPanelY: 20,
      petPanelWidth: 440,
      petPanelHeight: 620,
      petPanelSizeVersion: 1,
      petModeEnabled: true,
      petIconSource: 'custom',
      petIconPath: '/abs/pet.png',
      petSize: '150',
      notificationForm: 'both',
    });
    const s = usePetStore.getState();
    expect(s.petPositionX).toBe(250);
    expect(s.petPositionY).toBe(350);
    expect(s.petPanelX).toBe(10);
    expect(s.petPanelY).toBe(20);
    expect(s.petPanelWidth).toBe(440);
    expect(s.petPanelHeight).toBe(620);
    expect(s.petPanelSizeVersion).toBe(1);
    expect(s.petModeEnabled).toBe(true);
    expect(s.petIconSource).toBe('custom');
    expect(s.petIconPath).toBe('/abs/pet.png');
    expect(s.petSize).toBe('150');
    expect(s.notificationForm).toBe('both');
  });
});
