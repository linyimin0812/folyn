import { create } from 'zustand';
import { registerPersistSlice } from './settingsPersistence';
import {
  PROVIDER_CATALOG,
  allProviders,
  getProviderEntry,
  providerBaseUrl,
  providerRequiresApiKey,
} from '@/services/providers/catalog';
import {
  providerConfigStorage,
  type CustomProviderDef,
  type ProviderSettings,
} from '@/services/providers/providerConfigStorage';
import { storageClient } from '@/utils/storageClient';
import {
  DEFAULT_SCRIPT_RUNTIMES,
  type RuntimeConfig,
} from '@/services/scriptRunner/scriptRunnerService';
import { useAiStore } from './aiStore';
import { useModelRegistryStore } from './modelRegistryStore';

// ponytail: ChatProvider is `string` (Phase 3) — the literal union of 20
// catalog ids was bypassed by casts everywhere custom provider ids flowed
// (PairSelector, firstEnabledPair, session seeding). `string` admits
// reality; custom ids no longer need a cast.
export type ChatProvider = string;

/**
 * Manually-added model entry. Stored per-provider; merged into the picker
 * list alongside fetched models. `id` becomes the chatModel value;
 * `displayName`/`group` override the picker's id-derived defaults.
 *
 * ponytail: manualModels stays in storage.json (not migrated to
 * settings.json's selectedModelIds). Research flagged that "selected"
 * semantics ≠ "user-authored" — selectedModelIds is for fetched-model
 * toggles (id-only), manualModels carries richer metadata the picker UI
 * needs. Migrating one into the other would lose data.
 */
export interface ManualModel {
  id: string;
  displayName: string;
  group: string;
  createdAt: number;
}

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

/** Seed bundled provider's slot.baseUrl with the catalog default when empty.
 *  Turns the input's placeholder into a real pre-filled value, saved to
 *  settings.json. Without this, an empty baseUrl silently routes to rig's
 *  https://api.openai.com/v1 default and misroutes non-OpenAI bundled
 *  providers (e.g. OpenRouter → 401 from OpenAI). Custom providers have no
 *  catalog entry; their slot is returned unchanged. */
function seedBundledBaseUrl(
  slot: ProviderSettings | undefined,
  providerId: string,
  isCustom: boolean,
  createIfMissing: boolean,
): ProviderSettings | undefined {
  if (slot && slot.baseUrl) return slot;
  if (isCustom) return slot ?? (createIfMissing ? emptySettings(providerId) : undefined);
  if (!slot && !createIfMissing) return undefined;
  const entry = getProviderEntry(providerId);
  const catalogBase = entry ? providerBaseUrl(entry) : null;
  if (!catalogBase) return slot ?? (createIfMissing ? emptySettings(providerId) : undefined);
  return { ...(slot ?? emptySettings(providerId)), baseUrl: catalogBase };
}

export const PERSIST_KEYS_AI_CONFIG = [
  'cliAdapter',
  'cliPath',
  'cliPaths',
  'chatProvider',
  'chatModel',
  // ponytail: providerConfigs / customProviders / enabledProviders removed —
  // now live in ~/.quill/providers/{customer/providers.json,settings.json}.
  // Flat-key mirrors (chatApiKey etc.) also removed — they were backward-compat
  // for old blobs, and migration strips them in the same pass.
  // manualModels stays here — see type doc above.
  'manualModels',
  // Code-block script runner runtimes (shell/node/python defaults).
  'scriptRuntimes',
  // Per-caller (provider, model) pairs for non-AiPanel chat callers that
  // have no session to hang the pair on. pet/bubble moved to their own
  // session stores in Phase 2; voice/plugin stay here.
  // ponytail: fields are nullable + optional on the persisted blob so legacy
  // blobs hydrate without migration; first use post-upgrade picks a pair.
  'voicePair',
  'pluginPair',
] as const;

/** A (provider, model) pair used by non-AiPanel chat callers (pet, bubble,
 *  voice, plugin RPC). Null until the user picks a pair in each caller's
 *  settings page. */
