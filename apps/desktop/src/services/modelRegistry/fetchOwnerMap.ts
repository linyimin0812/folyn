/**
 * Build a `{ modelId: { providerId, capabilities } }` map from OpenRouter's
 * `/models` and `/embeddings/models` endpoints. Used to populate the `owner`
 * field on each model in `{provider}/models.json`.
 *
 * Parsing rule (per spec):
 *   input:  "nvidia/nemotron-3-embed-1b:free"
 *   split on first "/":  provider = "nvidia", rest = "nemotron-3-embed-1b:free"
 *   drop ":" suffix:    modelId = "nemotron-3-embed-1b"
 *   lowercase both. Leading `~` on the provider part is stripped
 *   (OpenRouter marks passthrough vendors with it; we want the bare name).
 *
 * ponytail: never throws — on any error returns `{}` so the caller can fall
 * back to using the current provider id as the default `owner`. Failures
 * here must not block per-provider models.json generation.
 *
 * Routed through the `fetch_url` Tauri command because openrouter.ai
 * doesn't return CORS headers (preflight 404).
 *
 * Disk cache: writes `~/.quill/providers/provider-models.json` on first
 * fetch and reuses it for 24h. Cache shape matches the return shape.
 */

import { invoke } from '@tauri-apps/api/core';
import { join } from '@tauri-apps/api/path';
import { exists, readTextFile, writeTextFile, stat } from '@tauri-apps/plugin-fs';
import { getUserProvidersDir } from './userProvidersCatalog';
import type { Capability } from './types';

const OPENROUTER_API_KEY = 'sk-or-v1-quill';
const ENDPOINTS = [
  'https://openrouter.ai/api/v1/models',
  'https://openrouter.ai/api/v1/embeddings/models',
];

/** 24h in ms — refresh the cache once per day at most. */
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

const CACHE_FILENAME = 'provider-models.json';

export interface OwnerEntry {
  modelId: string;
  providerId: string;
  capabilities: Capability[];
}
export type OwnerMap = Record<string, OwnerEntry>;

interface OrModel {
  id: string;
  architecture?: { input_modalities?: string[] };
  supported_parameters?: string[];
  pricing?: { web_search?: string | null };
  reasoning?: unknown;
}

interface OrResponse { data?: OrModel[] }
interface FetchUrlResponse { status: number; body: string }

export function parseOwnerKey(id: string): { provider: string; modelId: string } | null {
  const slashIdx = id.indexOf('/');
  if (slashIdx < 0) return null;
  // ponytail: OpenRouter prefixes passthrough vendors with `~` (e.g. `~openai/gpt-latest`);
  // strip it so owner = `openai`, not `~openai`.
  let provider = id.slice(0, slashIdx);
  if (provider.startsWith('~')) provider = provider.slice(1);
  provider = provider.toLowerCase();
  const afterSlash = id.slice(slashIdx + 1);
  const colonIdx = afterSlash.indexOf(':');
  const modelId = (colonIdx < 0 ? afterSlash : afterSlash.slice(0, colonIdx)).toLowerCase();
  if (!provider || !modelId) return null;
  return { provider, modelId };
}

/**
 * Given a model entry's `id` (which may be bare like `claude-sonnet-4-6` or
 * namespaced like `~openai/gpt-latest`), return the lookup key for the owner
 * map. Bare ids are looked up as-is; namespaced ids are parsed with the same
 * rule as OpenRouter ids (drop the vendor prefix, drop `:suffix`, lowercase).
 */
export function ownerLookupKey(id: string): string {
  const parsed = parseOwnerKey(id);
  return parsed ? parsed.modelId : id.toLowerCase();
}

/** Map an OpenRouter model entry to our Capability union. */
function deriveCapabilities(m: OrModel): Capability[] {
  const caps: Capability[] = [];
  const inputMods = m.architecture?.input_modalities ?? [];
  if (inputMods.some((x) => x === 'image' || x === 'video' || x === 'file')) {
    caps.push('vision');
  }
  const params = m.supported_parameters ?? [];
  if (params.some((p) => p === 'reasoning' || p === 'include_reasoning')) {
    caps.push('reasoning');
  }
  if (params.includes('tools')) {
    caps.push('function-call');
  }
  if (params.includes('structured_outputs')) {
    caps.push('structured-output');
  }
  if (m.pricing && typeof m.pricing.web_search === 'string' && m.pricing.web_search !== '') {
    caps.push('web-search');
  }
  return caps;
}

async function readCache(): Promise<OwnerMap | null> {
  try {
    const dir = await getUserProvidersDir();
    const filePath = await join(dir, CACHE_FILENAME);
    if (!(await exists(filePath))) return null;
    const statResult = await stat(filePath);
    const mtime = statResult.mtime;
    if (!mtime) return null;
    if (Date.now() - mtime.getTime() > CACHE_TTL_MS) return null;
    const raw = await readTextFile(filePath);
    const parsed = JSON.parse(raw) as OwnerMap;
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed;
  } catch {
    return null;
  }
}

async function writeCache(map: OwnerMap): Promise<void> {
  try {
    const dir = await getUserProvidersDir();
    const filePath = await join(dir, CACHE_FILENAME);
    await writeTextFile(filePath, JSON.stringify(map, null, 2) + '\n');
  } catch {
    // best-effort — caller still has the in-memory map
  }
}

export async function fetchOwnerMap(): Promise<OwnerMap> {
  const cached = await readCache();
  if (cached) return cached;

  const out: OwnerMap = {};
  for (const url of ENDPOINTS) {
    try {
      const res = await invoke<FetchUrlResponse>('fetch_url', {
        url,
        headers: { authorization: `Bearer ${OPENROUTER_API_KEY}` },
      });
      if (res.status !== 200) {
        console.warn(`[owner-map] ${url} responded ${res.status} — skipping`);
        continue;
      }
      const json = JSON.parse(res.body) as OrResponse;
      for (const m of json.data ?? []) {
        const parsed = parseOwnerKey(m.id);
        if (!parsed) continue;
        out[parsed.modelId] = {
          modelId: parsed.modelId,
          providerId: parsed.provider,
          capabilities: deriveCapabilities(m),
        };
      }
    } catch (e) {
      console.warn(`[owner-map] ${url} failed: ${(e as Error).message} — skipping`);
    }
  }
  await writeCache(out);
  return out;
}

/**
 * Merge capabilities from a provider fetch into the owner-map disk cache.
 * Called by `modelRegistryStore.fetchModelsForProvider` after enrichment
 * so ownerMap grows more complete over time — catalog (models.dev) caps
 * that OpenRouter doesn't list become available for future providers'
 * orphan lookups.
 *
 * Dedup rule (per PRD): same `ownerLookupKey(id)` already present with
 * non-empty capabilities → skip (preserve OpenRouter's authoritative
 * data); empty or missing → fill. Returns the merged map and writes it
 * back to `provider-models.json`.
 */
export async function mergeCapabilitiesIntoOwnerMap(
  entries: ReadonlyArray<{ id: string; capabilities: Capability[]; providerId?: string }>,
  opts: { force?: boolean } = {},
): Promise<OwnerMap> {
  const current = await fetchOwnerMap();
  let changed = false;
  for (const e of entries) {
    if (!e.capabilities.length && !opts.force) continue;
    const key = ownerLookupKey(e.id);
    const existing = current[key];
    if (opts.force || !existing || existing.capabilities.length === 0) {
      current[key] = {
        modelId: key,
        providerId: e.providerId ?? existing?.providerId ?? key,
        capabilities: e.capabilities,
      };
      changed = true;
    }
  }
  if (changed) await writeCache(current);
  return current;
}

