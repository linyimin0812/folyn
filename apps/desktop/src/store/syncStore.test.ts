import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useSyncStore } from './syncStore';
import { storageClient } from '@/utils/storageClient';

beforeEach(() => {
  storageClient.__resetForTesting();
  vi.useFakeTimers();
  useSyncStore.setState({
    syncMethod: 'S3 兼容（R2 / MinIO）',
    syncEndpoint: '',
    syncAccessKey: '',
    syncSecretKey: '',
    syncBucket: '',
    autoSync: true,
    e2eEncrypt: false,
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useSyncStore setters', () => {
  it('setSyncEndpoint updates + persists', () => {
    const setSpy = vi.spyOn(storageClient, 'set');
    useSyncStore.getState().setSyncEndpoint('https://example.com');
    expect(useSyncStore.getState().syncEndpoint).toBe('https://example.com');
    vi.advanceTimersByTime(400);
    const payload = setSpy.mock.calls[setSpy.mock.calls.length - 1][1] as Record<string, unknown>;
    expect(payload.syncEndpoint).toBe('https://example.com');
    setSpy.mockRestore();
  });

  it('setAutoSync updates', () => {
    useSyncStore.getState().setAutoSync(false);
    expect(useSyncStore.getState().autoSync).toBe(false);
  });
});

describe('useSyncStore.hydrate', () => {
  it('applies fields from the blob', () => {
    useSyncStore.getState().hydrate({
      syncMethod: 'WebDAV',
      syncEndpoint: 'https://dav.example.com',
      syncBucket: 'bucket-1',
      autoSync: false,
      e2eEncrypt: true,
    });
    const s = useSyncStore.getState();
    expect(s.syncMethod).toBe('WebDAV');
    expect(s.syncEndpoint).toBe('https://dav.example.com');
    expect(s.syncBucket).toBe('bucket-1');
    expect(s.autoSync).toBe(false);
    expect(s.e2eEncrypt).toBe(true);
  });

  it('missing fields keep defaults', () => {
    useSyncStore.getState().hydrate({ autoSync: false });
    expect(useSyncStore.getState().syncMethod).toBe('S3 兼容（R2 / MinIO）');
    expect(useSyncStore.getState().autoSync).toBe(false);
  });
});