export interface ProviderModelPair {
  provider: ChatProvider;
  model: string;
}

/** Connection params resolved from a (provider, model) pair. Reads the per-
 *  provider settings slot directly (NOT the flat chat* mirrors — those are
 *  only aligned with `chatProvider`, which per-caller pairs are independent
 *  from). Returned when the pair is set AND the provider's slot exists AND
 *  (for key-requiring providers) the apiKey is non-empty; null otherwise so
 *  callers can surface their own empty state. */
export interface ResolvedPairConfig {
  provider: ChatProvider;
  model: string;
  apiKey: string;
  baseUrl: string;
  thinkingBudget: number | null;
  /** Bundled adapter family id. Same value space as `ChatProvider` (now
   *  `string`) — e.g. 'anthropic', 'openai-completions', 'ollama', 'gemini',
   *  'openai'. Undefined for bundled providers; Rust falls back to
   *  `provider.as_str()` via `resolve_adapter_family(...).unwrap_or(...)`. */
  adapterFamily?: string;
}

/** Resolve a (provider, model) pair into the connection params a caller needs
 *  to invoke runRigChat. Used by pet / bubble / voice / plugin RPC send paths
 *  so they don't reimplement the providerSettings lookup. Returns null when
 *  the pair is null OR the provider's slot is missing OR a key-requiring
 *  provider has no apiKey (caller surfaces the empty state).
 *
 *  ponytail: providers that don't require an apiKey (e.g. Ollama) pass through
 *  with apiKey='' — runRigChat treats empty key as "no auth header" which is
 *  correct for local providers. */
export function resolvePairConfig(
  pair: ProviderModelPair | null,
  state: AiConfigState = useAiConfigStore.getState(),
): ResolvedPairConfig | null {
  if (!pair) return null;
  const slot = state.providerSettings[pair.provider];
  if (!slot) return null;
  const entry = allProviders(state.customerProviders).find((e) => e.id === pair.provider);
  // Unknown provider id (e.g. stale persisted pair for a since-deleted custom
  // provider) → treat as key-required so we refuse to send without a key.
  const requiresKey = entry ? providerRequiresApiKey(entry) : true;
  if (requiresKey && !slot.apiKey.trim()) return null;
  return {
    provider: pair.provider,
    model: pair.model,
    apiKey: slot.apiKey,
    baseUrl: slot.baseUrl,
    thinkingBudget: (slot.extra.thinkingBudget as number | null) ?? null,
    adapterFamily: state.customerProviders[pair.provider]?.adapterFamily,
  };
}

/** First enabled (provider, model) pair from the catalog — the non-hook
 *  counterpart of PairSelector.useEnabledPairs' derivation. Used by
 *  aiStore.createEmptySession to seed new sessions when no recent session
 *  exists. Returns null when no provider is enabled with at least one
 *  selected model. */
export function firstEnabledPair(
  state: AiConfigState = useAiConfigStore.getState(),
): { provider: ChatProvider; model: string } | null {
  const entries = allProviders(state.customerProviders);
  for (const entry of entries) {
    const slot = state.providerSettings[entry.id];
    if (!slot || !slot.enabled) continue;
    if (slot.selectedModelIds.length === 0) continue;
    return { provider: entry.id, model: slot.selectedModelIds[0] };
  }
  return null;
}

/** Resolve a session's pair into the connection params a caller needs to
 *  invoke runRigChat. Reads the session from aiStore, then delegates to
 *  resolvePairConfig. Returns null when the session has no pair, the
 *  provider slot is missing, or a key-requiring provider has no apiKey.
 *
 *  Session-based callers use this (or its per-store sibling
 *  `resolvePairForPetSession` / `resolvePairForBtSession`) instead of
 *  resolvePairConfig directly so the pair-source is encapsulated.
 *  voice/plugin RPC keeps resolvePairConfig(pair, state). */
