import { create } from 'zustand';
import { registerPersistSlice, schedulePersist } from './settingsPersistence';
import { fetchModels as fetchModelsRaw } from '@/services/modelRegistry/fetchModels';
import { providerRequiresApiKey, type ProviderEntry } from '@/services/providers/catalog';
import { readUserProviderModels, writeUserProviderModels } from '@/services/modelRegistry/userProvidersCatalog';
import { fetchOwnerMap, ownerLookupKey } from '@/services/modelRegistry/fetchOwnerMap';
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

  /** Single-provider fetch + write-through. */
  fetchModelsForProvider: (
    providerId: string,
    apiKey: string,
    baseUrl?: string,
    azureApiVersion?: string,
    customProvider?: boolean,
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
      customProvider?: boolean;
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

  fetchModelsForProvider: async (providerId, apiKey, baseUrl, azureApiVersion, customProvider, adapterFamily) => {
    set((s) => ({
      fetchStatusByProvider: { ...s.fetchStatusByProvider, [providerId]: 'loading' },
      fetchErrorByProvider: { ...s.fetchErrorByProvider, [providerId]: null },
    }));
    try {
      const result = await fetchModelsRaw({ provider: providerId, apiKey, baseUrl, azureApiVersion, customProvider, adapterFamily });
      set((s) => ({
        modelsByProvider: { ...s.modelsByProvider, [providerId]: result.models },
        fetchStatusByProvider: { ...s.fetchStatusByProvider, [providerId]: 'success' },
        fetchErrorByProvider: { ...s.fetchErrorByProvider, [providerId]: null },
        lastFetchedAtByProvider: {
          ...s.lastFetchedAtByProvider,
          [providerId]: Date.now(),
        },
      }));
      schedulePersist();
      // ponytail: fire-and-forget the file write — cache failure must not
      // block the main flow. Enrich with `owner` from the OpenRouter owner
      // map before writing (matches the old refetchAllFromModelsDev
      // behavior). `fetchOwnerMap` never throws and reads from a 24h
      // disk cache when fresh. The in-memory store stays `Model[]`
      // (no owner); owner is a file-only concern for downstream consumers.
      void (async () => {
        try {
          const ownerMap = await fetchOwnerMap();
          const enriched = result.models.map((m) => ({
            ...m,
            owner: ownerMap[ownerLookupKey(m.id)]?.providerId ?? m.providerId,
          }));
          await writeUserProviderModels(providerId, enriched);
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
        get().fetchModelsForProvider(c.providerId, c.apiKey, c.baseUrl, c.azureApiVersion, c.customProvider, c.adapterFamily),
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

registerPersistSlice({
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
