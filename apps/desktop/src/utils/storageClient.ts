import { readTextFile, writeTextFile, mkdir, exists, remove } from '@tauri-apps/plugin-fs';
import { homeDir, join } from '@tauri-apps/api/path';
import { debounce } from './debounce';

// ponytail: per-key file storage at ~/.quill/storage/<safe>.json. Replaces
// the legacy single storage.json blob. Keys are sanitized to filename-safe
// segments (colon → underscore) so callers can keep using 'skills:all' /
// 'btai:sessions' / 'settings:all' style keys without caring about the
// on-disk layout. The dirty set + 300ms debounce preserves the single-writer
// contract — one flush writes every dirty key's file in one pass.

const FLUSH_DELAY = 300;

let dirPath = '';
let dirEnsured = false;
const cache = new Map<string, unknown>();
const dirty = new Set<string>();

async function getStorageDir(): Promise<string> {
  if (!dirPath) {
    const home = await homeDir();
    dirPath = await join(home, '.quill', 'storage');
  }
  if (!dirEnsured) {
    if (!(await exists(dirPath))) {
      await mkdir(dirPath, { recursive: true });
    }
    dirEnsured = true;
  }
  return dirPath;
}

async function filePathFor(key: string): Promise<string> {
  const safe = key.replace(/[^a-zA-Z0-9._-]/g, '_');
  return join(await getStorageDir(), `${safe}.json`);
}

function flushImpl(): void {
  void (async () => {
    try {
      for (const key of dirty) {
        const filePath = await filePathFor(key);
        await writeTextFile(filePath, JSON.stringify(cache.get(key), null, 2));
      }
      dirty.clear();
    } catch (err) {
      console.warn('[storageClient] Failed to flush:', err);
    }
  })();
}

const scheduleFlush = debounce(flushImpl, FLUSH_DELAY);

export const storageClient = {
  async get<T>(key: string): Promise<T | null> {
    if (cache.has(key)) return cache.get(key) as T | null;
    try {
      const filePath = await filePathFor(key);
      if (!(await exists(filePath))) return null;
      const raw = await readTextFile(filePath);
      const parsed = JSON.parse(raw);
      cache.set(key, parsed);
      return parsed as T;
    } catch {
      return null;
    }
  },

  async set(key: string, data: unknown): Promise<void> {
    cache.set(key, data);
    dirty.add(key);
    scheduleFlush();
  },

  async remove(key: string): Promise<void> {
    cache.delete(key);
    dirty.delete(key);
    try {
      const filePath = await filePathFor(key);
      if (await exists(filePath)) await remove(filePath);
    } catch {
      // ignore — missing file is the target state
    }
  },

  /** Test-only: reset the in-memory cache, dirty set, and dir-resolution
   *  state so the next access reloads from disk. */
  __resetForTesting(): void {
    cache.clear();
    dirty.clear();
    dirPath = '';
    dirEnsured = false;
    scheduleFlush.cancel();
  },
};