export function resolvePairForSession(
  sessionId: string,
): ResolvedPairConfig | null {
  const session = useAiStore.getState().sessions.find((s) => s.id === sessionId);
  if (!session || !session.provider || !session.model) return null;
  return resolvePairConfig(
    { provider: session.provider, model: session.model },
  );
}

export interface AiConfigState {
  cliAdapter: string;
  cliPath: string;
  /** Per-adapter binary path. `cliPath` mirrors `cliPaths[cliAdapter]`. */
  cliPaths: Record<string, string>;
  chatProvider: ChatProvider;
  chatModel: string;
  // Flat mirrors of providerSettings[chatProvider] — kept for caller
  // backward-compat. Setters update both the flat field and the slot.
  chatApiKey: string;
  chatBaseUrl: string;
  chatAzureDeploymentId: string;
  chatAzureApiVersion: string;
  chatThinkingBudget: number | null;
  // Custom provider definitions — keyed by id, mirrors the on-disk file.
  customerProviders: Record<string, CustomProviderDef>;
  // Per-provider connection configs — keyed by id, mirrors settings.json.
  providerSettings: Record<string, ProviderSettings>;
  // Per-provider manually-added models (merged into the picker list).
  manualModels: Record<string, ManualModel[]>;
  // Code-block script runner runtimes. Default = shell/node/python.
  // User can override binaryPath per runtime via Editor settings tab.
  scriptRuntimes: RuntimeConfig[];
  // Per-caller (provider, model) pairs. Null until the user picks one in
  // each caller's settings page. AiPanel / pet / bubble use session-scoped
  // pair fields (see aiStore.AiSession / petChatStore.PetChatSession /
  // bubbleTemplateChatStore.BtSession) — NOT these globals. voice/plugin
  // have no session to hang a pair on, so they stay here.
  voicePair: ProviderModelPair | null;
  pluginPair: ProviderModelPair | null;

  setCliAdapter: (v: string) => void;
  setCliPath: (v: string) => void;
  /** Set the binary path for a SPECIFIC adapter. */
  setCliPathFor: (adapterId: string, path: string) => void;
  setChatProvider: (v: ChatProvider) => void;
  setChatModel: (v: string) => void;
  setChatApiKey: (v: string) => void;
  setChatBaseUrl: (v: string) => void;
  setChatAzureDeploymentId: (v: string) => void;
  setChatAzureApiVersion: (v: string) => void;
  setChatThinkingBudget: (v: number | null) => void;

  /** Create a custom provider. Returns the new id. */
  addCustomProvider: (input: {
    id: string;
    name: string;
    adapterFamily: string;
    description?: string;
    metadata?: CustomProviderDef['metadata'];
  }) => string;
  /** Patch a custom provider's fields (not id). */
  updateCustomProvider: (id: string, patch: Partial<Omit<CustomProviderDef, 'id'>>) => void;
  /** Delete a custom provider. Cleans up providerSettings slot. If it was
   *  chatProvider, falls back to 'anthropic'. */
  removeCustomProvider: (id: string) => void;
  /** Toggle enable flag for a provider. */
  setProviderEnabled: (id: string, enabled: boolean) => void;

  /** Add a manually-defined model under a provider (for the picker). */
  addManualModel: (providerId: string, model: Omit<ManualModel, 'createdAt'>) => void;
  /** Append a model id to `providerSettings[providerId].selectedModelIds`
   *  (dedup; preserve order). Persists to disk. Called by the model picker
   *  on select so the user's "enabled subset" survives restarts. */
  addSelectedModelId: (providerId: string, modelId: string) => void;
  /** Remove a model id from `providerSettings[providerId].selectedModelIds`.
   *  No-op if absent. Persists to disk. Called by the model picker on
   *  toggle-off; does NOT clear `chatModel`. */
  removeSelectedModelId: (providerId: string, modelId: string) => void;

  /** Set the binary path for a script runtime (shell/node/python/...). */
  setRuntimePath: (runtimeId: string, path: string) => void;

