/**
 * Provider catalog — single source of truth for the Chat 模式 provider dropdown.
 *
 * ponytail: the Rust side (`apps/desktop/src-tauri/src/chat.rs`) routes by
 * provider id via a 20-arm `match`. The catalog holds everything the UI needs
 * (label / default base url / api key url / field visibility / category) and
 * nothing Rust doesn't need. `rigClientKind` is mirrored in Rust as a routing
 * hint; do not duplicate other fields there.
 *
 * All 20 providers are backendReady=true after T03 — chat.rs has all native
 * arms wired (anthropic / anthropic-compatible / gemini / azure-openai /
 * cohere / huggingface / ollama) + the openai-compat fallback for the 11
 * OpenAI-compat family.
 */

export type ProviderCategory =
  | 'native'
  | 'compat'
  | 'openai-family'
  | 'local';

/**
 * User-selectable type for custom providers. Drives the label shown in the
 * add-provider drawer; backend routing still falls through chat.rs `_` arm
 * (OpenAI-compat) regardless of this value — picking "Gemini" or "Anthropic"
 * here is a label/preset, not a wire-format switch.
 */
export type CustomProviderType =
  | 'openai'
  | 'openai-response'
  | 'gemini'
  | 'anthropic'
  | 'azure-openai'
  | 'new-api'
  | 'ollama';

/**
 * User-defined provider entry. Routes through chat.rs `_` fallback arm
 * (OpenAI-compat). `rigClientKind` is implicit `'openai-compat'` — the
 * backend matches unknown ids and uses base_url + api_key directly.
 */
export interface CustomProvider {
  id: string;
  displayName: string;
  baseUrl: string;
  apiKeyUrl: string | null;
  category: CustomProviderType;
  createdAt: number;
}

export type ProviderEntry = ProviderCatalogEntry | CustomProvider;

export function isCustomProvider(e: ProviderEntry): e is CustomProvider {
  return 'displayName' in e;
}

export function providerId(e: ProviderEntry): string {
  return e.id;
}

export function providerDisplayName(e: ProviderEntry, t: (k: string) => string): string {
  return isCustomProvider(e) ? e.displayName : t(e.i18nKey);
}

/** First-char avatar label. */
export function providerAvatarChar(e: ProviderEntry, t: (k: string) => string): string {
  const name = providerDisplayName(e, t).trim();
  return name.charAt(0).toUpperCase() || '?';
}

export function providerCategory(e: ProviderEntry): ProviderCategory | CustomProviderType {
  return e.category;
}

export function providerBaseUrl(e: ProviderEntry): string | null {
  if (isCustomProvider(e)) return e.baseUrl;
  return e.defaultBaseUrl;
}

export function providerApiKeyUrl(e: ProviderEntry): string | null {
  if (isCustomProvider(e)) return e.apiKeyUrl;
  return e.apiKeyUrl;
}

export function providerRequiresApiKey(e: ProviderEntry): boolean {
  if (isCustomProvider(e)) return true;
  return e.requiresApiKey;
}

export function providerRequiresAzureFields(e: ProviderEntry): boolean {
  if (isCustomProvider(e)) return false;
  return e.requiresAzureFields;
}

export function providerPlaceholderModel(e: ProviderEntry): string {
  if (isCustomProvider(e)) return 'gpt-4o-mini';
  return e.placeholderModel;
}

/** Routes to which rig client (or raw HTTP strategy) in chat.rs / list_models.rs. */
export type RigClientKind =
  | 'anthropic'
  | 'openai'
  | 'openai-compat'
  | 'azure'
  | 'cohere'
  | 'gemini'
  | 'huggingface'
  | 'ollama';

export interface ProviderCatalogEntry {
  id: string;
  category: ProviderCategory;
  /** i18n key under `settings:models.provider.<id>` for the display label. */
  i18nKey: string;
  /** Default base URL baked in (null = no default, user must fill). */
  defaultBaseUrl: string | null;
  /** Placeholder text for the model input. */
  placeholderModel: string;
  /** URL to the provider's API key signup page. null = no link rendered. */
  apiKeyUrl: string | null;
  /** Whether this provider requires an api key (Ollama doesn't). */
  requiresApiKey: boolean;
  /** Whether this provider needs the Azure-specific deployment_id + api_version fields. */
  requiresAzureFields: boolean;
  /** Routing hint mirrored in Rust. */
  rigClientKind: RigClientKind;
  /**
   * All 20 providers have chat.rs arms wired (T01 shipped 15/20, T02 added
   * Gemini, T03 added Azure/Cohere/HuggingFace/Ollama). The flag remains in
   * the catalog as a forward-compatibility hook — a future provider can ship
   * in the dropdown before its chat.rs arm lands, and the test button will
   * show "backend 待接入" instead of failing with a raw rig error.
   */
  backendReady: boolean;
}

