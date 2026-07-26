import { create } from 'zustand';
import { registerPersistSlice, schedulePersist } from './settingsPersistence';
import {
  PROVIDER_CATALOG,
  PROVIDER_IDS,
  type ChatProviderId,
  type CustomProvider,
  type CustomProviderType,
  getProviderEntry,
} from '@/services/providers/catalog';

// ponytail: ChatProvider is a string literal union of the 20 catalog ids.
// The 3 old ids ('anthropic' | 'openai' | 'openai-compatible') are kept
// verbatim — old persisted blobs hydrate without migration.
export type ChatProvider = ChatProviderId;

/**
 * T06: per-provider config slot. The source of truth is `providerConfigs`
 * (a map keyed by provider id). The flat fields on the store
 * (`chatApiKey` / `chatBaseUrl` / `chatAzureDeploymentId` /
 * `chatAzureApiVersion` / `chatThinkingBudget`) are MIRRORS of the current
 * provider's slot — they exist so the 9 existing callers reading
 * `useAiConfigStore.getState().chatApiKey` keep working without edits.
 *
 * Invariant: at rest, flat fields === providerConfigs[chatProvider]. Every
 * setter that touches a flat field also touches the map slot; setChatProvider
 * saves the current slot before switching and loads the new slot into flat
 * fields. Persisted as the `providerConfigs` key (+ the flat keys for
 * backward-compat reads off old blobs); flat keys are dropped on next
 * persist after migration.
 */
export interface ProviderConfig {
  apiKey: string;
  baseUrl: string;
  azureDeploymentId: string;
  azureApiVersion: string;
  thinkingBudget: number | null;
}

/**
 * Manually-added model entry. Stored per-provider; merged into the picker
 * list alongside fetched models. `id` becomes the chatModel value;
 * `displayName`/`group` override the picker's id-derived defaults.
 */
export interface ManualModel {
  id: string;
  displayName: string;
  group: string;
  createdAt: number;
}

function emptyConfig(): ProviderConfig {
  return {
    apiKey: '',
    baseUrl: '',
    azureDeploymentId: '',
    azureApiVersion: '',
    thinkingBudget: 1024,
  };
}

export const PERSIST_KEYS_AI_CONFIG = [
  'cliAdapter',
  'cliPath',
  'chatProvider',
  'chatModel',
  'providerConfigs',
  // ponytail: flat-key mirrors stay in PERSIST_KEYS for backward-compat —
  // old code that hydrates the blob still reads them. New writes go to
  // `providerConfigs`; the flat keys carry the current slot's values,
  // which equal providerConfigs[chatProvider], so old readers see the
  // right thing. After a few releases the flat keys can be dropped.
  'chatApiKey',
  'chatBaseUrl',
  'chatAzureDeploymentId',
  'chatAzureApiVersion',
  'chatThinkingBudget',
  // T08: cherry-studio-style provider list. customProviders holds
  // user-defined entries; enabledProviders is multi-active enable flag
  // (decoupled from chatProvider). Display sort (enabled-first, then
  // alphabetical) is applied at the consumer; no persisted order.
  'customProviders',
  'enabledProviders',
  // Manually-added models per provider (Record<providerId, ManualModel[]>).
  'manualModels',
] as const;

export interface AiConfigState {
  cliAdapter: string;
  cliPath: string;
  chatProvider: ChatProvider;
  chatModel: string;
  // Flat mirrors of providerConfigs[chatProvider] — kept for caller
  // backward-compat (see ponytail note above).
  chatApiKey: string;
  chatBaseUrl: string;
  chatAzureDeploymentId: string;
  chatAzureApiVersion: string;
  chatThinkingBudget: number | null;
  // T06 source-of-truth: per-provider config slots.
  providerConfigs: Record<string, ProviderConfig>;
  // T08: user-defined providers + per-provider enable.
  customProviders: CustomProvider[];
  enabledProviders: Record<string, boolean>;
  // Per-provider manually-added models (merged into the picker list).
  manualModels: Record<string, ManualModel[]>;

  setCliAdapter: (v: string) => void;
  setCliPath: (v: string) => void;
  setChatProvider: (v: ChatProvider) => void;
  setChatModel: (v: string) => void;
  setChatApiKey: (v: string) => void;
  setChatBaseUrl: (v: string) => void;
  setChatAzureDeploymentId: (v: string) => void;
  setChatAzureApiVersion: (v: string) => void;
  setChatThinkingBudget: (v: number | null) => void;