  /** Set the (provider, model) pair for a non-AiPanel chat caller.
   *  Pass null to clear. Persists via the settings:all blob. */
  setVoicePair: (pair: ProviderModelPair | null) => void;
  setPluginPair: (pair: ProviderModelPair | null) => void;

  /** Returns provider ids that have a non-empty apiKey (or don't require one). */
  configuredProviderIds: () => string[];

  /** Hydrate non-provider keys from the storage.json blob. Provider config
   *  is loaded separately from `~/.quill/providers/` via loadFromDisk(). */
  hydrate: (blob: Record<string, unknown>) => void;

  /** Load custom provider defs + connection settings from disk. Runs
   *  migration first if the legacy blob still has un-migrated keys. */
  loadFromDisk: () => Promise<void>;
}

// ponytail: Phase 3 — ChatProvider is `string`, custom provider ids are
// valid at runtime. The guard accepts any non-empty string; `hydrate`
// uses it to default-miss only when the persisted value isn't a string.
function isChatProvider(v: unknown): v is ChatProvider {
  return typeof v === 'string' && v.length > 0;
}

/** Per-adapter cliPath Record guard for the persisted blob. */
function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
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

/** ProviderModelPair guard for the persisted blob. */
function isProviderModelPair(v: unknown): v is ProviderModelPair {
  if (!v || typeof v !== 'object') return false;
  const r = v as Record<string, unknown>;
  return typeof r.provider === 'string' && typeof r.model === 'string';
}

function patchSettings(
  settings: Record<string, ProviderSettings>,
  id: string,
  patch: Partial<ProviderSettings>,
): Record<string, ProviderSettings> {
  const current = settings[id] ?? emptySettings(id);
  return { ...settings, [id]: { ...current, ...patch, id } };
}

function flatMirrors(slot: ProviderSettings | undefined) {
  const s = slot ?? emptySettings('');
  return {
    chatApiKey: s.apiKey,
    chatBaseUrl: s.baseUrl,
    chatAzureDeploymentId: (s.extra.azureDeploymentId as string) ?? '',
    chatAzureApiVersion: (s.extra.azureApiVersion as string) ?? '',
    chatThinkingBudget: (s.extra.thinkingBudget as number | null) ?? null,
  };
}

