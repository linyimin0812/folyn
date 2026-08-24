/**
 * Provider config storage at `~/.mochi/providers/`.
 *
 * Two files:
 *   - `customer/providers.json` — user-authored provider definitions, keyed by id.
 *   - `settings.json` — per-provider connection config, keyed by id.
 *
 * Both files are read eagerly on first access and cached. Writes are debounced
 * single-writer + atomic (temp file + rename). Empty/missing file → `{}`.
 */

import { homeDir, join } from '@tauri-apps/api/path';
import { exists, mkdir, readTextFile, writeTextFile, rename } from '@tauri-apps/plugin-fs';
import { debounce } from '@/utils/debounce';

// ─── Schema ─────────────────────────────────────────────────────────────

export interface CustomProviderDef {
  id: string;
  name: string;
  /** Bundled id of the rig adapter family this custom provider routes to
   *  (e.g. 'anthropic', 'openai-completions', 'ollama', 'gemini', 'openai').
   *  Replaces the old endpoint-key enum — the 1:1 mapping was a pure
   *  indirection layer. Same value space as the bundled catalog ids. */
  adapterFamily: string;
  description?: string;
  metadata?: {
    website?: {
      apiKey?: string;
      docs?: string;
      models?: string;
      official?: string;
    };
  };
}

export interface ProviderSettings {
  id: string;
  baseUrl: string;
  apiKey: string;
  selectedModelIds: string[];
  enabled: boolean;
  extra: Record<string, unknown>;
}

export type CustomerProvidersFile = Record<string, CustomProviderDef>;
export type ProviderSettingsFile = Record<string, ProviderSettings>;

// ─── Paths ──────────────────────────────────────────────────────────────

let cachedBase: string | null = null;
let cachedCustomerFile: { path: string; dir: string } | null = null;
let cachedSettingsFile: { path: string; dir: string } | null = null;

async function getBaseDir(): Promise<string> {
  if (cachedBase) return cachedBase;
  cachedBase = await join(await homeDir(), '.mochi', 'providers');
  return cachedBase;
}

async function getCustomerProvidersPath(): Promise<{ path: string; dir: string }> {
  if (cachedCustomerFile) return cachedCustomerFile;
  const base = await getBaseDir();
  const dir = await join(base, 'customer');
  const path = await join(dir, 'providers.json');
  cachedCustomerFile = { path, dir };
  return cachedCustomerFile;
}

async function getProviderSettingsPath(): Promise<{ path: string; dir: string }> {
  if (cachedSettingsFile) return cachedSettingsFile;
  const dir = await getBaseDir();
  const path = await join(dir, 'settings.json');
  cachedSettingsFile = { path, dir };
  return cachedSettingsFile;
}

// ─── Atomic write ─────────────────────────────────────────────────────────

async function atomicWriteJson(path: string, dir: string, data: unknown): Promise<void> {
  // ponytail: write to <path>.tmp then rename — POSIX-atomic. No existing
  // atomic-write helper in the codebase, so this module owns it.
  if (!(await exists(dir))) {
    await mkdir(dir, { recursive: true });
  }
  const tmp = `${path}.tmp`;
  await writeTextFile(tmp, JSON.stringify(data, null, 2) + '\n');
  await rename(tmp, path);
}

// ─── In-memory cache + single-writer flush ──────────────────────────────

let customerProvidersCache: CustomerProvidersFile | null = null;
let providerSettingsCache: ProviderSettingsFile | null = null;
let loaded = false;

const FLUSH_DELAY = 300;

async function ensureLoaded(): Promise<void> {
  if (loaded) return;
  const [customer, settings] = await Promise.all([
    getCustomerProvidersPath(),
    getProviderSettingsPath(),
  ]);
  const base = await getBaseDir();
  if (!(await exists(base))) {
    await mkdir(base, { recursive: true });
  }
  try {
    if (await exists(customer.path)) {
      customerProvidersCache = safeParseFile<CustomerProvidersFile>(await readTextFile(customer.path));
    }
  } catch {
    customerProvidersCache = {};
  }
  try {
    if (await exists(settings.path)) {
      providerSettingsCache = safeParseFile<ProviderSettingsFile>(await readTextFile(settings.path));
    }
  } catch {
    providerSettingsCache = {};
  }
  if (customerProvidersCache === null) customerProvidersCache = {};
  if (providerSettingsCache === null) providerSettingsCache = {};
  loaded = true;
}

