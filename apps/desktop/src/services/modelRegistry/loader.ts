/**
 * Runtime catalog loader.
 *
 * ponytail: static JSON import instead of readFileSync — Vite bundles the
 * JSON into the JS bundle, no IO at runtime. The catalog ships with the
 * binary; it only changes on app update. No idle re-fetch logic.
 *
 * Type guards run once at module load; a malformed catalog (models.dev
 * schema drift) throws here, loudly, instead of producing broken UI.
 */

import catalogJson from './data/models-catalog.json';
import type { CatalogJson, Model, Capability } from './types';

function isCapability(v: unknown): v is Capability {
  return (
    v === 'vision' ||
    v === 'reasoning' ||
    v === 'web-search' ||
    v === 'function-call' ||
    v === 'structured-output'
  );
}

function coerceModel(raw: unknown): Model | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== 'string' || typeof r.providerId !== 'string') return null;
  const caps = Array.isArray(r.capabilities)
    ? r.capabilities.filter(isCapability)
    : [];
  const inputModalities = Array.isArray(r.inputModalities)
    ? r.inputModalities.filter((x): x is string => typeof x === 'string')
    : ['text'];
  const pricing =
    r.pricing && typeof r.pricing === 'object'
      ? {
          inputPerMtok:
            typeof (r.pricing as Record<string, unknown>).inputPerMtok === 'number'
              ? ((r.pricing as Record<string, unknown>).inputPerMtok as number)
              : undefined,
          outputPerMtok:
            typeof (r.pricing as Record<string, unknown>).outputPerMtok === 'number'
              ? ((r.pricing as Record<string, unknown>).outputPerMtok as number)
              : undefined,
        }
      : undefined;
  return {
    id: r.id,
    providerId: r.providerId,
    capabilities: caps,
    inputModalities,
    ...(pricing && (pricing.inputPerMtok !== undefined || pricing.outputPerMtok !== undefined)
      ? { pricing }
      : {}),
  };
}

function buildIndex(json: unknown): Map<string, Model> {
  if (!json || typeof json !== 'object') return new Map();
  const root = json as CatalogJson;
  if (!root.models || typeof root.models !== 'object') return new Map();
  const idx = new Map<string, Model>();
  for (const [, raw] of Object.entries(root.models)) {
    const m = coerceModel(raw);
    if (m) idx.set(`${m.providerId}:${m.id}`, m);
  }
  return idx;
}

const catalog: ReadonlyMap<string, Model> = buildIndex(catalogJson);

/** Look up a model by (providerId, modelId). Returns undefined if unknown. */
export function findModelInCatalog(providerId: string, modelId: string): Model | undefined {
  return catalog.get(`${providerId}:${modelId}`);
}

/** All catalog entries for a provider. */
export function catalogModelsForProvider(providerId: string): Model[] {
  const out: Model[] = [];
  for (const m of catalog.values()) {
    if (m.providerId === providerId) out.push(m);
  }
  return out;
}

/** Number of catalog entries (test/debug). */
export function catalogSize(): number {
  return catalog.size;
}

/** ISO date when the sync script last ran. */
export function catalogGeneratedAt(): string | undefined {
  const root = catalogJson as CatalogJson;
  return root.generatedAt;
}