export const useAiConfigStore = create<AiConfigState>((set, get) => ({
  cliAdapter: 'claude',
  cliPath: 'claude',
  cliPaths: {},
  chatProvider: 'anthropic',
  chatModel: 'claude-sonnet-4-6',
  chatApiKey: '',
  chatBaseUrl: '',
  chatAzureDeploymentId: '',
  chatAzureApiVersion: '',
  chatThinkingBudget: 1024,
  customerProviders: {},
  providerSettings: {},
  manualModels: {},
  scriptRuntimes: DEFAULT_SCRIPT_RUNTIMES,
  voicePair: null,
  pluginPair: null,

  setCliAdapter: (v) => {
    set((s) => {
      const prev = s.cliAdapter;
      const prevPath = s.cliPath;
      const storedNew = s.cliPaths[v];
      const defaultFor = (id: string) => id;
      const newPaths = { ...s.cliPaths, [prev]: prevPath };
      return {
        cliAdapter: v,
        cliPaths: newPaths,
        cliPath: storedNew ?? defaultFor(v),
      };
    });
    persist();
  },
  setCliPath: (v) => {
    set((s) => ({
      cliPath: v,
      cliPaths: { ...s.cliPaths, [s.cliAdapter]: v },
    }));
    persist();
  },
  setCliPathFor: (adapterId, path) => {
    set((s) => {
      const cliPaths = { ...s.cliPaths, [adapterId]: path };
      const cliPath = adapterId === s.cliAdapter ? path : s.cliPath;
      return { cliPaths, cliPath };
    });
    persist();
  },
  setChatProvider: (v) => {
    const s = get();
    // Save current flat fields back to the OLD provider's slot before switch.
    const oldSlot = patchSettings(s.providerSettings, s.chatProvider, {
      apiKey: s.chatApiKey,
      baseUrl: s.chatBaseUrl,
      extra: {
        ...(s.providerSettings[s.chatProvider]?.extra ?? {}),
        ...(s.chatAzureDeploymentId ? { azureDeploymentId: s.chatAzureDeploymentId } : {}),
        ...(s.chatAzureApiVersion ? { azureApiVersion: s.chatAzureApiVersion } : {}),
        ...(s.chatThinkingBudget != null ? { thinkingBudget: s.chatThinkingBudget } : {}),
      },
    });
    const isCustom = s.customerProviders[v] != null;
    // Seed catalog default baseUrl for bundled providers with empty slot —
    // see seedBundledBaseUrl.
    const newSlot = seedBundledBaseUrl(oldSlot[v], v, isCustom, true)!;
    set({
      chatProvider: v,
      providerSettings: { ...oldSlot, [v]: newSlot },
      ...flatMirrors(newSlot),
    });
    persist();
    void providerConfigStorage.setProviderSettings(v, newSlot);
  },
  setChatModel: (v) => { set({ chatModel: v }); persist(); },
  setChatApiKey: (v) => {
    const s = get();
    const pid = s.chatProvider;
    const next = patchSettings(s.providerSettings, pid, { apiKey: v });
    set({ chatApiKey: v, providerSettings: next });
    persist();
    void providerConfigStorage.setProviderSettings(pid, next[pid]!);
  },
  setChatBaseUrl: (v) => {
    const s = get();
    const pid = s.chatProvider;
    const next = patchSettings(s.providerSettings, pid, { baseUrl: v });
    set({ chatBaseUrl: v, providerSettings: next });
    persist();
    void providerConfigStorage.setProviderSettings(pid, next[pid]!);
  },
  setChatAzureDeploymentId: (v) => {
    const s = get();
    const pid = s.chatProvider;
    const currentExtra = s.providerSettings[pid]?.extra ?? {};
    const next = patchSettings(s.providerSettings, pid, {
      extra: { ...currentExtra, azureDeploymentId: v },
    });
    set({ chatAzureDeploymentId: v, providerSettings: next });
    persist();
    void providerConfigStorage.setProviderSettings(pid, next[pid]!);
  },
  setChatAzureApiVersion: (v) => {
    const s = get();
    const pid = s.chatProvider;
    const currentExtra = s.providerSettings[pid]?.extra ?? {};
    const next = patchSettings(s.providerSettings, pid, {
      extra: { ...currentExtra, azureApiVersion: v },
    });
    set({ chatAzureApiVersion: v, providerSettings: next });
    persist();
    void providerConfigStorage.setProviderSettings(pid, next[pid]!);
  },
  setChatThinkingBudget: (v) => {
    const s = get();
    const pid = s.chatProvider;
    const currentExtra = s.providerSettings[pid]?.extra ?? {};
    const next = patchSettings(s.providerSettings, pid, {
      extra: { ...currentExtra, thinkingBudget: v },
    });
    set({ chatThinkingBudget: v, providerSettings: next });
    persist();
    void providerConfigStorage.setProviderSettings(pid, next[pid]!);
  },

  configuredProviderIds: () => {
    const s = get();
    const out: string[] = [];
    for (const entry of PROVIDER_CATALOG) {
      if (!providerRequiresApiKey(entry)) {
        // Ollama — always "configured" (no key needed). But only include
        // if the user has actually picked it at least once OR has a slot.
        if (s.chatProvider === entry.id || s.providerSettings[entry.id]) {
          out.push(entry.id);
        }
        continue;
      }
      const slot = s.providerSettings[entry.id];
      if (slot && slot.apiKey.trim() !== '') out.push(entry.id);
    }
    return out;
  },

  addCustomProvider: (input) => {
    const def: CustomProviderDef = {
      id: input.id,
      name: input.name.trim() || 'Custom',
      adapterFamily: input.adapterFamily,
      ...(input.description ? { description: input.description } : {}),
      ...(input.metadata ? { metadata: input.metadata } : {}),
    };
    set((s) => ({
      customerProviders: { ...s.customerProviders, [def.id]: def },
    }));
    void providerConfigStorage.setCustomerProvider(def);
    // Seed an empty settings entry so the user lands on a config page.
    const seed = emptySettings(def.id);
    set((s) => ({
      providerSettings: { ...s.providerSettings, [def.id]: seed },
    }));
    void providerConfigStorage.setProviderSettings(def.id, seed);
    return def.id;
  },

  updateCustomProvider: (id, patch) => {
    set((s) => {
      const existing = s.customerProviders[id];
      if (!existing) return s;
      const next: CustomProviderDef = { ...existing, ...patch, id };
      return { customerProviders: { ...s.customerProviders, [id]: next } };
    });
    const after = get().customerProviders[id];
    if (after) void providerConfigStorage.setCustomerProvider(after);
  },

  removeCustomProvider: (id) => {
    set((s) => {
      if (!s.customerProviders[id]) return s;
      const { [id]: _c, ...nextCustomer } = s.customerProviders;
      const { [id]: _s, ...nextSettings } = s.providerSettings;
      return {
        customerProviders: nextCustomer,
        providerSettings: nextSettings,
        chatProvider: s.chatProvider === id ? 'anthropic' : s.chatProvider,
      };
    });
    void providerConfigStorage.removeCustomerProvider(id);
    void providerConfigStorage.removeProviderSettings(id);
  },

  setProviderEnabled: (id, enabled) => {
    set((s) => {
      const slot = s.providerSettings[id] ?? emptySettings(id);
      return {
        providerSettings: { ...s.providerSettings, [id]: { ...slot, enabled } },
      };
    });
    const after = get().providerSettings[id];
    if (after) void providerConfigStorage.setProviderSettings(id, after);
  },

  addManualModel: (providerId, model) => {
    const entry: ManualModel = { ...model, createdAt: Date.now() };
    set((s) => {
      const list = s.manualModels[providerId] ?? [];
      if (list.some((m) => m.id === entry.id)) return s;
      return {
        manualModels: { ...s.manualModels, [providerId]: [...list, entry] },
      };
    });
    persist();
  },

  addSelectedModelId: (providerId, modelId) => {
    const s = get();
    const current = s.providerSettings[providerId]?.selectedModelIds ?? [];
    if (current.includes(modelId)) return; // dedup; preserve order
    const next = patchSettings(s.providerSettings, providerId, {
      selectedModelIds: [...current, modelId],
    });
    set({ providerSettings: next });
    persist();
    void providerConfigStorage.setProviderSettings(providerId, next[providerId]!);
  },

  removeSelectedModelId: (providerId, modelId) => {
    const s = get();
    const current = s.providerSettings[providerId]?.selectedModelIds ?? [];
    if (!current.includes(modelId)) return; // no-op; absent
    const next = patchSettings(s.providerSettings, providerId, {
      selectedModelIds: current.filter((x) => x !== modelId),
    });
    // ponytail: also drop the manualModels entry if present — a manual model's
    // metadata is meaningless once the user has unselected it; otherwise the
    // picker (which synthesizes from manualModels) would still surface it.
    const manualList = s.manualModels[providerId] ?? [];
    const manualHas = manualList.some((m) => m.id === modelId);
    if (manualHas) {
      set({
        providerSettings: next,
        manualModels: {
          ...s.manualModels,
          [providerId]: manualList.filter((m) => m.id !== modelId),
        },
      });
    } else {
      set({ providerSettings: next });
    }
    persist();
    void providerConfigStorage.setProviderSettings(providerId, next[providerId]!);
  },

  setRuntimePath: (runtimeId, path) => {
    set((s) => ({
      scriptRuntimes: s.scriptRuntimes.map((r) =>
        r.id === runtimeId ? { ...r, binaryPath: path } : r,
      ),
    }));
    persist();
  },

  setVoicePair: (pair) => { set({ voicePair: pair }); persist(); },
  setPluginPair: (pair) => { set({ pluginPair: pair }); persist(); },

  hydrate: (blob) => {
    const patch: Partial<AiConfigState> = {};
    if (blob.cliAdapter !== undefined) patch.cliAdapter = blob.cliAdapter as string;
    let cliPaths: Record<string, string> = {};
    if (isRecord(blob.cliPaths)) {
      for (const [k, val] of Object.entries(blob.cliPaths)) {
        if (typeof val === 'string') cliPaths[k] = val;
      }
    }
    if (typeof blob.cliPath === 'string') {
      patch.cliPath = blob.cliPath;
      if (!cliPaths.claude) cliPaths.claude = blob.cliPath;
    }
    patch.cliPaths = cliPaths;
    const providerId = isChatProvider(blob.chatProvider) ? blob.chatProvider : 'anthropic';
    patch.chatProvider = providerId;
    if (blob.chatModel !== undefined) patch.chatModel = blob.chatModel as string;

    patch.manualModels = isManualModelsMap(blob.manualModels) ? blob.manualModels : {};

    // Script runtimes: merge persisted binaryPath overrides onto defaults.
    // Unknown persisted ids (removed in future migrations) are dropped; new
    // default ids not in the blob keep their default binaryPath.
    patch.scriptRuntimes = mergeScriptRuntimes(blob.scriptRuntimes);

    // Per-caller pairs: null when absent or malformed (legacy blobs hydrate
    // to null without a migration pass). petPair/bubblePair removed in
    // Phase 2 — they live on petChatStore/bubbleTemplateChatStore sessions
    // now; any leftover persisted values are silently dropped here.
    patch.voicePair = isProviderModelPair(blob.voicePair) ? blob.voicePair : null;
    patch.pluginPair = isProviderModelPair(blob.pluginPair) ? blob.pluginPair : null;

    if (Object.keys(patch).length > 0) set(patch);
  },

  loadFromDisk: async () => {
    // `settings:all` is the legacy single-blob file from before the per-slice
    // storage split (1eac971). It is no longer the source of truth — each
    // persisted slice writes its own file under ~/.quill/storage/, and
    // provider config lives under ~/.quill/providers/. The file lingered on
    // disk only because the old migration path wrote it back (stripped of
    // provider keys) instead of deleting it; its appearance/prefs keys were a
    // frozen snapshot that diverged from the per-slice files. Drop it so it
    // stops masquerading as a config source.
    await storageClient.remove('settings:all');

    // Read the latest provider config from ~/.quill/providers/*.json (the
    // source of truth since the storage split).
    const [customer, settings] = await Promise.all([
      providerConfigStorage.getCustomerProviders(),
      providerConfigStorage.getProviderSettings(),
    ]);

    const providerId = get().chatProvider;
    const isCustom = customer[providerId] != null;
    // Seed catalog default baseUrl for the initial provider on first load
    // (same as setChatProvider, but only when a slot already exists —
    // creating a slot from nothing would defeat the "empty state on no
    // disk files" contract). Without this, the input stays empty until
    // the user switches away and back.
    let seededSettings = settings;
    const existingSlot = settings[providerId];
    if (existingSlot) {
      const seededSlot = seedBundledBaseUrl(existingSlot, providerId, isCustom, false);
      if (seededSlot && seededSlot !== existingSlot) {
        seededSettings = { ...settings, [providerId]: seededSlot };
        void providerConfigStorage.setProviderSettings(providerId, seededSlot);
      }
    }
    const slotForMirrors = seededSettings[providerId];
    set({
      customerProviders: customer,
      providerSettings: seededSettings,
      ...flatMirrors(slotForMirrors),
    });
  },
}));

