/**
 * Runtime fetch of https://models.dev/api.json — refreshes the in-memory
 * provider catalog with the latest model definitions from models.dev.
 *
 * Uses the `fetch_url` Tauri command (Rust/reqwest) instead of the
 * browser's `fetch()` because models.dev and openrouter.ai don't return
 * CORS headers, so the webview can't reach them directly.
 *
 * ponytail: response is returned to callers; persistence (write to
 * ~/.folyn/providers/) is handled by `userProvidersCatalog.ts`.
 *
 * On-disk shape is the RAW slice from api.json (no transform) — see
 * `ModelsDevProvider`.
 */

import { invoke } from '@tauri-apps/api/core';

export interface ModelsDevReasoningOption {
  type: 'effort' | 'budget_tokens';
  values?: string[];
  min?: number;
  max?: number;
}

export interface ModelsDevCostTier {
  input?: number;
  output?: number;
  tier: {
    type: string;
    size?: number;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface ModelsDevCost {
  input?: number;
  output?: number;
  cache_read?: number;
  cache_write?: number;
  input_audio?: number;
  output_audio?: number;
  reasoning?: number;
  context_over_200k?: { input?: number; output?: number };
  tiers?: ModelsDevCostTier[];
  [key: string]: unknown;
}

export interface ModelsDevLimit {
  context?: number;
  input?: number;
  output?: number;
  [key: string]: unknown;
}

export interface ModelsDevModalities {
  input?: string[];
  output?: string[];
  [key: string]: unknown;
}

export interface ModelsDevExperimental {
  modes?: Record<string, {
    cost?: ModelsDevCost;
    provider?: { npm?: string; api?: string; [key: string]: unknown };
    [key: string]: unknown;
  }>;
  [key: string]: unknown;
}

export interface ModelsDevModel {
  id: string;
  name?: string;
  description?: string;
  family?: string;
  attachment?: boolean;
  reasoning?: boolean;
  reasoning_options?: ModelsDevReasoningOption[];
  tool_call?: boolean;
  structured_output?: boolean;
  temperature?: boolean;
  knowledge?: string;
  release_date?: string;
  last_updated?: string;
  modalities?: ModelsDevModalities;
  open_weights?: boolean;
  limit?: ModelsDevLimit;
  cost?: ModelsDevCost;
  experimental?: ModelsDevExperimental;
  status?: string;
  interleaved?: boolean;
  /** Cross-provider routing info (e.g. Azure hosting another vendor's model). */
  provider?: { npm?: string; api?: string; [key: string]: unknown };
  /** Populated at write-time from the OpenRouter owner map; defaults to the current provider id if no match. */
  owner?: string;
  [key: string]: unknown;
}

export interface ModelsDevProvider {
  id: string;
  name?: string;
  env?: string[];
  npm?: string;
  doc?: string;
  /** Some providers (deepseek) carry a base API URL here instead of via endpointConfigs. */
  api?: string;
  models: Record<string, ModelsDevModel>;
  [key: string]: unknown;
}

export type ModelsDevResponse = Record<string, ModelsDevProvider>;

export const MODELS_DEV_URL = 'https://models.dev/api.json';

let cached: ModelsDevResponse | null = null;

interface FetchUrlResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}

export async function fetchModelsDevCatalog(): Promise<ModelsDevResponse> {
  const res = await invoke<FetchUrlResponse>('fetch_url', { url: MODELS_DEV_URL });
  if (res.status !== 200) {
    throw new Error(`models.dev responded ${res.status}`);
  }
  cached = JSON.parse(res.body) as ModelsDevResponse;
  return cached;
}

export function getCachedModelsDevCatalog(): ModelsDevResponse | null {
  return cached;
}
