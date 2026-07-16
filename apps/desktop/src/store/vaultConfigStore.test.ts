import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useVaultConfigStore } from './vaultConfigStore';
import { storageClient } from '@/utils/storageClient';

beforeEach(() => {
  storageClient.__resetForTesting();
  vi.useFakeTimers();
  useVaultConfigStore.setState({
    vaultPath: '~/Documents/quill/my-notes',
    imagePath: 'assets/images/',
    docExtension: '.md',
    watchFileChanges: true,
    trashOnDelete: true,
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useVaultConfigStore setters', () => {
  it('setVaultPath updates + persists', () => {
    const setSpy = vi.spyOn(storageClient, 'set');
    useVaultConfigStore.getState().setVaultPath('/custom/path');
    expect(useVaultConfigStore.getState().vaultPath).toBe('/custom/path');
    vi.advanceTimersByTime(400);
    const payload = setSpy.mock.calls[setSpy.mock.calls.length - 1][1] as Record<string, unknown>;
    expect(payload.vaultPath).toBe('/custom/path');
    setSpy.mockRestore();
  });

  it('setTrashOnDelete updates', () => {
    useVaultConfigStore.getState().setTrashOnDelete(false);
    expect(useVaultConfigStore.getState().trashOnDelete).toBe(false);
  });
});

describe('useVaultConfigStore.hydrate', () => {
  it('applies fields from the blob', () => {
    useVaultConfigStore.getState().hydrate({
      vaultPath: '/hydrated',
      imagePath: 'img/',
      docExtension: '.txt',
      watchFileChanges: false,
    });
    const s = useVaultConfigStore.getState();
    expect(s.vaultPath).toBe('/hydrated');
    expect(s.imagePath).toBe('img/');
    expect(s.docExtension).toBe('.txt');
    expect(s.watchFileChanges).toBe(false);
  });

  it('missing fields keep defaults', () => {
    useVaultConfigStore.getState().hydrate({ docExtension: '.org' });
    expect(useVaultConfigStore.getState().vaultPath).toBe('~/Documents/quill/my-notes');
    expect(useVaultConfigStore.getState().docExtension).toBe('.org');
  });
});
