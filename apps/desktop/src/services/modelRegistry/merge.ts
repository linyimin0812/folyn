/**
 * §6 merge + §8 capability pure functions.
 *
 * ponytail: all pure, side-effect-free, no IO. Tests are exhaustive
 * table-driven — see merge.test.ts and capabilities.test.ts.
 */

import type { Capability, Model } from './types';

/**
 * Merge a remote id list (from §3 fetcher — provider's `/models` endpoint)
 * with the offline catalog (§4 — models.dev + OpenRouter, shipped with app).
 *
 * - Remote id in catalog → enriched Model (capabilities, modalities, pricing).
 * - Remote id NOT in catalog → minimal Model with `capabilities: []`.
 * - Catalog entries NOT in remote list → omitted (provider doesn't actually
 *   serve that model — different account tier or region).
 */
export function mergeProviderModelsWithRegistry(
  remoteIds: readonly string[],
  catalogForProvider: readonly Model[],
  providerId: string,
): Model[] {
  const byId = new Map<string, Model>();
  for (const m of catalogForProvider) byId.set(m.id, m);
  const out: Model[] = [];
  for (const id of remoteIds) {
    const fromCat = byId.get(id);
    if (fromCat) {
      out.push(fromCat);
    } else {
      out.push({ id, providerId, capabilities: [], inputModalities: ['text'] });
    }
  }
  return out;
}

// §8 capability detection — pure, all return boolean.

export function isVisionModel(m: Pick<Model, 'capabilities' | 'inputModalities'>): boolean {
  return m.capabilities.includes('vision') || m.inputModalities.includes('image');
}

export function isReasoningModel(m: Pick<Model, 'capabilities'>): boolean {
  return m.capabilities.includes('reasoning');
}

export function isWebSearchModel(m: Pick<Model, 'capabilities'>): boolean {
  return m.capabilities.includes('web-search');
}

export function isFunctionCallingModel(m: Pick<Model, 'capabilities'>): boolean {
  return m.capabilities.includes('function-call');
}

export function hasCapability(m: Pick<Model, 'capabilities'>, cap: Capability): boolean {
  return m.capabilities.includes(cap);
}
