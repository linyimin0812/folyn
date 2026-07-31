/**
 * Frontend bridge for the `list_models` Tauri command.
 *
 * Wraps `invoke('list_models', ...)` (returns `ModelDto[]` — just `{id}`),
 * then merges with the offline catalog (§6) so each entry carries
 * capabilities / modalities / pricing from models.dev.
 *
 * ponytail: the merge is in-memory; the result is not persisted here. T04
 * adds JSON persistence + write-through. For T02c the dropdown just lives
 * in component state for the session.
 */

import { invoke } from '@tauri-apps/api/core';
import { catalogModelsForProvider } from './loader';
import { mergeProviderModelsWithRegistry } from './merge';
import type { Model } from './types';
import { getProviderEntry, providerRequiresApiKey } from '@/services/providers/catalog';

export interface FetchModelsParams {
  provider: string;
  apiKey: string;
  baseUrl?: string;
  azureApiVersion?: string;
  /** Bundled adapter family id (e.g. "anthropic"). Rust falls back to `provider.as_str()` when absent. */
  adapterFamily?: string;
}

export interface FetchModelsResult {
  models: Model[];
  /** Empty list — provider returned no models (rare; usually means wrong key). */
  empty: boolean;
}

interface ModelDto {
  id: string;
}

export async function fetchModels(params: FetchModelsParams): Promise<FetchModelsResult> {
  const { provider, apiKey, baseUrl, azureApiVersion, adapterFamily } = params;
  // ponytail: catalog derives `requiresApiKey` from providers.json; we trust
  // the caller (SettingsPage) to have already gated the button on that.
  // Here we just forward to Rust.
  const remote = await invoke<ModelDto[]>('list_models', {
    params: {
      provider,
      apiKey,
      baseUrl: baseUrl || null,
      azureApiVersion: azureApiVersion || null,
      adapterFamily: adapterFamily ?? null,
    },
  });
  const ids = remote.map((m) => m.id);
  const catalog = catalogModelsForProvider(provider);
  const merged = mergeProviderModelsWithRegistry(ids, catalog, provider);
  return { models: merged, empty: merged.length === 0 };
}

/** Helper: is the selected chatModel present in the fetched list? */
export function isSelectedModelInList(
  chatModel: string,
  models: readonly Model[],
): boolean {
  return models.some((m) => m.id === chatModel);
}

/** ponytail: gate the fetch button — `requiresApiKey` providers need a key. */
export function canFetchModels(providerId: string, apiKey: string): boolean {
  const entry = getProviderEntry(providerId);
  if (!entry) return false;
  if (!entry.backendReady) return false;
  if (providerRequiresApiKey(entry) && !apiKey) return false;
  return true;
}
