/**
 * Provider config storage at `~/.quill/providers/`.
 *
 * Two files:
 *   - `customer/providers.json` — user-authored provider definitions, keyed by id.
 *   - `settings.json` — per-provider connection config, keyed by id.
 *
 * Both files are read eagerly on first access and cached. Writes are debounced
 * single-writer + atomic (temp file + rename). Empty/missing file → `{}`.
 *
 * Migration: `migrateLegacyBlob()` takes the old `storage.json` slice and emits
 * the two new blobs. Caller writes both files then strips the legacy keys.
 */

import { homeDir, join } from '@tauri-apps/api/path';
import { exists, mkdir, readTextFile, writeTextFile, rename } from '@tauri-apps/plugin-fs';
import { debounce } from '@/utils/debounce';

// ─── Schema ─────────────────────────────────────────────────────────────

export interface CustomProviderDef {
  id: string;
  name: string;
  defaultChatEndpoint: string;
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
  customProvider: boolean;
  extra: Record<string, unknown>;
}

export type CustomerProvidersFile = Record<string, CustomProviderDef>;
export type ProviderSettingsFile = Record<string, ProviderSettings>;

const KNOWN_ENDPOINTS = [
  'anthropic-messages',
  'google-generate-content',
  'ollama',
  'ollama-chat',
  'openai-chat-completions',
  'openai-image-generation',
  'openai-responses',
] as const;
export type DefaultChatEndpoint = (typeof KNOWN_ENDPOINTS)[number];

// ponytail: keys include both canonical CustomProviderType values and the
// legacy typo'd strings the drawer used to emit ('openai-response' singular,
// 'new-api' as an endpoint). Lookup falls through to a defensive default.
const LEGACY_CATEGORY_TO_ENDPOINT: Record<string, DefaultChatEndpoint> = {
  openai: 'openai-chat-completions',
  'openai-response': 'openai-responses',
  'openai-responses': 'openai-responses',
  gemini: 'google-generate-content',
  anthropic: 'anthropic-messages',
  'azure-openai': 'openai-chat-completions',
  'new-api': 'openai-chat-completions',
  ollama: 'ollama',
};

function coerceEndpoint(legacy: unknown): DefaultChatEndpoint {
  if (typeof legacy === 'string' && (KNOWN_ENDPOINTS as readonly string[]).includes(legacy)) {
    return legacy as DefaultChatEndpoint;
  }
  if (typeof legacy === 'string' && legacy in LEGACY_CATEGORY_TO_ENDPOINT) {
    return LEGACY_CATEGORY_TO_ENDPOINT[legacy];
  }
  // ponytail: defensive default. Legacy drawer emitted typo'd values
  // (`openai-response`, `new-api`) — everything unknown falls through to
  // the openai-compat arm in chat.rs.
  return 'openai-chat-completions';
}

// ─── Paths ──────────────────────────────────────────────────────────────

let cachedBase: string | null = null;
let cachedCustomerFile: { path: string; dir: string } | null = null;
let cachedSettingsFile: { path: string; dir: string } | null = null;

async function getBaseDir(): Promise<string> {
  if (cachedBase) return cachedBase;
  cachedBase = await join(await homeDir(), '.quill', 'providers');
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

  /** One-shot write for migration: replaces both files atomically and
   *  primes the in-memory cache. Skips the debounce — the caller needs
   *  the files on disk before stripping legacy storage.json keys. */
  async __replaceForMigration(
    customer: CustomerProvidersFile,
    settings: ProviderSettingsFile,
  ): Promise<void> {
    const customerLoc = await getCustomerProvidersPath();
    const settingsLoc = await getProviderSettingsPath();
    await atomicWriteJson(customerLoc.path, customerLoc.dir, customer);
    await atomicWriteJson(settingsLoc.path, settingsLoc.dir, settings);
    customerProvidersCache = customer;
    providerSettingsCache = settings;
    loaded = true;
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
    customProvider: false,
    extra: {},
  };
}

// ─── Migration from legacy storage.json blob ────────────────────────────

/** Legacy on-disk shape (pre-refactor). Used only as migrateLegacyBlob input. */
export interface LegacyCustomProvider {
  id: string;
  displayName: string;
  baseUrl: string;
  apiKeyUrl: string | null;
  category: string;
  createdAt: number;
}

export interface LegacyProviderConfig {
  apiKey: string;
  baseUrl: string;
  azureDeploymentId: string;
  azureApiVersion: string;
  thinkingBudget: number | null;
}

export interface LegacyManualModel {
  id: string;
  displayName: string;
  group: string;
  createdAt: number;
}

export interface LegacyBlob {
  customProviders?: LegacyCustomProvider[];
  providerConfigs?: Record<string, LegacyProviderConfig>;
  enabledProviders?: Record<string, boolean>;
  manualModels?: Record<string, LegacyManualModel[]>;
  // Flat mirrors of the active provider's slot in storage.json (pre-refactor
  // aiConfigStore kept these as top-level fields). Migration packs them into
  // providerSettings[chatProvider] so the user doesn't lose the active slot.
  chatProvider?: string;
  chatApiKey?: string;
  chatBaseUrl?: string;
  chatAzureDeploymentId?: string;
  chatAzureApiVersion?: string;
  chatThinkingBudget?: number | null;
}