function safeParse(raw: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

// ponytail: JSON.parse guards unknown shape at runtime; casts at the call
// site trust that guard. Stored files are this app's own schema — no
// cross-trust-boundary content.
function safeParseFile<T>(raw: string): T | null {
  const parsed = safeParse(raw);
  return parsed as unknown as T | null;
}

function flushCustomerProviders(): void {
  void (async () => {
    if (customerProvidersCache === null) return;
    try {
      const { path, dir } = await getCustomerProvidersPath();
      await atomicWriteJson(path, dir, customerProvidersCache);
    } catch (err) {
      console.warn('[providerConfigStorage] Failed to flush customer providers:', err);
    }
  })();
}

function flushProviderSettings(): void {
  void (async () => {
    if (providerSettingsCache === null) return;
    try {
      const { path, dir } = await getProviderSettingsPath();
      await atomicWriteJson(path, dir, providerSettingsCache);
    } catch (err) {
      console.warn('[providerConfigStorage] Failed to flush provider settings:', err);
    }
  })();
}

const scheduleFlushCustomer = debounce(flushCustomerProviders, FLUSH_DELAY);
const scheduleFlushSettings = debounce(flushProviderSettings, FLUSH_DELAY);

// ─── Public API ─────────────────────────────────────────────────────────

export const providerConfigStorage = {
  async getCustomerProviders(): Promise<CustomerProvidersFile> {
    await ensureLoaded();
    return customerProvidersCache!;
  },

  async getProviderSettings(): Promise<ProviderSettingsFile> {
    await ensureLoaded();
    return providerSettingsCache!;
  },

  async setCustomerProvider(def: CustomProviderDef): Promise<void> {
    await ensureLoaded();
    customerProvidersCache = { ...(customerProvidersCache ?? {}), [def.id]: def };
    scheduleFlushCustomer();
  },

  async removeCustomerProvider(id: string): Promise<void> {
    await ensureLoaded();
    if (!customerProvidersCache || !(id in customerProvidersCache)) return;
    const next = { ...customerProvidersCache };
    delete next[id];
    customerProvidersCache = next;
    scheduleFlushCustomer();
  },

  async setProviderSettings(id: string, settings: ProviderSettings): Promise<void> {
    await ensureLoaded();
    providerSettingsCache = { ...(providerSettingsCache ?? {}), [id]: settings };
    scheduleFlushSettings();
  },

  async patchProviderSettings(
    id: string,
    patch: Partial<Omit<ProviderSettings, 'id'>>,
  ): Promise<void> {
    await ensureLoaded();
    const current = providerSettingsCache?.[id] ?? emptySettings(id);
    providerSettingsCache = {
      ...(providerSettingsCache ?? {}),
      [id]: { ...current, ...patch, id },
    };
    scheduleFlushSettings();
  },

  async removeProviderSettings(id: string): Promise<void> {
    await ensureLoaded();
    if (!providerSettingsCache || !(id in providerSettingsCache)) return;
    const next = { ...providerSettingsCache };
    delete next[id];
    providerSettingsCache = next;
    scheduleFlushSettings();
  },

  /** Test-only: reset caches so the next access reloads from disk. */
  __resetForTesting(): void {
    customerProvidersCache = null;
    providerSettingsCache = null;
    loaded = false;
    cachedBase = null;
    cachedCustomerFile = null;
    cachedSettingsFile = null;
    scheduleFlushCustomer.cancel();
    scheduleFlushSettings.cancel();
  },

  /** Test-only: force-flush pending writes without waiting for debounce. */
  async __flushForTesting(): Promise<void> {
    scheduleFlushCustomer.cancel();
    scheduleFlushSettings.cancel();
    if (customerProvidersCache !== null) {
      const { path, dir } = await getCustomerProvidersPath();
      await atomicWriteJson(path, dir, customerProvidersCache);
    }
    if (providerSettingsCache !== null) {
      const { path, dir } = await getProviderSettingsPath();
      await atomicWriteJson(path, dir, providerSettingsCache);
    }
  },
};

function emptySettings(id: string): ProviderSettings {
  return {
    id,
    baseUrl: '',
    apiKey: '',
    selectedModelIds: [],
    enabled: false,
    extra: {},
  };
}
