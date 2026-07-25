/**
 * Provider catalog — single source of truth for the Chat 模式 provider dropdown.
 *
 * ponytail: the Rust side (`apps/desktop/src-tauri/src/chat.rs`) routes by
 * provider id via a 20-arm `match`. The catalog holds everything the UI needs
 * (label / default base url / api key url / field visibility / category) and
 * nothing Rust doesn't need. `rigClientKind` is mirrored in Rust as a routing
 * hint; do not duplicate other fields there.
 *
 * backendReady is a T01-only flag: false for the 5 natives whose Rust arm
 * isn't wired yet (azure / cohere / gemini / huggingface / ollama). T03
 * flips these to true. The 15 OpenAI-compatible-family + Anthropic + OpenAI
 * + 2 compat entries are true from day one — they route through the
 * existing chat.rs arms.
 */

export type ProviderCategory =
  | 'native'
  | 'compat'
  | 'openai-family'
  | 'local';

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
  /** i18n key under `settings:ai.chat.provider.<id>` for the display label. */
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
   * T01 marker: false for the 5 natives whose chat.rs arm isn't wired yet.
   * Test/chat shows "backend 待接入" message instead of invoking chat_stream.
   */
  backendReady: boolean;
}

export const PROVIDER_CATALOG: readonly ProviderCatalogEntry[] = [
  // ── 原生 (native) ──────────────────────────────────────────────
  {
    id: 'anthropic',
    category: 'native',
    i18nKey: 'settings:ai.chat.provider.anthropic',
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
    i18nKey: 'settings:ai.chat.provider.openai',
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
    i18nKey: 'settings:ai.chat.provider.azure-openai',
    defaultBaseUrl: null,
    placeholderModel: 'gpt-4o',
    apiKeyUrl: 'https://portal.azure.com',
    requiresApiKey: true,
    requiresAzureFields: true,
    rigClientKind: 'azure',
    backendReady: false,
  },
  {
    id: 'cohere',
    category: 'native',
    i18nKey: 'settings:ai.chat.provider.cohere',
    defaultBaseUrl: null,
    placeholderModel: 'command-r-plus',
    apiKeyUrl: 'https://dashboard.cohere.com/api-keys',
    requiresApiKey: true,
    requiresAzureFields: false,
    rigClientKind: 'cohere',
    backendReady: false,
  },
  {
    id: 'gemini',
    category: 'native',
    i18nKey: 'settings:ai.chat.provider.gemini',
    defaultBaseUrl: null,
    placeholderModel: 'gemini-1.5-pro',
    apiKeyUrl: 'https://aistudio.google.com/apikey',
    requiresApiKey: true,
    requiresAzureFields: false,
    rigClientKind: 'gemini',
    backendReady: false,
  },
  {
    id: 'huggingface',
    category: 'native',
    i18nKey: 'settings:ai.chat.provider.huggingface',
    defaultBaseUrl: null,
    placeholderModel: 'meta-llama/Meta-Llama-3-70B',
    apiKeyUrl: 'https://huggingface.co/settings/tokens',
    requiresApiKey: true,
    requiresAzureFields: false,
    rigClientKind: 'huggingface',
    backendReady: false,
  },
  {
    id: 'ollama',
    category: 'local',
    i18nKey: 'settings:ai.chat.provider.ollama',
    defaultBaseUrl: 'http://localhost:11434/v1',
    placeholderModel: 'llama3.2',
    apiKeyUrl: null,
    requiresApiKey: false,
    requiresAzureFields: false,
    rigClientKind: 'ollama',
    backendReady: false,
  },
  // ── 兼容 (compat escape hatches) ──────────────────────────────
  {
    id: 'openai-compatible',
    category: 'compat',
    i18nKey: 'settings:ai.chat.provider.openai-compatible',
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
    i18nKey: 'settings:ai.chat.provider.anthropic-compatible',
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
    i18nKey: 'settings:ai.chat.provider.deepseek',
    defaultBaseUrl: 'https://api.deepseek.com',
    placeholderModel: 'deepseek-chat',
    apiKeyUrl: 'https://platform.deepseek.com/api_keys',
    requiresApiKey: true,
    requiresAzureFields: false,
    rigClientKind: 'openai-compat',
    backendReady: true,
  },
  {
    id: 'eternalai',
    category: 'openai-family',
    i18nKey: 'settings:ai.chat.provider.eternalai',
    defaultBaseUrl: 'https://api.eternalai.org/v1',
    placeholderModel: 'llama-3.1-70b',
    apiKeyUrl: 'https://eternalai.org',
    requiresApiKey: true,
    requiresAzureFields: false,
    rigClientKind: 'openai-compat',
    backendReady: true,
  },
  {
    id: 'galadriel',
    category: 'openai-family',
    i18nKey: 'settings:ai.chat.provider.galadriel',
    defaultBaseUrl: 'https://api.galadriel.com/v1',
    placeholderModel: 'galadriel',
    apiKeyUrl: 'https://galadriel.ai',
    requiresApiKey: true,
    requiresAzureFields: false,
    rigClientKind: 'openai-compat',
    backendReady: true,
  },
  {
    id: 'groq',
    category: 'openai-family',
    i18nKey: 'settings:ai.chat.provider.groq',
    defaultBaseUrl: 'https://api.groq.com/openai/v1',
    placeholderModel: 'llama-3.3-70b-versatile',
    apiKeyUrl: 'https://console.groq.com/keys',
    requiresApiKey: true,
    requiresAzureFields: false,
    rigClientKind: 'openai-compat',
    backendReady: true,
  },
  {
    id: 'hyperbolic',
    category: 'openai-family',
    i18nKey: 'settings:ai.chat.provider.hyperbolic',
    defaultBaseUrl: 'https://api.hyperbolic.xyz/v1',
    placeholderModel: 'llama-3.3-70b',
    apiKeyUrl: 'https://hyperbolic.xyz/settings/keys',
    requiresApiKey: true,
    requiresAzureFields: false,
    rigClientKind: 'openai-compat',
    backendReady: true,
  },
  {
    id: 'mira',
    category: 'openai-family',
    i18nKey: 'settings:ai.chat.provider.mira',
    defaultBaseUrl: 'https://api.mira.network/v1',
    placeholderModel: 'Mira-3',
    apiKeyUrl: 'https://mira.network',
    requiresApiKey: true,
    requiresAzureFields: false,
    rigClientKind: 'openai-compat',
    backendReady: true,
  },
  {
    id: 'moonshot',
    category: 'openai-family',
    i18nKey: 'settings:ai.chat.provider.moonshot',
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
    i18nKey: 'settings:ai.chat.provider.openrouter',
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
    i18nKey: 'settings:ai.chat.provider.perplexity',
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
    i18nKey: 'settings:ai.chat.provider.together',
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
    i18nKey: 'settings:ai.chat.provider.xai',
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
