/**
 * Lookup helper over the bundled `providers.json` catalog — feeds the
 * ModelServicesSettings page (API URL placeholder + path preview + docs/models links).
 *
 * ponytail: catalog IDs (chatProvider state) don't always match providers.json
 * keys (azure-openai vs azure, gemini vs google, moonshot vs moonshotai,
 * together vs togetherai). A small alias map bridges them; unmapped ids
 * pass through. Custom providers / compat escape-hatches aren't in
 * providers.json — callers get null and fall back to existing behavior.
 */

import providersJson from '@/assets/providers/providers.json';

const ENDPOINT_PATH: Record<string, string> = {
  'openai-chat-completions': '/v1/chat/completions',
  'openai-responses': '/v1/responses',
  'anthropic-messages': '/v1/messages',
  'cohere': '/v2/chat',
  'google-generate-content': '/v1beta/models',
  'ollama': '/api/chat',
  'new-api': '/v1/chat/completions',
};

const CATALOG_TO_JSON_ID: Record<string, string> = {
  'azure-openai': 'azure',
  'gemini': 'google',
  'moonshot': 'moonshotai',
  'together': 'togetherai',
};

interface EndpointConfig {
  baseUrl?: string;
  adapterFamily?: string;
  [k: string]: unknown;
}

interface ProviderConfig {
  defaultChatEndpoint: string;
  authOptional?: boolean;
  endpointConfigs: Record<string, EndpointConfig>;
  metadata?: {
    website?: {
      apiKey?: string;
      docs?: string;
      models?: string;
      [k: string]: unknown;
    };
  };
}

function lookup(catalogId: string): ProviderConfig | null {
  console.log("catalogId: " + catalogId);
  const jsonId = CATALOG_TO_JSON_ID[catalogId] ?? catalogId;
  return (providersJson as Record<string, ProviderConfig>)[jsonId] ?? null;
}

export function getProviderApiBaseUrl(catalogId: string): string | null {
  const cfg = lookup(catalogId);
  if (!cfg) return null;
  return cfg.endpointConfigs[cfg.defaultChatEndpoint]?.baseUrl ?? null;
}

export function getProviderApiKeyUrl(catalogId: string): string | null {
  return lookup(catalogId)?.metadata?.website?.apiKey ?? null;
}

/** providers.json `authOptional: true` (ollama) → no key required. Default true. */
export function getProviderRequiresApiKey(catalogId: string): boolean {
  return !lookup(catalogId)?.authOptional;
}

/** Azure needs deployment_id + api_version; detected via adapterFamily prefix. */
export function getProviderRequiresAzureFields(catalogId: string): boolean {
  const cfg = lookup(catalogId);
  if (!cfg) return false;
  const af = cfg.endpointConfigs[cfg.defaultChatEndpoint]?.adapterFamily;
  return af?.startsWith('azure') ?? false;
}

export function getProviderApiPath(catalogId: string): string | null {
  const cfg = lookup(catalogId);
  if (!cfg) return null;
  return ENDPOINT_PATH[cfg.defaultChatEndpoint] ?? null;
}

export function getProviderDocsUrl(catalogId: string): string | null {
  return lookup(catalogId)?.metadata?.website?.docs ?? null;
}

export function getProviderModelsUrl(catalogId: string): string | null {
  return lookup(catalogId)?.metadata?.website?.models ?? null;
}

/**
 * Build the preview URL by appending `path` to `base` with two special cases:
 *   1. base already contains the full path → return base as-is (user pasted a
 *      complete endpoint URL; don't double-append).
 *   2. base ends with `/v1` (optional trailing slash) → strip that `/v1` first
 *      so e.g. `https://api.openai.com/v1` + `/v1/responses` becomes
 *      `https://api.openai.com/v1/responses`, not `…/v1/v1/responses`.
 * Other bases just get path appended (a trailing slash is trimmed to avoid //).
 */
export function buildPreviewUrl(base: string, path: string): string {
  if (base.includes(path)) return base;
  const stripped = base.replace(/\/v1\/?$/, '');
  const trimmedTrailingSlash = stripped.endsWith('/') ? stripped.slice(0, -1) : stripped;
  return `${trimmedTrailingSlash}${path}`;
}