export const PROVIDER_CATALOG: readonly ProviderCatalogEntry[] = [
  // ── 原生 (native) ──────────────────────────────────────────────
  {
    id: 'anthropic',
    category: 'native',
    i18nKey: 'settings:models.provider.anthropic',
    defaultBaseUrl: null,
    placeholderModel: 'claude-sonnet-4-6',
    apiKeyUrl: 'https://console.anthropic.com/settings/keys',
    requiresApiKey: true,
    requiresAzureFields: false,
    rigClientKind: 'anthropic',
    backendReady: true,
  },
  {
    id: 'openai',
    category: 'native',
    i18nKey: 'settings:models.provider.openai',
    defaultBaseUrl: null,
    placeholderModel: 'gpt-5.2',
    apiKeyUrl: 'https://platform.openai.com/api-keys',
    requiresApiKey: true,
    requiresAzureFields: false,
    rigClientKind: 'openai',
    backendReady: true,
  },
  {
    id: 'azure-openai',
    category: 'native',
    i18nKey: 'settings:models.provider.azure-openai',
    defaultBaseUrl: null,
    placeholderModel: 'gpt-4o',
    apiKeyUrl: 'https://portal.azure.com',
    requiresApiKey: true,
    requiresAzureFields: true,
    rigClientKind: 'azure',
    backendReady: true,
  },
  {
    id: 'cohere',
    category: 'native',
    i18nKey: 'settings:models.provider.cohere',
    defaultBaseUrl: null,
    placeholderModel: 'command-r-plus',
    apiKeyUrl: 'https://dashboard.cohere.com/api-keys',
    requiresApiKey: true,
    requiresAzureFields: false,
    rigClientKind: 'cohere',
    backendReady: true,
  },
  {
    id: 'gemini',
    category: 'native',
    i18nKey: 'settings:models.provider.gemini',
    defaultBaseUrl: null,
    placeholderModel: 'gemini-1.5-pro',
    apiKeyUrl: 'https://aistudio.google.com/apikey',
    requiresApiKey: true,
    requiresAzureFields: false,
    rigClientKind: 'gemini',
    backendReady: true,
  },
  {
    id: 'huggingface',
    category: 'native',
    i18nKey: 'settings:models.provider.huggingface',
    defaultBaseUrl: null,
    placeholderModel: 'meta-llama/Meta-Llama-3-70B',
    apiKeyUrl: 'https://huggingface.co/settings/tokens',
    requiresApiKey: true,
    requiresAzureFields: false,
    rigClientKind: 'huggingface',
    backendReady: true,
  },
  {
    id: 'ollama',
    category: 'local',
    i18nKey: 'settings:models.provider.ollama',
    defaultBaseUrl: 'http://localhost:11434/v1',
    placeholderModel: 'llama3.2',
    apiKeyUrl: null,
    requiresApiKey: false,
    requiresAzureFields: false,
    rigClientKind: 'ollama',
    backendReady: true,
  },
  // ── 兼容 (compat escape hatches) ──────────────────────────────
  {
    id: 'openai-compatible',
    category: 'compat',
    i18nKey: 'settings:models.provider.openai-compatible',
    defaultBaseUrl: null,
    placeholderModel: 'gpt-4o-mini',
    apiKeyUrl: null,
    requiresApiKey: true,
    requiresAzureFields: false,
    rigClientKind: 'openai-compat',
    backendReady: true,
  },
  {
    id: 'anthropic-compatible',
    category: 'compat',
    i18nKey: 'settings:models.provider.anthropic-compatible',
    defaultBaseUrl: null,
    placeholderModel: 'claude-sonnet-4-6',
    apiKeyUrl: null,
    requiresApiKey: true,
    requiresAzureFields: false,
    rigClientKind: 'anthropic',
    backendReady: true,
  },
  // ── OpenAI 兼容家族 (openai-family) ───────────────────────────
  {
    id: 'deepseek',
    category: 'openai-family',
    i18nKey: 'settings:models.provider.deepseek',
    defaultBaseUrl: 'https://api.deepseek.com',
    placeholderModel: 'deepseek-chat',
    apiKeyUrl: 'https://platform.deepseek.com/api_keys',
    requiresApiKey: true,
    requiresAzureFields: false,
    rigClientKind: 'openai-compat',
    backendReady: true,
  },
  {
    id: 'groq',
    category: 'openai-family',
    i18nKey: 'settings:models.provider.groq',
    defaultBaseUrl: 'https://api.groq.com/openai/v1',
    placeholderModel: 'llama-3.3-70b-versatile',
    apiKeyUrl: 'https://console.groq.com/keys',
    requiresApiKey: true,
    requiresAzureFields: false,
    rigClientKind: 'openai-compat',
    backendReady: true,
  },
  {
    id: 'moonshot',
    category: 'openai-family',
    i18nKey: 'settings:models.provider.moonshot',
    defaultBaseUrl: 'https://api.moonshot.cn/v1',
    placeholderModel: 'moonshot-v1-8k',
    apiKeyUrl: 'https://platform.moonshot.cn/console/api-keys',
    requiresApiKey: true,
    requiresAzureFields: false,
    rigClientKind: 'openai-compat',
    backendReady: true,
  },
  {
    id: 'openrouter',
    category: 'openai-family',
    i18nKey: 'settings:models.provider.openrouter',
    defaultBaseUrl: 'https://openrouter.ai/api/v1',
    placeholderModel: 'anthropic/claude-3.5-sonnet',
    apiKeyUrl: 'https://openrouter.ai/keys',
    requiresApiKey: true,
    requiresAzureFields: false,
    rigClientKind: 'openai-compat',
    backendReady: true,
  },
  {
    id: 'perplexity',
    category: 'openai-family',
    i18nKey: 'settings:models.provider.perplexity',
    defaultBaseUrl: 'https://api.perplexity.ai',
    placeholderModel: 'sonar-pro',
    apiKeyUrl: 'https://www.perplexity.ai/settings/api',
    requiresApiKey: true,
    requiresAzureFields: false,
    rigClientKind: 'openai-compat',
    backendReady: true,
  },
  {
    id: 'together',
    category: 'openai-family',
    i18nKey: 'settings:models.provider.together',
    defaultBaseUrl: 'https://api.together.xyz/v1',
    placeholderModel: 'meta-llama/Meta-Llama-3.1-70B-Instruct-Turbo',
    apiKeyUrl: 'https://api.together.xyz/settings/api-keys',
    requiresApiKey: true,
    requiresAzureFields: false,
    rigClientKind: 'openai-compat',
    backendReady: true,
  },
  {
    id: 'xai',
    category: 'openai-family',
    i18nKey: 'settings:models.provider.xai',
    defaultBaseUrl: 'https://api.x.ai/v1',
    placeholderModel: 'grok-2',
    apiKeyUrl: 'https://console.x.ai',
    requiresApiKey: true,
    requiresAzureFields: false,
    rigClientKind: 'openai-compat',
    backendReady: true,
  },
] as const;

