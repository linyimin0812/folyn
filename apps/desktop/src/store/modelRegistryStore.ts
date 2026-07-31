import { create } from 'zustand';
import { registerPersistSlice } from './settingsPersistence';
import { fetchModels as fetchModelsRaw } from '@/services/modelRegistry/fetchModels';
import { providerRequiresApiKey, type ProviderEntry } from '@/services/providers/catalog';
import { readUserProviderModels, writeUserProviderModels } from '@/services/modelRegistry/userProvidersCatalog';
import { fetchOwnerMap, mergeCapabilitiesIntoOwnerMap, ownerLookupKey, type OwnerMap } from '@/services/modelRegistry/fetchOwnerMap';
import type { Model } from '@/services/modelRegistry/types';

/**
 * Persisted model registry — caches per-provider fetched model lists across
 * app restarts so the user doesn't have to refetch on every launch.
 *
 * ponytail: persistence piggybacks on `settingsPersistence` (storageClient's
 * `settings:all` blob). No separate `~/.quill/models.json` file — the PRD
 * named a separate file, but Quill's existing convention is one aggregated
 * `storage.json` keyed by slice. Reusing the pattern is cheaper than a new
 * IO path + atomic-rename logic; storageClient already debounces + flushes.
 *
 * Transient state (`fetchStatus` / `fetchError`) is NOT persisted — on app
 * restart, all providers reset to 'idle' so a fetch interrupted by restart
 * doesn't show a stuck "loading" dot forever.
 */

export type FetchStatus = 'idle' | 'loading' | 'success' | 'error';

export interface ModelRegistryState {
  /** Per-provider cached model list. Empty record = never fetched. */
  modelsByProvider: Record<string, Model[]>;
  /** Per-provider fetch status — transient, defaults to 'idle'. */
  fetchStatusByProvider: Record<string, FetchStatus>;
  /** Per-provider error message (when status = 'error') — transient. */
  fetchErrorByProvider: Record<string, string | null>;
  /** Per-provider epoch ms of last successful fetch. */
  lastFetchedAtByProvider: Record<string, number>;

  /** Owner map (OpenRouter-derived {modelId → {providerId, capabilities}}).
   *  Loaded once on first need; 24h disk-cached underneath. Shared across
   *  UI consumers (manual model enrichment) + fetch enrichment. */
  ownerMap: OwnerMap;
  /** Populate `ownerMap` if empty. Idempotent; safe to call repeatedly. */
  loadOwnerMap: () => Promise<void>;

  /** Single-provider fetch + write-through. */
  fetchModelsForProvider: (
    providerId: string,
    apiKey: string,
    baseUrl?: string,
    azureApiVersion?: string,
    adapterFamily?: string,
  ) => Promise<{ ok: boolean; error?: string }>;
  /** Iterate all configured providers in parallel; per-provider results land
   *  in fetchStatusByProvider / fetchErrorByProvider. Returns the count of
   *  successful fetches for the UI summary. */
  refetchAll: (
    configured: ReadonlyArray<{
      providerId: string;
      apiKey: string;
      baseUrl?: string;
      azureApiVersion?: string;
      adapterFamily?: string;
    }>,
  ) => Promise<{ success: number; failed: number }>;
  /** Test-only: reset state. */
  __reset: () => void;
  /** Load this store's slice from the persisted `settings:all` blob. */
  hydrate: (blob: Record<string, unknown>) => void;
}

export const PERSIST_KEYS_MODEL_REGISTRY = [
  'modelsByProvider',
  'lastFetchedAtByProvider',
] as const;

function isModelArray(v: unknown): v is Model[] {
  if (!Array.isArray(v)) return false;
  return v.every(
    (m) =>
      m && typeof m === 'object' && typeof (m as Model).id === 'string' && typeof (m as Model).providerId === 'string',
  );
}

function isNumberRecord(v: unknown): v is Record<string, number> {
  if (!v || typeof v !== 'object') return false;
  for (const val of Object.values(v as Record<string, unknown>)) {
    if (typeof val !== 'number') return false;
  }
  return true;
}