export interface MigrationResult {
  customerProviders: CustomerProvidersFile;
  providerSettings: ProviderSettingsFile;
}

/**
 * Pure migration: takes the legacy storage.json slice, emits the two new
 * blobs. No disk I/O — caller writes them. Unknown `category` values are
 * defensively coerced to `openai-chat-completions`.
 *
 * `customProvider` flag is derived: entries whose id appears in
 * `customProviders` get `true`; entries only in `providerConfigs` get `false`.
 */
export function migrateLegacyBlob(legacy: LegacyBlob): MigrationResult {
  const customProviders = legacy.customProviders ?? [];
  const providerConfigs = legacy.providerConfigs ?? {};
  const enabledProviders = legacy.enabledProviders ?? {};
  const manualModels = legacy.manualModels ?? {};

  const customIds = new Set(customProviders.map((p) => p.id));

  const customerProviders: CustomerProvidersFile = {};
  for (const cp of customProviders) {
    customerProviders[cp.id] = {
      id: cp.id,
      name: cp.displayName,
      defaultChatEndpoint: coerceEndpoint(cp.category),
      ...(cp.apiKeyUrl ? { metadata: { website: { apiKey: cp.apiKeyUrl } } } : {}),
    };
  }

  const providerSettings: ProviderSettingsFile = {};

  // Custom providers get a settings entry seeded with their baseUrl (from
  // the legacy CustomProvider) so the user doesn't lose it on migration.
  for (const cp of customProviders) {
    providerSettings[cp.id] = {
      id: cp.id,
      baseUrl: cp.baseUrl ?? '',
      apiKey: providerConfigs[cp.id]?.apiKey ?? '',
      selectedModelIds: (manualModels[cp.id] ?? []).map((m) => m.id),
      enabled: enabledProviders[cp.id] ?? false,
      customProvider: true,
      extra: {},
    };
  }

  // Bundled providers that had a providerConfigs slot or were enabled.
  for (const [pid, cfg] of Object.entries(providerConfigs)) {
    if (customIds.has(pid)) continue; // already seeded above
    const extra: Record<string, unknown> = {};
    if (cfg.azureDeploymentId) extra.azureDeploymentId = cfg.azureDeploymentId;
    if (cfg.azureApiVersion) extra.azureApiVersion = cfg.azureApiVersion;
    if (cfg.thinkingBudget !== null && cfg.thinkingBudget !== undefined) {
      extra.thinkingBudget = cfg.thinkingBudget;
    }
    providerSettings[pid] = {
      id: pid,
      baseUrl: cfg.baseUrl ?? '',
      apiKey: cfg.apiKey ?? '',
      selectedModelIds: (manualModels[pid] ?? []).map((m) => m.id),
      enabled: enabledProviders[pid] ?? false,
      customProvider: false,
      extra,
    };
  }

  // Enabled-only providers (no config slot — e.g. Ollama enabled without
  // an api key). Seed an empty settings entry so enabled state survives.
  // Include false-valued entries too — the user explicitly toggled them
  // off, that state is worth preserving.
  for (const [pid, enabled] of Object.entries(enabledProviders)) {
    if (pid in providerSettings) {
      providerSettings[pid].enabled = enabled;
      continue;
    }
    providerSettings[pid] = {
      id: pid,
      baseUrl: '',
      apiKey: '',
      selectedModelIds: (manualModels[pid] ?? []).map((m) => m.id),
      enabled,
      customProvider: false,
      extra: {},
    };
  }

  // Providers with manual models but no config slot, no enable flag, no
  // custom def. Seed an entry so the user-added model ids survive.
  for (const [pid, list] of Object.entries(manualModels)) {
    if (pid in providerSettings) continue;
    providerSettings[pid] = {
      id: pid,
      baseUrl: '',
      apiKey: '',
      selectedModelIds: list.map((m) => m.id),
      enabled: false,
      customProvider: false,
      extra: {},
    };
  }

  // Flat mirrors of the active provider's slot. The pre-refactor store kept
  // these as top-level fields in storage.json; pack them into the active
  // provider's slot so the active connection config survives migration.
  const activeId = legacy.chatProvider;
  if (activeId) {
    const slot = providerSettings[activeId] ?? emptySettings(activeId);
    if (legacy.chatApiKey) slot.apiKey = legacy.chatApiKey;
    if (legacy.chatBaseUrl) slot.baseUrl = legacy.chatBaseUrl;
    const extra: Record<string, unknown> = { ...slot.extra };
    if (legacy.chatAzureDeploymentId) extra.azureDeploymentId = legacy.chatAzureDeploymentId;
    if (legacy.chatAzureApiVersion) extra.azureApiVersion = legacy.chatAzureApiVersion;
    if (legacy.chatThinkingBudget != null) extra.thinkingBudget = legacy.chatThinkingBudget;
    slot.extra = extra;
    providerSettings[activeId] = slot;
  }

  return { customerProviders, providerSettings };
}