export const PROVIDER_IDS: readonly string[] = PROVIDER_CATALOG.map((p) => p.id);

export type ChatProviderId = (typeof PROVIDER_CATALOG)[number]['id'];

/** Lookup by id, throws on miss (catalog is exhaustive). */
export function getProviderEntry(id: string): ProviderCatalogEntry | undefined {
  return PROVIDER_CATALOG.find((p) => p.id === id);
}

export const PROVIDER_CATEGORY_ORDER: readonly ProviderCategory[] = [
  'native',
  'compat',
  'openai-family',
  'local',
];

export function providersByCategory(
  cat: ProviderCategory,
): readonly ProviderCatalogEntry[] {
  return PROVIDER_CATALOG.filter((p) => p.category === cat);
}

/**
 * Lookup by id, including custom providers. Returns undefined if neither
 * catalog nor custom matches.
 */
export function getProviderEntryIncludingCustom(
  id: string,
  customProviders: readonly CustomProvider[],
): ProviderEntry | undefined {
  const catalogEntry = PROVIDER_CATALOG.find((p) => p.id === id);
  if (catalogEntry) return catalogEntry;
  return customProviders.find((p) => p.id === id);
}

/**
 * All providers: catalog ids in declared order, then custom providers in
 * creation order. Display sort is applied by the consumer (enabled-first,
 * then alphabetical).
 */
export function allProviders(
  customProviders: readonly CustomProvider[],
): ProviderEntry[] {
  const out: ProviderEntry[] = [];
  for (const e of PROVIDER_CATALOG) out.push(e);
  for (const c of customProviders) out.push(c);
  return out;
}
