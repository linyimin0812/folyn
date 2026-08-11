import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { usePetStore } from './petStore';
import { storageClient } from '@/utils/storageClient';
import { markSettingsHydrated } from './settingsPersistence';
import { PET_SIZE_VERSION, PET_SIZE_DEFAULT } from '@/components/pet/petPosition';

beforeEach(() => {
  storageClient.__resetForTesting();
  markSettingsHydrated();
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
    petIcons: [],
    petSizeVersion: 0,
    petSize: PET_SIZE_DEFAULT,
    notificationForm: 'bubble',
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('usePetStore setters', () => {
  it('setPetModeEnabled updates state but is deliberately NOT persisted', () => {
    // fix(pet): stop persisting petModeEnabled so the default true always
    // wins on launch — an off-state saved last session must not hide the pet.
    const setSpy = vi.spyOn(storageClient, 'set');
    usePetStore.getState().setPetModeEnabled(true);
    expect(usePetStore.getState().petModeEnabled).toBe(true);
    vi.advanceTimersByTime(400);
    const payload = setSpy.mock.calls[setSpy.mock.calls.length - 1][1] as Record<string, unknown>;
    expect(payload.petModeEnabled).toBeUndefined();
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

  it('addPetIcon appends to library and selects', () => {
    usePetStore.getState().addPetIcon('/a.png');
    expect(usePetStore.getState().petIcons).toEqual(['/a.png']);
    expect(usePetStore.getState().petIconSource).toBe('custom');
    expect(usePetStore.getState().petIconPath).toBe('/a.png');
    // Adding the same path does not duplicate.
    usePetStore.getState().addPetIcon('/a.png');
    expect(usePetStore.getState().petIcons).toEqual(['/a.png']);
    // A second upload selects it and appends.
    usePetStore.getState().addPetIcon('/b.png');
    expect(usePetStore.getState().petIcons).toEqual(['/a.png', '/b.png']);
    expect(usePetStore.getState().petIconPath).toBe('/b.png');
  });

  it('removePetIcon falls back to first survivor when active is removed', () => {
    usePetStore.getState().addPetIcon('/a.png');
    usePetStore.getState().addPetIcon('/b.png');
    usePetStore.getState().removePetIcon('/b.png');
    expect(usePetStore.getState().petIcons).toEqual(['/a.png']);
    expect(usePetStore.getState().petIconSource).toBe('custom');
    expect(usePetStore.getState().petIconPath).toBe('/a.png');
  });

  it('removePetIcon reverts to builtin when library empties', () => {
    usePetStore.getState().addPetIcon('/a.png');
    usePetStore.getState().removePetIcon('/a.png');
    expect(usePetStore.getState().petIcons).toEqual([]);
    expect(usePetStore.getState().petIconSource).toBe('builtin');
    expect(usePetStore.getState().petIconPath).toBe('');
  });

  it('resetPetIcons clears library and active selection', () => {
    usePetStore.getState().addPetIcon('/a.png');
    usePetStore.getState().addPetIcon('/b.png');
    usePetStore.getState().resetPetIcons();
    expect(usePetStore.getState().petIcons).toEqual([]);
    expect(usePetStore.getState().petIconSource).toBe('builtin');
    expect(usePetStore.getState().petIconPath).toBe('');
  });

  it('setPetIcon builtin preserves the library', () => {
    usePetStore.getState().addPetIcon('/a.png');
    usePetStore.getState().setPetIcon('builtin');
    expect(usePetStore.getState().petIconSource).toBe('builtin');
    expect(usePetStore.getState().petIconPath).toBe('');
    expect(usePetStore.getState().petIcons).toEqual(['/a.png']);
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

  it('coerces non-array petIcons to empty', () => {
    usePetStore.getState().hydrate({ petIcons: 'not-an-array' });
    expect(usePetStore.getState().petIcons).toEqual([]);
  });

  it('drops non-string entries from petIcons', () => {
    usePetStore.getState().hydrate({ petIcons: ['/a.png', 7, null, '/b.png'] });
    expect(usePetStore.getState().petIcons).toEqual(['/a.png', '/b.png']);
  });

  it('migrates a legacy single-icon path into the library', () => {
    usePetStore.getState().hydrate({
      petIconSource: 'custom',
      petIconPath: '/abs/pet-icon.png',
    });
    expect(usePetStore.getState().petIcons).toEqual(['/abs/pet-icon.png']);
    expect(usePetStore.getState().petIconPath).toBe('/abs/pet-icon.png');
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
      petIconSource: 'custom',
      petIconPath: '/abs/pet.png',
      petSize: '150',
      notificationForm: 'corner',
    });
    const s = usePetStore.getState();
    expect(s.petPositionX).toBe(250);
    expect(s.petPositionY).toBe(350);
    expect(s.petPanelX).toBe(10);
    expect(s.petPanelY).toBe(20);
    expect(s.petPanelWidth).toBe(440);
    expect(s.petPanelHeight).toBe(620);
    expect(s.petPanelSizeVersion).toBe(1);
    // petModeEnabled is deliberately not persisted — it is absent from the
    // blob above and stays at whatever the store already holds.
    expect(s.petIconSource).toBe('custom');
    expect(s.petIconPath).toBe('/abs/pet.png');
    expect(s.petSize).toBe('150');
    expect(s.notificationForm).toBe('corner');
  });
});