export const useModelRegistryStore = create<ModelRegistryState>((set, get) => ({
  modelsByProvider: {},
  fetchStatusByProvider: {},
  fetchErrorByProvider: {},
  lastFetchedAtByProvider: {},
  ownerMap: {},

  loadOwnerMap: async () => {
    if (Object.keys(get().ownerMap).length > 0) return;
    try {
      const map = await fetchOwnerMap();
      set({ ownerMap: map });
    } catch {
      // ponytail: owner map is a cosmetic enrichment — swallow errors so
      // UI flows that depend on it (manual model capabilities) still work.
    }
  },

  fetchModelsForProvider: async (providerId, apiKey, baseUrl, azureApiVersion, adapterFamily) => {
    set((s) => ({
      fetchStatusByProvider: { ...s.fetchStatusByProvider, [providerId]: 'loading' },
      fetchErrorByProvider: { ...s.fetchErrorByProvider, [providerId]: null },
    }));
    try {
      const result = await fetchModelsRaw({ provider: providerId, apiKey, baseUrl, azureApiVersion, adapterFamily });
      // ponytail: hoist the owner-map fetch (24h disk-cached, cheap) so we
      // can enrich the in-memory list for custom providers — the Rust
      // list_models + merge step leaves custom-provider models with empty
      // `capabilities` and no `group` (no catalog match). Owner map fills
      // both: capabilities come from OpenRouter's response, group becomes
      // the owner providerId so the picker groups by family ("openai",
      // "anthropic", …) instead of one bucket per id.
      // ponytail: reuse store-cached ownerMap; fall back to fetch+cache.
      let ownerMap = get().ownerMap;
      if (Object.keys(ownerMap).length === 0) {
        try {
          ownerMap = await fetchOwnerMap();
          set({ ownerMap });
        } catch {
          ownerMap = {};
        }
      }
      const isCustom = adapterFamily != null;
      const enriched = result.models.map((m) => {
        const entry = ownerMap[ownerLookupKey(m.id)];
        // ponytail: capabilities filled from ownerMap when empty — catalog
        // values are authoritative when present, but Rust list_models +
        // merge leave many cataloged-provider models with [] (no catalog
        // hit). Group enrichment stays custom-only (catalog group is
        // authoritative for bundled providers).
        return {
          ...m,
          capabilities: m.capabilities.length ? m.capabilities : (entry?.capabilities ?? []),
          ...(isCustom ? { group: m.group ?? entry?.providerId } : {}),
        };
      });
      set((s) => ({
        modelsByProvider: { ...s.modelsByProvider, [providerId]: enriched },
        fetchStatusByProvider: { ...s.fetchStatusByProvider, [providerId]: 'success' },
        fetchErrorByProvider: { ...s.fetchErrorByProvider, [providerId]: null },
        lastFetchedAtByProvider: {
          ...s.lastFetchedAtByProvider,
          [providerId]: Date.now(),
        },
      }));
      persist();
      // ponytail: fire-and-forget the file write — cache failure must not
      // block the main flow. The file gets the enriched models + `owner`
      // field (file-only; the in-memory `Model` type has no `owner`).
      void (async () => {
        try {
          const fileModels = enriched.map((m) => ({
            ...m,
            owner: ownerMap[ownerLookupKey(m.id)]?.providerId ?? m.providerId,
          }));
          await writeUserProviderModels(providerId, fileModels);
          // ponytail: also merge capabilities back into the owner-map cache
          // (`~/.quill/providers/provider-models.json`) so ownerMap grows
          // more complete over time — catalog (models.dev) caps that
          // OpenRouter doesn't list become available for future providers'
          // orphan lookups. Dedup rule: existing non-empty caps preserved.
          const merged = await mergeCapabilitiesIntoOwnerMap(
            enriched
              .filter((m) => m.capabilities.length)
              .map((m) => ({ id: m.id, capabilities: m.capabilities, providerId: m.providerId })),
          );
          set({ ownerMap: merged });
        } catch {
          // best-effort — swallow; cache write is non-critical
        }
      })();
      return { ok: true };
    } catch (e) {
      // ponytail: Tauri rejects with the serialized AppError object
      // {category, detail}; String(obj) would yield "[object Object]".
      // Pull `detail` when present, else fall back to String(e).
      const rawMsg = typeof e === 'object' && e && 'detail' in e
        ? String((e as { detail: unknown }).detail ?? e)
        : String(e);
      // Fallback: read the on-disk cache. If present, repopulate the
      // in-memory list so the UI still shows models, and append a
      // "using cached data" notice to the error message.
      let cached: Model[] | null = null;
      try {
        cached = await readUserProviderModels(providerId);
      } catch {
        cached = null;
      }
      const usingCache = cached && cached.length > 0;
      const msg = usingCache
        ? `${rawMsg}（拉取失败，使用缓存数据）`
        : rawMsg;
      set((s) => ({
        ...(usingCache
          ? { modelsByProvider: { ...s.modelsByProvider, [providerId]: cached! } }
          : {}),
        fetchStatusByProvider: { ...s.fetchStatusByProvider, [providerId]: 'error' },
        fetchErrorByProvider: { ...s.fetchErrorByProvider, [providerId]: msg },
      }));
      return { ok: false, error: msg };
    }
  },

  refetchAll: async (configured) => {
    if (configured.length === 0) return { success: 0, failed: 0 };
    const results = await Promise.all(
      configured.map((c) =>
        get().fetchModelsForProvider(c.providerId, c.apiKey, c.baseUrl, c.azureApiVersion, c.adapterFamily),
      ),
    );
    const success = results.filter((r) => r.ok).length;
    return { success, failed: results.length - success };
  },

  __reset: () => {
    set({
      modelsByProvider: {},
      fetchStatusByProvider: {},
      fetchErrorByProvider: {},
      lastFetchedAtByProvider: {},
      ownerMap: {},
    });
  },

  hydrate: (blob) => {
    const patch: Partial<ModelRegistryState> = {};
    if (isModelArray(blob.modelsByProvider)) {
      // Wrap as record keyed by providerId — the catalog drives keys, so we
      // re-key from the array on hydrate.
      const rec: Record<string, Model[]> = {};
      for (const m of blob.modelsByProvider as unknown as Model[]) {
        const key = m.providerId;
        if (!rec[key]) rec[key] = [];
        rec[key].push(m);
      }
      patch.modelsByProvider = rec;
    } else if (blob.modelsByProvider && typeof blob.modelsByProvider === 'object') {
      // Already keyed by providerId — validate each section.
      const rec: Record<string, Model[]> = {};
      for (const [pid, list] of Object.entries(blob.modelsByProvider as Record<string, unknown>)) {
        if (isModelArray(list)) rec[pid] = list;
      }
      patch.modelsByProvider = rec;
    }
    if (isNumberRecord(blob.lastFetchedAtByProvider)) {
      patch.lastFetchedAtByProvider = blob.lastFetchedAtByProvider;
    }
    if (Object.keys(patch).length > 0) set(patch);
  },
}));

const persist = registerPersistSlice({
  name: 'modelRegistry',
  keys: PERSIST_KEYS_MODEL_REGISTRY,
  getState: () => useModelRegistryStore.getState() as unknown as Record<string, unknown>,
  hydrate: (blob) => useModelRegistryStore.getState().hydrate(blob),
});

/** Convenience selector: list of models for the current chatProvider. */
export function selectModelsForProvider(providerId: string) {
  return (s: ModelRegistryState): Model[] => s.modelsByProvider[providerId] ?? [];
}

/** ponytail: gate the fetch button — `requiresApiKey` providers need a key. */
export function canFetchModelsFromStore(entry: ProviderEntry | undefined, apiKey: string): boolean {
  if (!entry) return false;
  if ('backendReady' in entry && !entry.backendReady) return false;
  if (providerRequiresApiKey(entry) && !apiKey) return false;
  return true;
}