// ponytail: re-export getProviderEntry so callers needing catalog metadata
// can grab it without a second import. One fewer file touched per caller.
export { getProviderEntry };

function mergeScriptRuntimes(persisted: unknown): RuntimeConfig[] {
  if (!Array.isArray(persisted)) return DEFAULT_SCRIPT_RUNTIMES;
  const byId = new Map<string, RuntimeConfig>();
  for (const r of DEFAULT_SCRIPT_RUNTIMES) byId.set(r.id, { ...r });
  for (const item of persisted) {
    if (!item || typeof item !== 'object') continue;
    const r = item as Partial<RuntimeConfig>;
    if (typeof r.id !== 'string' || typeof r.binaryPath !== 'string') continue;
    const existing = byId.get(r.id);
    if (existing) {
      existing.binaryPath = r.binaryPath;
    }
  }
  return Array.from(byId.values());
}

const persist = registerPersistSlice({
  name: 'aiConfig',
  keys: PERSIST_KEYS_AI_CONFIG,
  getState: () => useAiConfigStore.getState() as unknown as Record<string, unknown>,
  hydrate: (blob) => useAiConfigStore.getState().hydrate(blob),
});

/**
 * Broadcast provider settings + the model registry to secondary Tauri
 * windows (the pet-panel's embedded AiPanel). Secondary windows lack fs ACL
 * perms to re-read `~/.quill/providers/`, so their `aiConfigStore` stays
 * empty and the panel's model selector shows "configure a model" even
 * though the main window has providers configured. Mirrors the
 * `pet://file-tree-updated` pattern: main-window-only caller (App.tsx),
 * pushes `providerSettings` + `customerProviders` + `modelsByProvider` on
 * change. The pet-panel listens on `pet://providers-updated` and hydrates
 * its own store instances.
 */
