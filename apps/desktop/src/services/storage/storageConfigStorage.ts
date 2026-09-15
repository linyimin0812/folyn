/**
 * Storage provider config persistence — `~/.folyn/image-hosts/<provider>.json`
 *
 * Mirrors the aiConfigStore secret-storage pattern: per-provider file,
 * atomic write (temp + rename), debounced flush, eager-load cache.
 * Secrets stay out of `~/.folyn/storage/*.json` (the plain-settings dir).
 *
 * Configs are opaque JSON keyed by provider id — built-ins write a
 * `provider` discriminator for self-narrowing; extension providers own
 * whatever shape they declare. The host never inspects the contents.
 */
import { homeDir, join } from '@tauri-apps/api/path';
import { exists, mkdir, readTextFile, writeTextFile, rename, readDir } from '@tauri-apps/plugin-fs';
import { debounce } from '@/utils/debounce';

import type { R2ProviderConfig, QiniuProviderConfig, OssProviderConfig } from './types';

const FLUSH_DELAY = 300;

let cachedBase: string | null = null;
let cache: Record<string, unknown> | null = null;
let loaded = false;

async function getBaseDir(): Promise<string> {
  if (cachedBase) return cachedBase;
  cachedBase = await join(await homeDir(), '.folyn', 'image-hosts');
  return cachedBase;
}

async function ensureLoaded(): Promise<void> {
  if (loaded) return;
  const base = await getBaseDir();
  if (!(await exists(base))) {
    await mkdir(base, { recursive: true });
  }
  cache = {};
  // Read every provider config file in the dir — built-ins (r2/qiniu/oss)
  // AND extension-contributed providers (e.g. github-jsdelivr). Keyed purely
  // by filename id; the host never inspects contents. A corrupt file is
  // skipped (next save overwrites with valid content).
  if (await exists(base)) {
    const entries = await readDir(base);
    for (const e of entries) {
      if (!e.name?.endsWith('.json')) continue;
      const id = e.name.slice(0, -5);
      const path = await join(base, e.name);
      try {
        const raw = await readTextFile(path);
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
          (cache as Record<string, unknown>)[id] = parsed;
        }
      } catch {
        // Corrupt file — skip.
      }
    }
  }
  loaded = true;
}

async function atomicWrite(path: string, data: unknown): Promise<void> {
  const dir = path.substring(0, path.lastIndexOf('/'));
  if (!(await exists(dir))) {
    await mkdir(dir, { recursive: true });
  }
  const tmp = `${path}.tmp`;
  await writeTextFile(tmp, JSON.stringify(data, null, 2) + '\n');
  await rename(tmp, path);
}

const flush = debounce(async () => {
  if (cache === null) return;
  const base = await getBaseDir();
  for (const id of Object.keys(cache)) {
    const path = await join(base, `${id}.json`);
    try {
      await atomicWrite(path, (cache as Record<string, unknown>)[id]);
    } catch (err) {
      console.warn(`[storageConfigStorage] Failed to flush ${id}:`, err);
    }
  }
}, FLUSH_DELAY);

export const storageConfigStorage = {
  async load(): Promise<Record<string, unknown>> {
    await ensureLoaded();
    return cache ?? {};
  },

  async get(id: string): Promise<unknown | null> {
    await ensureLoaded();
    return (cache as Record<string, unknown>)[id] ?? null;
  },

  async set(id: string, cfg: unknown): Promise<void> {
    await ensureLoaded();
    (cache as Record<string, unknown>)[id] = cfg;
    void flush();
  },

  async remove(id: string): Promise<void> {
    await ensureLoaded();
    if (!cache || !(id in cache)) return;
    delete (cache as Record<string, unknown>)[id];
    void flush();
  },

  /** Test-only: clear cache so next access reloads from disk. */
  __resetForTesting(): void {
    cache = null;
    loaded = false;
    cachedBase = null;
    flush.cancel();
  },

  /** Test-only: force flush. */
  async __flushForTesting(): Promise<void> {
    flush.cancel();
    if (cache === null) return;
    const base = await getBaseDir();
    for (const id of Object.keys(cache)) {
      const path = await join(base, `${id}.json`);
      await atomicWrite(path, (cache as Record<string, unknown>)[id]);
    }
  },
};

// ─── Defaults ───────────────────────────────────────────────────────────

export function defaultR2Config(): R2ProviderConfig {
  return {
    provider: 'r2',
    accountId: '',
    accessKeyId: '',
    secretAccessKey: '',
    bucket: '',
    publicBaseUrl: '',
    imageKeyPrefix: 'images/',
    htmlKeyPrefix: 'html/',
  };
}

export function defaultQiniuConfig(): QiniuProviderConfig {
  return {
    provider: 'qiniu',
    accessKey: '',
    secretKey: '',
    bucket: '',
    region: 'z0',
    publicBaseUrl: '',
    imageKeyPrefix: 'images/',
    htmlKeyPrefix: 'html/',
  };
}

export function defaultOssConfig(): OssProviderConfig {
  return {
    provider: 'oss',
    accessKeyId: '',
    accessKeySecret: '',
    bucket: '',
    region: '',
    publicBaseUrl: '',
    imageKeyPrefix: 'images/',
    htmlKeyPrefix: 'html/',
  };
}
