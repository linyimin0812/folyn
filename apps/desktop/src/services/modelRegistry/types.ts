/**
 * Model registry types — internal shape for the catalog + fetched models.
 *
 * ponytail: catalog capabilities is a string union, not a zod enum. The
 * catalog ships as JSON committed to the repo; malformed entries fail loudly
 * when the loader runs manual type guards (no zod dep).
 */

export type Capability =
  | 'vision'
  | 'reasoning'
  | 'web-search'
  | 'function-call'
  | 'structured-output';

export interface ModelPricing {
  /** USD per million input tokens. */
  inputPerMtok?: number;
  /** USD per million output tokens. */
  outputPerMtok?: number;
}

export interface Model {
  id: string;
  providerId: string;
  capabilities: Capability[];
  inputModalities: string[];
  pricing?: ModelPricing;
}

/** Shape of `apps/desktop/src/services/modelRegistry/data/models-catalog.json`. */
export interface CatalogJson {
  /** Keyed by `${providerId}:${modelId}` for O(1) lookup. */
  models: Record<string, Model>;
  /** ISO date string when the sync script last ran. */
  generatedAt: string;
}

/** models.dev's per-provider shape (only fields we read). */
export interface ModelsDevProvider {
  id: string;
  name: string;
  models: Record<string, ModelsDevModel>;
}

export interface ModelsDevModel {
  id: string;
  name?: string;
  attachment?: boolean;
  reasoning?: boolean;
  tool_call?: boolean;
  structured_output?: boolean;
  modalities?: { input?: string[]; output?: string[] };
  cost?: { input?: number; output?: number };
}