export function startProvidersBroadcast(): () => void {
  let stopped = false;
  const emit = async () => {
    if (stopped) return;
    try {
      const { emit } = await import('@tauri-apps/api/event');
      const { providerSettings, customerProviders } = useAiConfigStore.getState();
      const { modelsByProvider } = useModelRegistryStore.getState();
      await emit('pet://providers-updated', {
        providerSettings,
        customerProviders,
        modelsByProvider,
      });
    } catch {
      // Non-tauri (tests) or emit failed — non-fatal.
    }
  };
  // Push initial state so a freshly-opened pet panel sees the current config
  // without waiting for the next provider-settings mutation.
  void emit();
  let prevSettings = useAiConfigStore.getState().providerSettings;
  let prevCustomers = useAiConfigStore.getState().customerProviders;
  const unsubConfig = useAiConfigStore.subscribe((state) => {
    if (
      state.providerSettings !== prevSettings ||
      state.customerProviders !== prevCustomers
    ) {
      prevSettings = state.providerSettings;
      prevCustomers = state.customerProviders;
      void emit();
    }
  });
  let prevModels = useModelRegistryStore.getState().modelsByProvider;
  const unsubModels = useModelRegistryStore.subscribe((state) => {
    if (state.modelsByProvider !== prevModels) {
      prevModels = state.modelsByProvider;
      void emit();
    }
  });
  // ponytail: request-response. A secondary window (pet-panel) that mounts
  // AFTER the initial emit above misses it; if the provider config is already
  // loaded and stable, no aiConfigStore/modelRegistryStore change fires to push
  // it again. Listen for `pet://providers-request` from secondary windows and
  // re-emit the current snapshot. Mirrors the `pet://file-tree-request`
  // pattern in startFileTreeBroadcast. The listener is main-window-only
  // because startProvidersBroadcast is only called from App.tsx.
  let reqUnlisten: (() => void) | undefined;
  (async () => {
    if (stopped) return;
    try {
      const { listen } = await import('@tauri-apps/api/event');
      reqUnlisten = await listen('pet://providers-request', () => {
        void emit();
      });
    } catch {
      // Non-tauri (tests) or listen failed — non-fatal.
    }
  })();
  return () => {
    stopped = true;
    unsubConfig();
    unsubModels();
    reqUnlisten?.();
  };
}