  /** T08: create a custom provider. Returns the new id. */
  addCustomProvider: (input: {
    displayName: string;
    baseUrl: string;
    apiKeyUrl?: string | null;
    category: CustomProviderType;
  }) => string;
  /** T08: patch a custom provider's fields (not id/createdAt). */
  updateCustomProvider: (
    id: string,
    patch: Partial<Omit<CustomProvider, 'id' | 'createdAt'>>,
  ) => void;
  /** T08: delete a custom provider. Cleans up enabledProviders /
   *  providerConfigs slots. If it was chatProvider, falls back to 'anthropic'. */
  removeCustomProvider: (id: string) => void;
  /** T08: toggle enable flag for a provider. */
  setProviderEnabled: (id: string, enabled: boolean) => void;

  /** Add a manually-defined model under a provider (for the picker). */
  addManualModel: (providerId: string, model: Omit<ManualModel, 'createdAt'>) => void;

  /** T06: returns provider ids that have a non-empty apiKey (or don't
   *  require one — Ollama). Used by the "重新拉取全部" button to iterate
   *  all configured providers in parallel. */
  configuredProviderIds: () => string[];

  /** Load this store's slice from the persisted `settings:all` blob. */
  hydrate: (blob: Record<string, unknown>) => void;
}

const PROVIDER_ID_SET = new Set<string>(PROVIDER_IDS);
function isChatProvider(v: unknown): v is ChatProvider {
  return typeof v === 'string' && PROVIDER_ID_SET.has(v);
}

function isThinkingBudget(v: unknown): v is number | null {
  return v === null || (typeof v === 'number' && Number.isFinite(v) && v >= 0);
}

function isProviderConfig(v: unknown): v is ProviderConfig {
  if (!v || typeof v !== 'object') return false;
  const r = v as Record<string, unknown>;
  return typeof r.apiKey === 'string'
    && typeof r.baseUrl === 'string'
    && typeof r.azureDeploymentId === 'string'
    && typeof r.azureApiVersion === 'string'
    && isThinkingBudget(r.thinkingBudget);
}

function isProviderConfigRecord(v: unknown): v is Record<string, ProviderConfig> {
  if (!v || typeof v !== 'object') return false;
  for (const val of Object.values(v as Record<string, unknown>)) {
    if (!isProviderConfig(val)) return false;
  }
  return true;
}

const CUSTOM_PROVIDER_TYPES: readonly CustomProviderType[] = [
  'openai', 'openai-response', 'gemini', 'anthropic',
  'azure-openai', 'new-api', 'ollama',
];

function isCustomProvider(v: unknown): v is CustomProvider {
  if (!v || typeof v !== 'object') return false;
  const r = v as Record<string, unknown>;
  return typeof r.id === 'string'
    && typeof r.displayName === 'string'
    && typeof r.baseUrl === 'string'
    && (r.apiKeyUrl === null || typeof r.apiKeyUrl === 'string')
    && typeof r.category === 'string'
    && (CUSTOM_PROVIDER_TYPES as readonly string[]).includes(r.category)
    && typeof r.createdAt === 'number';
}

function isCustomProviderArray(v: unknown): v is CustomProvider[] {
  return Array.isArray(v) && v.every(isCustomProvider);
}

function isBooleanRecord(v: unknown): v is Record<string, boolean> {
  if (!v || typeof v !== 'object') return false;
  for (const val of Object.values(v as Record<string, unknown>)) {
    if (typeof val !== 'boolean') return false;
  }
  return true;
}

function isManualModel(v: unknown): v is ManualModel {
  if (!v || typeof v !== 'object') return false;
  const r = v as Record<string, unknown>;
  return typeof r.id === 'string'
    && typeof r.displayName === 'string'
    && typeof r.group === 'string'
    && typeof r.createdAt === 'number';
}

function isManualModelsMap(v: unknown): v is Record<string, ManualModel[]> {
  if (!v || typeof v !== 'object') return false;
  for (const val of Object.values(v as Record<string, unknown>)) {
    if (!Array.isArray(val) || !val.every(isManualModel)) return false;
  }
  return true;
}

/** Apply a partial patch to a single provider's config slot. Returns the
 *  new `providerConfigs` map (immutable). */
function patchSlot(
  configs: Record<string, ProviderConfig>,
  providerId: string,
  patch: Partial<ProviderConfig>,
): Record<string, ProviderConfig> {
  const current = configs[providerId] ?? emptyConfig();
  return { ...configs, [providerId]: { ...current, ...patch } };
}

