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
  // ponytail: paths match rig's actual completion_path emits, not the
  // canonical OpenAI docs URL. rig appends path to base_url as-is — so
  // 'openai-chat-completions' emits "/chat/completions" and expects the
  // user's base to include "/v1" (e.g. https://api.openai.com/v1).
  // Anthropic/Google/Ollama paths include their own version prefix
  // because their rig clients emit the full path.
  'openai-chat-completions': '/chat/completions',
  'openai-responses': '/responses',
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

/** Path for a raw endpoint key — used by custom providers whose
 *  defaultChatEndpoint is set but have no catalog entry. */
export function getEndpointPath(endpoint: string): string | null {
  return ENDPOINT_PATH[endpoint] ?? null;
}

export function getProviderDocsUrl(catalogId: string): string | null {
  return lookup(catalogId)?.metadata?.website?.docs ?? null;
}

export function getProviderModelsUrl(catalogId: string): string | null {
  return lookup(catalogId)?.metadata?.website?.models ?? null;
}

/**
 * Build the preview URL by appending `path` to `base`.
 *   1. base already contains the full path → return base as-is (user pasted a
 *      complete endpoint URL; don't double-append).
 *   2. otherwise trim a trailing slash and append path.
 * Matches rig's behavior: rig appends `completion_path` (e.g. "/chat/completions")
 * to base_url as-is — no /v1 stripping. If the user's base lacks "/v1", the
 * preview shows the missing /v1 (surfaces the problem instead of hiding it).
 */
export function buildPreviewUrl(base: string, path: string): string {
  if (base.includes(path)) return base;
  const trimmed = base.endsWith('/') ? base.slice(0, -1) : base;
  return `${trimmed}${path}`;
}

/**
 * Append `/v1` to base if it ends without a version segment. Mirrors the
 * Rust `openai-completions` arm in chat.rs so the preview shows the URL
 * rig will actually hit. Only call this for OpenAI-compat endpoints
 * (`/chat/completions` path); anthropic/google/ollama paths carry their
 * own version prefix.
 */
export function normalizeOpenAIBase(base: string): string {
  const trimmed = base.replace(/\/+$/, '');
  const lastSlash = trimmed.lastIndexOf('/');
  const lastSegment = lastSlash >= 0 ? trimmed.slice(lastSlash + 1) : '';
  const hasVersion = /^v\d+/.test(lastSegment);
  return hasVersion ? trimmed : `${trimmed}/v1`;
}
