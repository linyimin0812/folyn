/**
 * Provider catalog — thin wrapper over `providers.json`. Holds only the
 * UI/routing fields providers.json doesn't carry (i18n key, category,
 * placeholder model, rig routing hint, backend readiness flag).
 *
 * baseUrl / apiKeyUrl / requiresApiKey / requiresAzureFields are derived
 * on the fly from providers.json via `providersCatalog.ts` — see the
 * `provider*` helpers below. Compat escape-hatches (`openai-compatible`,
 * `anthropic-compatible`) have no providers.json entry; helpers return null
 * / true / false defaults which match the prior hardcoded values.
 *
 * ponytail: catalog IDs (chatProvider state, Rust routing, i18n keys,
 * persisted user state) are the source of truth — providers.json IDs are
 * aliased in `CATALOG_TO_JSON_ID` where they diverge (azure-openai→azure,
 * gemini→google, moonshot→moonshotai, together→togetherai). Don't migrate
 * catalog IDs without coordinating Rust + i18n + persisted state.
 *
 * The Rust side (`apps/desktop/src-tauri/src/chat.rs`) routes by provider
 * id via a 20-arm `match`. `rigClientKind` is mirrored in Rust as a
 * routing hint; do not duplicate other fields there.
 */

import {
  getProviderApiKeyUrl,
  getProviderApiBaseUrl,
  getProviderRequiresApiKey,
  getProviderRequiresAzureFields,
} from './providersCatalog';
import type {
  CustomProviderDef,
} from './providerConfigStorage';

export type ProviderCategory =
  | 'native'
  | 'compat'
  | 'openai-family'
  | 'local';

/**
 * User-defined provider entry. On-disk shape lives at
 * `~/.quill/providers/customer/providers.json` (see providerConfigStorage).
 * `adapterFamily` is the routing signal: when the user invokes chat /
 * list-models, the frontend passes `adapterFamily` to the Rust side, which
 * dispatches by the bundled id (anthropic / openai-completions / ollama /
 * gemini / openai) and applies `baseUrl` + `apiKey` from `settings.json`.
 *
 * ponytail: `baseUrl` and `apiKey` no longer live on the definition — they
 * moved to `~/.quill/providers/settings.json`. The catalog type only carries
 * what's intrinsic to the provider (id / display name / family / metadata).
 */
export type CustomProvider = CustomProviderDef;

export type ProviderEntry = ProviderCatalogEntry | CustomProvider;

export function isCustomProvider(e: ProviderEntry): e is CustomProvider {
  return 'adapterFamily' in e;
}

export function providerId(e: ProviderEntry): string {
  return e.id;
}

export function providerDisplayName(e: ProviderEntry, t: (k: string) => string): string {
  return isCustomProvider(e) ? e.name : t(e.i18nKey);
}

/** First-char avatar label. */
export function providerAvatarChar(e: ProviderEntry, t: (k: string) => string): string {
  const name = providerDisplayName(e, t).trim();
  return name.charAt(0).toUpperCase() || '?';
}

export function providerCategory(e: ProviderEntry): ProviderCategory | string {
  // ponytail: Phase 3 — custom's adapterFamily is a bundled id (string),
  // same value space as `provider` for bundled entries. Returned type widens
  // to `ProviderCategory | string` since adapterFamily isn't `ProviderCategory`.
  return isCustomProvider(e) ? e.adapterFamily : e.category;
}

/** Returns the bundled-catalog baseUrl for native providers. Custom providers
 *  no longer carry baseUrl here — it lives in `settings.json`; callers should
 *  read from `providerConfigStorage.getProviderSettings()` instead. */
export function providerBaseUrl(e: ProviderEntry): string | null {
  if (isCustomProvider(e)) return null;
  return getProviderApiBaseUrl(e.id);
}

export function providerApiKeyUrl(e: ProviderEntry): string | null {
  if (isCustomProvider(e)) return e.metadata?.website?.apiKey ?? null;
  return getProviderApiKeyUrl(e.id);
}

export function providerRequiresApiKey(e: ProviderEntry): boolean {
  if (isCustomProvider(e)) return true;
  return getProviderRequiresApiKey(e.id);
}

