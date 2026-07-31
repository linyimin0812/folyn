import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { storageClient } from './storageClient';
import { readTextFile, writeTextFile } from '@tauri-apps/plugin-fs';

const STORAGE_DIR = '/mock/home/.quill/storage';
const path = (name: string) => `${STORAGE_DIR}/${name}`;

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

  it('removes a key from the cache and disk', async () => {
    await storageClient.set('k', 1);
    await vi.advanceTimersByTimeAsync(400);
    await storageClient.remove('k');
    expect(await storageClient.get('k')).toBeNull();
  });

  it('flushes each dirty key to its own file after the 300ms debounce', async () => {
    await storageClient.set('k', { a: 1 });
    await storageClient.set('prefs', { theme: 'dark' });
    await vi.advanceTimersByTimeAsync(400);
    const kRaw = await readTextFile(path('k.json'));
    expect(JSON.parse(kRaw)).toEqual({ a: 1 });
    const prefsRaw = await readTextFile(path('prefs.json'));
    expect(JSON.parse(prefsRaw)).toEqual({ theme: 'dark' });
  });

  it('returns null when the on-disk file is corrupted JSON', async () => {
    await writeTextFile(path('k.json'), '{broken');
    expect(await storageClient.get('k')).toBeNull();
  });

  it('loads existing on-disk content on first access', async () => {
    await writeTextFile(path('persisted.json'), JSON.stringify('hello'));
    expect(await storageClient.get<string>('persisted')).toBe('hello');
  });

  it('sanitizes keys with unsafe filename characters (colon → underscore)', async () => {
    await storageClient.set('skills:all', { x: 1 });
    await vi.advanceTimersByTimeAsync(400);
    const raw = await readTextFile(path('skills_all.json'));
    expect(JSON.parse(raw)).toEqual({ x: 1 });
  });
});
