/**
 * Storage provider config persistence — `~/.quill/image-hosts/<provider>.json`
 *
 * Mirrors the aiConfigStore secret-storage pattern: per-provider file,
 * atomic write (temp + rename), debounced flush, eager-load cache.
 * Secrets stay out of `~/.quill/storage/*.json` (the plain-settings dir).
 */
import { homeDir, join } from '@tauri-apps/api/path';
import { exists, mkdir, readTextFile, writeTextFile, rename } from '@tauri-apps/plugin-fs';
import { debounce } from '@/utils/debounce';
import type { ProviderConfig, R2ProviderConfig, QiniuProviderConfig, OssProviderConfig } from './types';

const FLUSH_DELAY = 300;

let cachedBase: string | null = null;
let cache: Partial<Record<string, ProviderConfig>> | null = null;
let loaded = false;

async function getBaseDir(): Promise<string> {
  if (cachedBase) return cachedBase;
  cachedBase = await join(await homeDir(), '.quill', 'image-hosts');
  return cachedBase;
}

async function ensureLoaded(): Promise<void> {
  if (loaded) return;
  const base = await getBaseDir();
  if (!(await exists(base))) {
    await mkdir(base, { recursive: true });
  }
  cache = {};
  // ponytail: one file per provider id. Read each eagerly; missing/empty
  // → skip. No glob needed — provider ids are known.
  for (const id of ['r2', 'qiniu', 'oss']) {
    const path = await join(base, `${id}.json`);
    if (!(await exists(path))) continue;
    try {
      const raw = await readTextFile(path);
      const parsed = JSON.parse(raw) as ProviderConfig;
      if (parsed && typeof parsed === 'object' && parsed.provider === id) {
        (cache as Record<string, ProviderConfig>)[id] = parsed;
      }
    } catch {
      // Corrupt file — skip; next save overwrites with valid content.
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
      await atomicWrite(path, (cache as Record<string, ProviderConfig>)[id]);
    } catch (err) {
      console.warn(`[storageConfigStorage] Failed to flush ${id}:`, err);
    }
  }
}, FLUSH_DELAY);

export const storageConfigStorage = {
  async load(): Promise<Partial<Record<string, ProviderConfig>>> {
    await ensureLoaded();
    return cache ?? {};
  },

  async get(id: string): Promise<ProviderConfig | null> {
    await ensureLoaded();
    return (cache as Record<string, ProviderConfig>)[id] ?? null;
  },

  async set(cfg: ProviderConfig): Promise<void> {
    await ensureLoaded();
    (cache as Record<string, ProviderConfig>)[cfg.provider] = cfg;
    void flush();
  },

  async remove(id: string): Promise<void> {
    await ensureLoaded();
    if (!cache || !(id in cache)) return;
    delete (cache as Record<string, ProviderConfig>)[id];
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
      await atomicWrite(path, (cache as Record<string, ProviderConfig>)[id]);
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