export const useAiConfigStore = create<AiConfigState>((set, get) => ({
  cliAdapter: 'claude',
  cliPath: 'claude',
  chatProvider: 'anthropic',
  chatModel: 'claude-sonnet-4-6',
  chatApiKey: '',
  chatBaseUrl: '',
  chatAzureDeploymentId: '',
  chatAzureApiVersion: '',
  chatThinkingBudget: 1024,
  providerConfigs: {},
  customProviders: [],
  enabledProviders: {},
  manualModels: {},

  setCliAdapter: (v) => { set({ cliAdapter: v }); schedulePersist(); },
  setCliPath: (v) => { set({ cliPath: v }); schedulePersist(); },
  setChatProvider: (v) => {
    const s = get();
    // Save current flat fields back to the OLD provider's slot before
    // switching — the flat fields may have been edited without going
    // through the per-slot setter (e.g. direct hydrate). This preserves
    // the invariant: flat === providerConfigs[chatProvider].
    const oldSlot = patchSlot(s.providerConfigs, s.chatProvider, {
      apiKey: s.chatApiKey,
      baseUrl: s.chatBaseUrl,
      azureDeploymentId: s.chatAzureDeploymentId,
      azureApiVersion: s.chatAzureApiVersion,
      thinkingBudget: s.chatThinkingBudget,
    });
    const newSlot = oldSlot[v] ?? emptyConfig();
    set({
      chatProvider: v,
      providerConfigs: oldSlot,
      chatApiKey: newSlot.apiKey,
      chatBaseUrl: newSlot.baseUrl,
      chatAzureDeploymentId: newSlot.azureDeploymentId,
      chatAzureApiVersion: newSlot.azureApiVersion,
      chatThinkingBudget: newSlot.thinkingBudget,
    });
    schedulePersist();
  },
  setChatModel: (v) => { set({ chatModel: v }); schedulePersist(); },
  setChatApiKey: (v) => {
    const s = get();
    const pid = s.chatProvider;
    set({
      chatApiKey: v,
      providerConfigs: patchSlot(s.providerConfigs, pid, { apiKey: v }),
    });
    schedulePersist();
  },
  setChatBaseUrl: (v) => {
    const s = get();
    const pid = s.chatProvider;
    set({
      chatBaseUrl: v,
      providerConfigs: patchSlot(s.providerConfigs, pid, { baseUrl: v }),
    });
    schedulePersist();
  },
  setChatAzureDeploymentId: (v) => {
    const s = get();
    const pid = s.chatProvider;
    set({
      chatAzureDeploymentId: v,
      providerConfigs: patchSlot(s.providerConfigs, pid, { azureDeploymentId: v }),
    });
    schedulePersist();
  },
  setChatAzureApiVersion: (v) => {
    const s = get();
    const pid = s.chatProvider;
    set({
      chatAzureApiVersion: v,
      providerConfigs: patchSlot(s.providerConfigs, pid, { azureApiVersion: v }),
    });
    schedulePersist();
  },
  setChatThinkingBudget: (v) => {
    const s = get();
    const pid = s.chatProvider;
    set({
      chatThinkingBudget: v,
      providerConfigs: patchSlot(s.providerConfigs, pid, { thinkingBudget: v }),
    });
    schedulePersist();
  },

  configuredProviderIds: () => {
    const s = get();
    const out: string[] = [];
    for (const entry of PROVIDER_CATALOG) {
      if (!entry.requiresApiKey) {
        // Ollama — always "configured" (no key needed). But only include
        // if the user has actually picked it at least once OR has a slot.
        // Avoids refetching Ollama for users who never use it.
        if (s.chatProvider === entry.id || s.providerConfigs[entry.id]) {
          out.push(entry.id);
        }
        continue;
      }
      const slot = s.providerConfigs[entry.id];
      if (slot && slot.apiKey.trim() !== '') out.push(entry.id);
    }
    return out;
  },

  addCustomProvider: (input) => {
    const id = `custom-${crypto.randomUUID()}`;
    const provider: CustomProvider = {
      id,
      displayName: input.displayName.trim() || 'Custom',
      baseUrl: input.baseUrl.trim(),
      apiKeyUrl: input.apiKeyUrl ?? null,
      category: input.category,
      createdAt: Date.now(),
    };
    set((s) => ({
      customProviders: [...s.customProviders, provider],
    }));
    schedulePersist();
    return id;
  },

  updateCustomProvider: (id, patch) => {
    set((s) => ({
      customProviders: s.customProviders.map((p) =>
        p.id === id ? { ...p, ...patch } : p,
      ),
    }));
    schedulePersist();
  },

  removeCustomProvider: (id) => {
    set((s) => {
      if (!s.customProviders.some((p) => p.id === id)) return s;
      const nextConfigs = { ...s.providerConfigs };
      delete nextConfigs[id];
      const { [id]: _omit, ...nextEnabled } = s.enabledProviders;
      return {
        customProviders: s.customProviders.filter((p) => p.id !== id),
        enabledProviders: nextEnabled,
        providerConfigs: nextConfigs,
        chatProvider: s.chatProvider === id ? 'anthropic' : s.chatProvider,
      };
    });
    schedulePersist();
  },

  setProviderEnabled: (id, enabled) => {
    set((s) => ({
      enabledProviders: { ...s.enabledProviders, [id]: enabled },
    }));
    schedulePersist();
  },

  addManualModel: (providerId, model) => {
    const entry: ManualModel = { ...model, createdAt: Date.now() };
    set((s) => {
      const list = s.manualModels[providerId] ?? [];
      // Avoid duplicate ids within the same provider.
      if (list.some((m) => m.id === entry.id)) return s;
      return {
        manualModels: { ...s.manualModels, [providerId]: [...list, entry] },
      };
    });
    schedulePersist();
  },

  hydrate: (blob) => {
    const patch: Partial<AiConfigState> = {};
    if (blob.cliAdapter !== undefined) patch.cliAdapter = blob.cliAdapter as string;
    if (blob.cliPath !== undefined) patch.cliPath = blob.cliPath as string;
    const providerId = isChatProvider(blob.chatProvider) ? blob.chatProvider : 'anthropic';
    patch.chatProvider = providerId;
    if (blob.chatModel !== undefined) patch.chatModel = blob.chatModel as string;

    // T06: build providerConfigs. Prefer the new key; fall back to
    // migrating flat fields under the (legacy) chatProvider id.
    let configs: Record<string, ProviderConfig> = {};
    if (isProviderConfigRecord(blob.providerConfigs)) {
      configs = { ...blob.providerConfigs };
    }
    // Migration: if flat keys exist in the blob AND the slot for the
    // current chatProvider isn't already in configs, build a slot from
    // the flat fields. This handles old blobs written before T06.
    if (
      !configs[providerId]
      && (blob.chatApiKey !== undefined
        || blob.chatBaseUrl !== undefined
        || blob.chatAzureDeploymentId !== undefined
        || blob.chatAzureApiVersion !== undefined
        || blob.chatThinkingBudget !== undefined)
    ) {
      const slot = emptyConfig();
      if (typeof blob.chatApiKey === 'string') slot.apiKey = blob.chatApiKey;
      if (typeof blob.chatBaseUrl === 'string') slot.baseUrl = blob.chatBaseUrl;
      if (typeof blob.chatAzureDeploymentId === 'string') slot.azureDeploymentId = blob.chatAzureDeploymentId;
      if (typeof blob.chatAzureApiVersion === 'string') slot.azureApiVersion = blob.chatAzureApiVersion;
      if (isThinkingBudget(blob.chatThinkingBudget)) slot.thinkingBudget = blob.chatThinkingBudget;
      configs[providerId] = slot;
    }

    patch.providerConfigs = configs;

    // Flat mirrors = current provider's slot.
    const currentSlot = configs[providerId] ?? emptyConfig();
    patch.chatApiKey = currentSlot.apiKey;
    patch.chatBaseUrl = currentSlot.baseUrl;
    patch.chatAzureDeploymentId = currentSlot.azureDeploymentId;
    patch.chatAzureApiVersion = currentSlot.azureApiVersion;
    patch.chatThinkingBudget = currentSlot.thinkingBudget;

    // T08: custom providers + enable flags. customProviders defaults to
    // empty array; enabledProviders defaults to {chatProvider: true} so a
    // pre-T08 blob hydrates into a sensible state without surprising the user.
    patch.customProviders = isCustomProviderArray(blob.customProviders)
      ? [...blob.customProviders]
      : [];
    if (isBooleanRecord(blob.enabledProviders)) {
      patch.enabledProviders = { ...blob.enabledProviders };
    } else {
      // Migration: pre-T08 blob — treat the current chatProvider as enabled.
      patch.enabledProviders = { [providerId]: true };
    }

    patch.manualModels = isManualModelsMap(blob.manualModels)
      ? blob.manualModels
      : {};

    if (Object.keys(patch).length > 0) set(patch);
  },
}));

registerPersistSlice({
  keys: PERSIST_KEYS_AI_CONFIG,
  getState: () => useAiConfigStore.getState() as unknown as Record<string, unknown>,
  hydrate: (blob) => useAiConfigStore.getState().hydrate(blob),
});

// ponytail: re-export getProviderEntry so callers needing catalog metadata
// can grab it without a second import. One fewer file touched per caller.
export { getProviderEntry };