export function providerRequiresAzureFields(e: ProviderEntry): boolean {
  if (isCustomProvider(e)) return false;
  return getProviderRequiresAzureFields(e.id);
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
  /** Placeholder text for the model input. */
  placeholderModel: string;
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
  { id: 'anthropic',           category: 'native',        i18nKey: 'settings:models.provider.anthropic',           placeholderModel: 'claude-sonnet-4-6',                            rigClientKind: 'anthropic',    backendReady: true },
  { id: 'openai',              category: 'native',        i18nKey: 'settings:models.provider.openai',              placeholderModel: 'gpt-5.2',                                     rigClientKind: 'openai',       backendReady: true },
  { id: 'azure-openai',        category: 'native',        i18nKey: 'settings:models.provider.azure-openai',        placeholderModel: 'gpt-4o',                                      rigClientKind: 'azure',        backendReady: true },
  { id: 'cohere',              category: 'native',        i18nKey: 'settings:models.provider.cohere',             placeholderModel: 'command-r-plus',                              rigClientKind: 'cohere',       backendReady: true },
  { id: 'gemini',              category: 'native',        i18nKey: 'settings:models.provider.gemini',              placeholderModel: 'gemini-1.5-pro',                              rigClientKind: 'gemini',       backendReady: true },
  { id: 'huggingface',         category: 'native',        i18nKey: 'settings:models.provider.huggingface',         placeholderModel: 'meta-llama/Meta-Llama-3-70B',                 rigClientKind: 'huggingface',  backendReady: true },
  { id: 'ollama',              category: 'local',        i18nKey: 'settings:models.provider.ollama',              placeholderModel: 'llama3.2',                                    rigClientKind: 'ollama',       backendReady: true },
  // ── 兼容 (compat escape hatches) ──────────────────────────────
  { id: 'openai-compatible',   category: 'compat',        i18nKey: 'settings:models.provider.openai-compatible',   placeholderModel: 'gpt-4o-mini',                                 rigClientKind: 'openai-compat', backendReady: true },
  { id: 'anthropic-compatible',category: 'compat',        i18nKey: 'settings:models.provider.anthropic-compatible',placeholderModel: 'claude-sonnet-4-6',                            rigClientKind: 'anthropic',    backendReady: true },
  // ── OpenAI 兼容家族 (openai-family) ───────────────────────────
  { id: 'deepseek',            category: 'openai-family', i18nKey: 'settings:models.provider.deepseek',            placeholderModel: 'deepseek-chat',                               rigClientKind: 'openai-compat', backendReady: true },
  { id: 'groq',                category: 'openai-family', i18nKey: 'settings:models.provider.groq',                placeholderModel: 'llama-3.3-70b-versatile',                      rigClientKind: 'openai-compat', backendReady: true },
  { id: 'moonshot',            category: 'openai-family', i18nKey: 'settings:models.provider.moonshot',            placeholderModel: 'moonshot-v1-8k',                              rigClientKind: 'openai-compat', backendReady: true },
  { id: 'openrouter',          category: 'openai-family', i18nKey: 'settings:models.provider.openrouter',          placeholderModel: 'anthropic/claude-3.5-sonnet',                 rigClientKind: 'openai-compat', backendReady: true },
  { id: 'perplexity',          category: 'openai-family', i18nKey: 'settings:models.provider.perplexity',          placeholderModel: 'sonar-pro',                                   rigClientKind: 'openai-compat', backendReady: true },
  { id: 'together',            category: 'openai-family', i18nKey: 'settings:models.provider.together',            placeholderModel: 'meta-llama/Meta-Llama-3.1-70B-Instruct-Turbo', rigClientKind: 'openai-compat', backendReady: true },
  { id: 'xai',                 category: 'openai-family', i18nKey: 'settings:models.provider.xai',                 placeholderModel: 'grok-2',                                       rigClientKind: 'openai-compat', backendReady: true },
];

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
 * Lookup by id, including custom providers. `customProviders` is a Record
 * keyed by id (matches the on-disk shape in customer/providers.json and
 * the in-memory shape in aiConfigStore). Returns undefined if neither
 * catalog nor custom matches.
 */
export function getProviderEntryIncludingCustom(
  id: string,
  customProviders: Readonly<Record<string, CustomProvider>>,
): ProviderEntry | undefined {
  const catalogEntry = PROVIDER_CATALOG.find((p) => p.id === id);
  if (catalogEntry) return catalogEntry;
  return customProviders[id];
}

/**
 * All providers: catalog ids in declared order, then custom providers in
 * Record-iteration order. Display sort is applied by the consumer
 * (enabled-first, then alphabetical).
 */
export function allProviders(
  customProviders: Readonly<Record<string, CustomProvider>>,
): ProviderEntry[] {
  const out: ProviderEntry[] = [];
  for (const e of PROVIDER_CATALOG) out.push(e);
  for (const c of Object.values(customProviders)) out.push(c);
  return out;
}
