import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { storageClient } from './storageClient';
import { readTextFile, writeTextFile } from '@tauri-apps/plugin-fs';

const STORAGE_PATH = '/mock/appdata/storage.json';

describe('storageClient', () => {
  beforeEach(() => {
    storageClient.__resetForTesting();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    storageClient.__resetForTesting();
  });

  it('returns null for a missing key on first load', async () => {
    expect(await storageClient.get('missing')).toBeNull();
  });

  it('round-trips a value through the in-memory cache', async () => {
    await storageClient.set('k', { a: 1 });
    expect(await storageClient.get<{ a: number }>('k')).toEqual({ a: 1 });
  });

  it('removes a key from the cache', async () => {
    await storageClient.set('k', 1);
    await storageClient.remove('k');
    expect(await storageClient.get('k')).toBeNull();
  });

  it('flushes the cache to disk after the 300ms debounce', async () => {
    await storageClient.set('k', { a: 1 });
    await vi.advanceTimersByTimeAsync(400);
    const raw = await readTextFile(STORAGE_PATH);
    expect(JSON.parse(raw)).toEqual({ k: '{"a":1}' });
  });

  it('returns null when the cached raw value is corrupted JSON', async () => {
    await writeTextFile(STORAGE_PATH, JSON.stringify({ k: '{broken' }));
    expect(await storageClient.get('k')).toBeNull();
  });

  it('loads existing on-disk content on first access', async () => {
    await writeTextFile(STORAGE_PATH, JSON.stringify({ persisted: '"hello"' }));
    expect(await storageClient.get<string>('persisted')).toBe('hello');
  });
});
