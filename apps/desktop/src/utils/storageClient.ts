import { readTextFile, writeTextFile, mkdir, exists } from '@tauri-apps/plugin-fs';
import { appDataDir, join } from '@tauri-apps/api/path';

let cache: Record<string, string> = {};
let loaded = false;
let storagePath = '';

let flushTimer: ReturnType<typeof setTimeout> | null = null;
const FLUSH_DELAY = 300;

async function getStoragePath(): Promise<string> {
  if (storagePath) return storagePath;
  const appData = await appDataDir();
  storagePath = await join(appData, 'storage.json');
  return storagePath;
}

async function ensureLoaded(): Promise<void> {
  if (loaded) return;
  const filePath = await getStoragePath();
  try {
    const dirPath = await join(await appDataDir(), '.');
    const dirExists = await exists(dirPath);
    if (!dirExists) {
      await mkdir(dirPath, { recursive: true });
    }
    const fileExists = await exists(filePath);
    if (fileExists) {
      const raw = await readTextFile(filePath);
      cache = JSON.parse(raw);
    }
  } catch {
    cache = {};
  }
  loaded = true;
}

function scheduleFlush(): void {
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = setTimeout(async () => {
    flushTimer = null;
    try {
      const filePath = await getStoragePath();
      const appData = await appDataDir();
      const dirExists = await exists(appData);
      if (!dirExists) {
        await mkdir(appData, { recursive: true });
      }
      await writeTextFile(filePath, JSON.stringify(cache, null, 2));
    } catch (err) {
      console.warn('[storageClient] Failed to flush:', err);
    }
  }, FLUSH_DELAY);
}

export const storageClient = {
  async get<T>(key: string): Promise<T | null> {
    await ensureLoaded();
    const raw = cache[key];
    if (raw === undefined || raw === null) return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  },

  async set(key: string, data: unknown): Promise<void> {
    await ensureLoaded();
    cache[key] = JSON.stringify(data);
    scheduleFlush();
  },

  async remove(key: string): Promise<void> {
    await ensureLoaded();
    delete cache[key];
    scheduleFlush();
  },
};
