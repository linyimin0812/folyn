/**
 * Build a `{ modelId: provider }` map from OpenRouter's `/models` and
 * `/embeddings/models` endpoints. Used to populate the `owner` field on
 * each model in `{provider}/models.json`.
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
 */

import { invoke } from '@tauri-apps/api/core';

const OPENROUTER_API_KEY = 'sk-or-v1-quill';
const ENDPOINTS = [
  'https://openrouter.ai/api/v1/models',
  'https://openrouter.ai/api/v1/embeddings/models',
];

interface OrModel { id: string }
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

export async function fetchOwnerMap(): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
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
        out[parsed.modelId] = parsed.provider;
      }
    } catch (e) {
      console.warn(`[owner-map] ${url} failed: ${(e as Error).message} — skipping`);
    }
  }
  return out;
}
