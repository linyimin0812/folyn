/**
 * 模型服务 settings tab — cherry-studio-style 2-column layout:
 *   left  = search + filter + provider list (enabled-first, then alpha) + add-custom
 *   right = active provider detail (enable toggle + api key + base url +
 *           azure fields + thinking budget + model list + test + refetch-all)
 *
 * Reads aiConfigStore (customProviders / enabledProviders /
 * per-provider config slots) + modelRegistryStore (cached model lists +
 * fetch status). All chat/model/fetch/test plumbing is reused as-is — this
 * file only restructures the UI.
 *
 * ponytail: provider list is ~20-30 items, no virtualization. Custom
 * providers route through chat.rs `_` fallback arm (OpenAI-compat) — no
 * backend changes needed.
 */

import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAiConfigStore, type ChatProvider } from '@/store/aiConfigStore';
import { testChatConnection } from '@/services/rigChat';
import {
  PROVIDER_CATALOG,
  allProviders,
  getProviderEntryIncludingCustom,
  isCustomProvider,
  providerApiKeyUrl,
  providerAvatarChar,
  providerBaseUrl,
  providerDisplayName,
  providerPlaceholderModel,
  providerRequiresApiKey,
  providerRequiresAzureFields,
  type DefaultChatEndpoint,
  type ProviderEntry,
  type CustomProvider,
} from '@/services/providers/catalog';
import { refetchAllFromModelsDev } from '@/services/modelRegistry/userProvidersCatalog';
import { useModelRegistryStore, canFetchModelsFromStore } from '@/store/modelRegistryStore';
import type { Capability, Model } from '@/services/modelRegistry/types';
import { Toggle } from './primitives';
import { providerIconUrl } from '@/services/providers/icon';
import {
  getProviderApiPath,
  getProviderDocsUrl,
  getProviderModelsUrl,
  buildPreviewUrl,
} from '@/services/providers/providersCatalog';
import { SquarePen, Trash2, Plus, ListRestart, Loader2, Check, Eye, Brain, Search, Wrench, type LucideIcon } from 'lucide-react';

// ponytail: model row hover tooltip shows pricing when available.
function modelOptionTitle(m: Model): string {
  const inPrice = m.pricing?.inputPerMtok;
  const outPrice = m.pricing?.outputPerMtok;
  if (inPrice === undefined && outPrice === undefined) return '';
  return `Input: $${inPrice ?? '—'} / Output: $${outPrice ?? '—'} per million tokens`;
}

/**
 * ponytail: family-grouping heuristic — covers common id shapes
 * (claude-opus-4-7 → "Claude 4.7", gpt-5.2 → "Gpt 5.2", gemini-3.5 →
 * "Gemini 3.5"). Misgroups edge cases like "gpt-image-2" (→ "Gpt 2") and
 * "deepseek-v4-flash" (falls through to id). Acceptable until a
 * provider's naming needs special-casing. For relay providers (id
 * contains "/"), groups by upstream-provider prefix.
 */
function familyGroup(id: string): string {
  if (id.includes('/')) {
    const p = id.split('/')[0];
    return p.charAt(0).toUpperCase() + p.slice(1);
  }
  const m = id.match(/^([a-z]+)-(?:[a-z]+-)*?(\d+)(?:[-.](\d+))?/);
  if (m) {
    const brand = m[1].charAt(0).toUpperCase() + m[1].slice(1);
    return m[3] ? `${brand} ${m[2]}.${m[3]}` : `${brand} ${m[2]}`;
  }
  return id;
}

const EMPTY_MODELS: Model[] = [];
const EMPTY_MANUAL: readonly { id: string; displayName: string; group: string; createdAt: number }[] = [];
const EMPTY_SELECTED: readonly string[] = [];

/** Deterministic color from id — used for the avatar background. */
function avatarColor(id: string): string {
  // ponytail: 8 hand-picked colors; hash picks one. Catalog ids map to
  // stable colors so the same provider keeps the same avatar across reloads.
  const colors = ['#3a6ef0', '#6a3af0', '#0a8ab8', '#8040d0', '#cc44cc', '#22a863', '#f5a623', '#e0484d'];
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return colors[Math.abs(h) % colors.length];
}

function ModelAvatar({ id }: { id: string }) {
  const char = (id[0] ?? '?').toUpperCase();
  return (
    <span
      className="shrink-0 inline-flex items-center justify-center rounded-full text-white text-[11px] font-bold"
      style={{ width: 24, height: 24, background: avatarColor(id) }}
    >
      {char}
    </span>
  );
}

// ponytail: capability → colored pill per HTML design. 4 mapped, 1
// (structured-output) skipped — no pill in the reference design. Uses
// lucide-react icons instead of raw SVG paths — React's dev-mode path
// validator rejects several of the original hand-written paths.
const CAPABILITY_PILL: Record<string, { title: string; bg: string; color: string; Icon: LucideIcon }> = {
  vision: { title: 'vision', bg: '#e6f7ed', color: '#10b981', Icon: Eye },
  reasoning: { title: 'reasoning', bg: '#f0f3ff', color: '#6366f1', Icon: Brain },
  'web-search': { title: 'web', bg: '#e0f2fe', color: '#3b82f6', Icon: Search },
  'function-call': { title: 'tools', bg: '#fff7ed', color: '#f97316', Icon: Wrench },
};

function CapabilityPills({ capabilities }: { capabilities: readonly string[] }) {
  if (capabilities.length === 0) return null;
  return (
    <span className="flex items-center gap-1.5 shrink-0">
      {capabilities.map((c) => {
        const pill = CAPABILITY_PILL[c];
        if (!pill) return null;
        return (
          <span
            key={c}
            title={pill.title}
            className="inline-flex items-center justify-center rounded-[10px]"
            style={{ width: 32, height: 20, background: pill.bg, color: pill.color }}
          >
            <pill.Icon size={12} />
          </span>
        );
      })}
    </span>
  );
}

function Avatar({ entry, t }: { entry: ProviderEntry; t: (k: string) => string }) {
  const icon = providerIconUrl(entry.id);
  const [imgError, setImgError] = useState(false);
  if (icon && !imgError) {
    return (
      <img
        src={icon}
        alt=""
        onError={() => setImgError(true)}
        className="shrink-0"
        style={{ width: 16, height: 16, objectFit: 'contain' }}
      />
    );
  }
  const char = providerAvatarChar(entry, t);
  const color = avatarColor(entry.id);
  return (
    <span
      className="shrink-0 inline-flex items-center justify-center rounded-full text-white text-[11px] font-bold"
      style={{ width: 16, height: 16, background: color }}
    >
      {char}
    </span>
  );
}

type DrawerState =
  | { mode: 'add' }
  | { mode: 'edit'; id: string };

export function ModelServicesSettings() {
  const { t } = useTranslation();

  // ── store reads ─────────────────────────────────────────────
  const chatProvider = useAiConfigStore((s) => s.chatProvider);
  const chatModel = useAiConfigStore((s) => s.chatModel);
  const chatApiKey = useAiConfigStore((s) => s.chatApiKey);
  const chatBaseUrl = useAiConfigStore((s) => s.chatBaseUrl);
  const chatAzureDeploymentId = useAiConfigStore((s) => s.chatAzureDeploymentId);
  const chatAzureApiVersion = useAiConfigStore((s) => s.chatAzureApiVersion);
  const setChatProvider = useAiConfigStore((s) => s.setChatProvider);
  const setChatModel = useAiConfigStore((s) => s.setChatModel);
  const setChatApiKey = useAiConfigStore((s) => s.setChatApiKey);
  const setChatBaseUrl = useAiConfigStore((s) => s.setChatBaseUrl);
  const setChatAzureApiVersion = useAiConfigStore((s) => s.setChatAzureApiVersion);

  const customerProviders = useAiConfigStore((s) => s.customerProviders);
  const providerSettings = useAiConfigStore((s) => s.providerSettings);
  const manualModelsMap = useAiConfigStore((s) => s.manualModels);
  const addManualModel = useAiConfigStore((s) => s.addManualModel);
  const removeManualModel = useAiConfigStore((s) => s.removeManualModel);
  const addSelectedModelId = useAiConfigStore((s) => s.addSelectedModelId);
  const removeSelectedModelId = useAiConfigStore((s) => s.removeSelectedModelId);
  const addCustomProvider = useAiConfigStore((s) => s.addCustomProvider);
  const updateCustomProvider = useAiConfigStore((s) => s.updateCustomProvider);
  const removeCustomProvider = useAiConfigStore((s) => s.removeCustomProvider);
  const setProviderEnabled = useAiConfigStore((s) => s.setProviderEnabled);

  // ── model registry reads ────────────────────────────────────
  const fetchedModels = useModelRegistryStore((s) => s.modelsByProvider[chatProvider] ?? EMPTY_MODELS);
  const manualForCurrent = manualModelsMap[chatProvider] ?? EMPTY_MANUAL;
  const modelsForCurrent = useMemo(() => {
    if (manualForCurrent.length === 0) return fetchedModels;
    const existingIds = new Set(fetchedModels.map((m) => m.id));
    const manual: Model[] = manualForCurrent.map((m) => ({
      id: m.id,
      providerId: chatProvider,
      capabilities: [],
      inputModalities: [],
      displayName: m.displayName,
      group: m.group,
    }));
    return [...fetchedModels, ...manual.filter((m) => !existingIds.has(m.id))];
  }, [fetchedModels, manualForCurrent, chatProvider]);
  const fetchStatusForCurrent = useModelRegistryStore((s) => s.fetchStatusByProvider[chatProvider] ?? 'idle');
  const fetchErrorForCurrent = useModelRegistryStore((s) => s.fetchErrorByProvider[chatProvider] ?? null);
  const fetchModelsForProvider = useModelRegistryStore((s) => s.fetchModelsForProvider);

  // ── local UI state ──────────────────────────────────────────
  const [search, setSearch] = useState('');
  const [refetchStatus, setRefetchStatus] = useState<
    | { kind: 'idle' }
    | { kind: 'loading' }
    | { kind: 'ok' }
    | { kind: 'err'; message: string }
  >({ kind: 'idle' });
  const [drawer, setDrawer] = useState<DrawerState | null>(null);
  const [chatTestStatus, setChatTestStatus] = useState<{ testing: boolean; result?: { success: boolean; message: string } }>({ testing: false });
  const [testModalOpen, setTestModalOpen] = useState(false);
  const [testModelId, setTestModelId] = useState<string>('');
  const [showChatKey, setShowChatKey] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [manualModalOpen, setManualModalOpen] = useState(false);
  const [manualCollapsed, setManualCollapsed] = useState<Set<string>>(new Set());
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const pendingDeleteProvider = useMemo(
    () => customerProviders[deleteConfirmId ?? ''] ?? null,
    [customerProviders, deleteConfirmId],
  );

  const selectedModelIds = providerSettings[chatProvider]?.selectedModelIds ?? EMPTY_SELECTED;

  // ── derived ─────────────────────────────────────────────────
  const providers = useMemo(
    () => allProviders(customerProviders),
    [customerProviders],
  );
  const filtered = useMemo(() => {
    // ponytail: hidden catalog escape-hatch ids — superseded by custom
    // providers with the appropriate type. Drop from the list.
    const HIDDEN = new Set(['openai-compatible', 'anthropic-compatible']);
    const q = search.trim().toLowerCase();
    const matched = providers.filter((p) => {
      if (HIDDEN.has(p.id)) return false;
      if (!q) return true;
      return (
        providerDisplayName(p, t).toLowerCase().includes(q)
        || p.id.toLowerCase().includes(q)
      );
    });
    // ponytail: enabled first, then alphabetical by display name.
    const nameOf = (p: ProviderEntry) => providerDisplayName(p, t).toLowerCase();
    return [...matched].sort((a, b) => {
      const ae = providerSettings[a.id]?.enabled === true ? 0 : 1;
      const be = providerSettings[b.id]?.enabled === true ? 0 : 1;
      if (ae !== be) return ae - be;
      return nameOf(a).localeCompare(nameOf(b));
    });
  }, [providers, search, t, providerSettings]);

  const entry: ProviderEntry = getProviderEntryIncludingCustom(chatProvider, customerProviders) ?? PROVIDER_CATALOG[0];
  const requiresApiKey = providerRequiresApiKey(entry);
  const requiresAzureFields = providerRequiresAzureFields(entry);
  const apiKeyUrl = providerApiKeyUrl(entry);
  const providersJsonBaseUrl = providerBaseUrl(entry);
  const providersJsonPath = getProviderApiPath(entry.id);
  const docsUrl = getProviderDocsUrl(entry.id);
  const modelsUrl = getProviderModelsUrl(entry.id);
  const placeholderModel = providerPlaceholderModel(entry);
  const isCustom = isCustomProvider(entry);
  const entryEnabled = providerSettings[entry.id]?.enabled === true;

  return (
    <div className="h-full flex flex-col">
      <div className="pb-3 mb-3 border-b border-brd2 flex items-baseline gap-2 shrink-0">
        <div className="text-[length:calc(var(--ui-font-size)+3px)] font-bold text-t1 tracking-[-0.01em]">{t('settings:models.title')}</div>
        <div className="text-[length:calc(var(--ui-font-size)-1px)] text-t3">{t('settings:models.description')}</div>
      </div>

      <div className="flex flex-row gap-4 flex-1 min-h-0">
        {/* ── Left: provider list ─────────────────────────────── */}
        <aside className="w-[300px] shrink-0 flex flex-col border border-brd rounded-md bg-panel overflow-hidden">
          <div className="p-2 border-b border-brd">
            <div className="relative flex items-center">
              <input
                type="text"
                placeholder={t('settings:models.searchPlaceholder')}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="fi2 w-full h-[30px] py-1 pl-2.5 pr-8 rounded-md border border-brd bg-inp text-t1 text-[length:calc(var(--ui-font-size)-2px)] outline-none font-ui"
              />
              <button
                type="button"
                title={t('settings:models.refetchModelsDev')}
                disabled={refetchStatus.kind === 'loading'}
                onClick={async () => {
                  setRefetchStatus({ kind: 'loading' });
                  try {
                    await refetchAllFromModelsDev();
                    setRefetchStatus({ kind: 'ok' });
                  } catch (e) {
                    setRefetchStatus({ kind: 'err', message: (e as Error).message });
                  } finally {
                    setTimeout(() => setRefetchStatus({ kind: 'idle' }), 4000);
                  }
                }}
                className="absolute right-1 top-1/2 -translate-y-1/2 w-[22px] h-[22px] flex items-center justify-center rounded text-t3 hover:text-t1 hover:bg-hov disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                <ListRestart size={13} />
              </button>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto py-1.5 px-1.5 min-h-0 relative">
            {filtered.length === 0 ? (
              <div className="text-[10.5px] text-t3 italic px-2 py-3 text-center">{t('settings:models.searchPlaceholder')}</div>
            ) : (
              filtered.map((p) => {
                const isActive = p.id === chatProvider;
                const isEnabled = providerSettings[p.id]?.enabled === true;
                return (
                  <div
                    key={p.id}
                    className={`group flex items-center gap-1.5 h-[40px] px-1.5 py-1.5 rounded-md cursor-pointer transition-colors duration-100 ${isActive ? 'bg-accdim' : 'hover:bg-hov'}`}
                    onClick={() => setChatProvider(p.id as ChatProvider)}
                  >
                    <Avatar entry={p} t={t} />
                    <span className={`flex-1 truncate text-[length:calc(var(--ui-font-size)-2px)] font-ui ${isActive ? 'text-acc font-semibold' : 'text-t2'}`}>
                      {providerDisplayName(p, t)}
                    </span>
                    {isCustomProvider(p) && (
                      <button
                        type="button"
                        title={t('settings:models.editCustom')}
                        onClick={(e) => {
                          e.stopPropagation();
                          setDrawer({ mode: 'edit', id: p.id });
                        }}
                        className="opacity-0 group-hover:opacity-100 text-t3 hover:text-t1 transition-opacity"
                      >
                        <SquarePen size={11} />
                      </button>
                    )}
                    {isCustomProvider(p) && (
                      <button
                        type="button"
                        title={t('settings:models.deleteCustom')}
                        onClick={(e) => {
                          e.stopPropagation();
                          setDeleteConfirmId(p.id);
                        }}
                        className="opacity-0 group-hover:opacity-100 text-t3 hover:text-[#f06a6a] transition-opacity"
                      >
                        <Trash2 size={11} />
                      </button>
                    )}
                    {isEnabled && (
                      <span className="text-[9px] font-bold px-1.5 h-[16px] inline-flex items-center rounded-full text-white" style={{ background: 'var(--green, #22a863)' }}>
                        {t('settings:models.activeBadge')}
                      </span>
                    )}
                  </div>
                );
              })
            )}
          </div>
          <div className="p-2 border-t border-brd">
            <button
              type="button"
              onClick={() => setDrawer({ mode: 'add' })}
              className="w-full h-[28px] flex items-center justify-center gap-1 rounded-md text-[11px] font-ui border border-dashed border-brd2 text-t2 hover:border-acc hover:text-acc transition-colors duration-100 bg-transparent"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 12h14"></path>
                <path d="M12 5v14"></path>
              </svg>
              {t('settings:models.addCustom')}
            </button>
          </div>
        </aside>

        {/* ── Right: detail ───────────────────────────────────── */}
        <section className="flex-1 min-w-0 max-w-[640px] flex flex-col overflow-y-auto pr-1">
          <div className="flex items-center justify-between pb-2.5 mb-2 border-b border-brd2">
            <div className="flex items-center gap-2">
              <Avatar entry={entry} t={t} />
              <div className="text-[length:calc(var(--ui-font-size)+1px)] font-bold text-t1">{providerDisplayName(entry, t)}</div>
              {entryEnabled && (
                <span
                  className="text-[9px] font-bold px-1.5 h-[16px] inline-flex items-center rounded-full text-white"
                  style={{ background: 'var(--green, #22a863)' }}
                  title="ON"
                >
                  ON
                </span>
              )}
              {entry.id === chatProvider && (
                <span className="text-[9px] font-bold px-1.5 h-[16px] inline-flex items-center rounded-full text-white" style={{ background: 'var(--acc)' }}>
                  chat
                </span>
              )}
            </div>
            <Toggle
              value={entryEnabled}
              onChange={(v) => setProviderEnabled(entry.id, v)}
            />
          </div>

          {/* API Key */}
          {requiresApiKey && (
            <div className="mb-3.5">
              <div className="text-[length:calc(var(--ui-font-size)-2.5px)] font-semibold text-t2 mb-[5px]">{t('settings:models.apiKey.label')}</div>
              <div className="flex">
                <div className="relative flex-1">
                  <input
                    type={showChatKey ? 'text' : 'password'}
                    className="fi2 w-full py-[7px] px-2.5 pr-[34px] rounded-l-md border border-r-0 border-brd bg-inp text-t1 text-[length:calc(var(--ui-font-size)-2px)] outline-none font-ui"
                    value={chatApiKey}
                    onChange={(e) => setChatApiKey(e.target.value)}
                    placeholder="sk-…"
                    autoCapitalize="off"
                    autoComplete="off"
                  />
                  <button
                    type="button"
                    aria-label={showChatKey ? t('settings:models.apiKey.hide') : t('settings:models.apiKey.show')}
                    title={showChatKey ? t('settings:models.apiKey.hide') : t('settings:models.apiKey.show')}
                    className="absolute right-1 top-1/2 -translate-y-1/2 w-[26px] h-[26px] flex items-center justify-center rounded bg-transparent border-none text-t3 cursor-pointer hover:bg-hov hover:text-t1"
                    onClick={() => setShowChatKey((v) => !v)}
                  >
                    {showChatKey ? (
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                        <line x1="1" y1="1" x2="23" y2="23" />
                      </svg>
                    ) : (
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8z" />
                        <circle cx="12" cy="12" r="3" />
                      </svg>
                    )}
                  </button>
                </div>
                <button
                  className="shrink-0 px-3 rounded-r-md border border-brd text-white text-[length:calc(var(--ui-font-size)-2px)] font-ui transition-opacity hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
                  style={{ background: 'var(--acc, #3a6ef0)' }}
                  disabled={chatTestStatus.testing || !chatApiKey || (!PROVIDER_CATALOG.some((p) => p.id === chatProvider) && !isCustom) || selectedModelIds.length === 0}
                  onClick={() => {
                    setTestModelId(chatModel || (selectedModelIds[0] ?? ''));
                    setChatTestStatus({ testing: false });
                    setTestModalOpen(true);
                  }}
                >
                  {chatTestStatus.testing ? t('settings:models.test.testing') : t('settings:models.test.label')}
                </button>
              </div>
              {apiKeyUrl && (
                <a
                  href={apiKeyUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[10.5px] text-acc hover:underline mt-1 inline-block"
                >
                  {t('settings:models.apiKey.getKey')}
                </a>
              )}
            </div>
          )}

          {/* Base URL */}
          <div className="mb-3.5">
            <div className="text-[length:calc(var(--ui-font-size)-2.5px)] font-semibold text-t2 mb-[5px]">{t('settings:models.baseUrl.label')}</div>
            <div className="flex">
              <input
                className={`fi2 flex-1 py-[7px] px-2.5 border border-brd bg-inp text-t1 text-[length:calc(var(--ui-font-size)-2px)] outline-none font-ui ${!isCustom && providersJsonBaseUrl && chatBaseUrl !== '' ? 'rounded-l-md border-r-0' : 'rounded-md'}`}
                value={chatBaseUrl}
                onChange={(e) => setChatBaseUrl(e.target.value)}
                placeholder={providersJsonBaseUrl ?? t('settings:models.baseUrl.placeholder')}
                autoCapitalize="off"
              />
              {!isCustom && providersJsonBaseUrl && chatBaseUrl !== '' && (
                <button
                  type="button"
                  onClick={() => setChatBaseUrl('')}
                  className="shrink-0 px-3 rounded-r-md border border-brd text-white text-[length:calc(var(--ui-font-size)-2px)] font-ui transition-opacity hover:opacity-90"
                  style={{ background: 'var(--red, #f06a6a)' }}
                >
                  {t('settings:models.baseUrl.reset')}
                </button>
              )}
            </div>
            {(() => {
              const base = chatBaseUrl || providersJsonBaseUrl;
              if (!base || !providersJsonPath) return null;
              return (
                <div className="text-[10.5px] text-t3 mt-1 break-all">
                  {t('settings:models.preview', { url: buildPreviewUrl(base, providersJsonPath) })}
                </div>
              );
            })()}
          </div>

          {/* Azure fields */}
          {requiresAzureFields && (
            <div className="mb-3.5">
              <div className="text-[length:calc(var(--ui-font-size)-2.5px)] font-semibold text-t2 mb-[5px]">{t('settings:models.azure.apiVersion.label')}</div>
              <input
                className="fi2 w-full py-[7px] px-2.5 rounded-md border border-brd bg-inp text-t1 text-[length:calc(var(--ui-font-size)-2px)] outline-none font-ui"
                value={chatAzureApiVersion}
                onChange={(e) => setChatAzureApiVersion(e.target.value)}
                placeholder="2024-10-21"
                autoCapitalize="off"
              />
            </div>
          )}

          {/* Model list */}
          <div className="mb-3.5">
            {/* Top toolbar — per HTML design */}
            <div className="flex items-center justify-between py-2 mb-2">
              <div className="flex items-center gap-3">
                <span className="text-[length:calc(var(--ui-font-size)-2.5px)] font-semibold text-t2">{t('settings:models.model.label')}</span>
                {manualForCurrent.length > 0 && (
                  <span className="px-2 py-0.5 text-xs font-semibold text-acc bg-accdim rounded-full">
                    {manualForCurrent.length}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className="btn btn-g btn-sm disabled:opacity-50 disabled:cursor-not-allowed"
                  onClick={() => setPickerOpen(true)}
                  disabled={!canFetchModelsFromStore(entry, chatApiKey)}
                >
                  {fetchStatusForCurrent === 'loading' ? t('settings:models.fetchModels.fetching') : t('settings:models.fetchModels.label')}
                </button>
                <button
                  type="button"
                  className="btn btn-g btn-sm"
                  onClick={() => setManualModalOpen(true)}
                  title={t('settings:models.addManual.title')}
                >
                  <Plus size={14} />
                </button>
              </div>
            </div>

            {/* Selected models list — ids the user picked via the model picker, grouped to mirror the picker. */}
            {selectedModelIds.length > 0 && (() => {
              // ponytail: group by m?.group ?? familyGroup(mid); ids without a fetched Model fall back to familyGroup.
              const groups = (() => {
                const map = new Map<string, string[]>();
                for (const mid of selectedModelIds) {
                  const m = modelsForCurrent.find((x) => x.id === mid);
                  const g = m?.group ?? familyGroup(mid);
                  const arr = map.get(g) ?? [];
                  arr.push(mid);
                  map.set(g, arr);
                }
                return Array.from(map.entries()).map(([name, items]) => ({ name, items }));
              })();
              return (
                <div className="mt-2 flex flex-col gap-2">
                  {groups.map((g) => {
                    const key = `__selectedModels__${g.name}`;
                    const isCollapsed = manualCollapsed.has(key);
                    return (
                      <div key={g.name} className="bg-white border border-gray-200 rounded-xl overflow-hidden">
                        <div
                          className="flex items-center justify-between px-4 py-2 bg-gray-50/80 border-b border-gray-100 select-none cursor-pointer hover:bg-gray-100/80 transition-colors"
                          onClick={() => setManualCollapsed((prev) => {
                            const next = new Set(prev);
                            if (next.has(key)) next.delete(key);
                            else next.add(key);
                            return next;
                          })}
                        >
                          <div className="flex items-center gap-2">
                            <svg
                              className={`text-gray-400 transition-transform ${isCollapsed ? '' : 'rotate-180'}`}
                              width="12"
                              height="12"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2.5"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            >
                              <polyline points="6 9 12 15 18 9" />
                            </svg>
                            <span className="font-bold text-[length:calc(var(--ui-font-size)-2.5px)] font-ui text-gray-800">{g.name}</span>
                            <span className="text-[10.5px] text-gray-400">{g.items.length}</span>
                          </div>
                        </div>
                        {!isCollapsed && (
                          <div className="bg-white">
                            {g.items.map((mid, idx) => {
                              const isSelected = mid === chatModel;
                              const m = modelsForCurrent.find((x) => x.id === mid);
                              return (
                                <div
                                  key={mid}
                                  className={`flex items-center justify-between px-4 py-2.5 hover:bg-gray-50/50 transition-colors cursor-pointer ${
                                    idx < g.items.length - 1 ? 'border-b border-gray-100' : ''
                                  }`}
                                  onClick={() => setChatModel(mid)}
                                >
                                  <div className="flex items-center gap-3 min-w-0">
                                    <ModelAvatar id={mid} />
                                    <span className={`font-semibold text-[length:calc(var(--ui-font-size)-2px)] font-ui truncate ${isSelected ? 'text-emerald-600' : 'text-gray-800'}`}>
                                      {m?.displayName ?? mid}
                                    </span>
                                  </div>
                                  <div className="flex items-center gap-[18px] shrink-0">
                                    <CapabilityPills capabilities={m?.capabilities ?? []} />
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        removeSelectedModelId(chatProvider, mid);
                                      }}
                                      title={t('settings:models.picker.remove')}
                                      className="text-emerald-600 hover:text-emerald-700 transition-colors"
                                    >
                                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                        <line x1="5" y1="12" x2="19" y2="12" />
                                      </svg>
                                    </button>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })()}

            {/* Manual-added models list — grouped, collapsible, removable. Hidden when chatModel already covers the only manual model. */}
            {manualForCurrent.length > 0 && (() => {
              const groups = (() => {
                const map = new Map<string, typeof manualForCurrent>();
                for (const m of manualForCurrent) {
                  const g = m.group ?? familyGroup(m.id);
                  const arr = map.get(g) ?? [];
                  arr.push(m);
                  map.set(g, arr);
                }
                return Array.from(map.entries()).map(([name, items]) => ({ name, items }));
              })();
              return (
                <div className="mt-2 flex flex-col gap-2">
                  {groups.map((g) => {
                    const isCollapsed = manualCollapsed.has(g.name);
                    return (
                      <div key={g.name} className="bg-white border border-gray-200 rounded-xl overflow-hidden">
                        <div
                          className="flex items-center justify-between px-4 py-2 bg-gray-50/80 border-b border-gray-100 select-none cursor-pointer hover:bg-gray-100/80 transition-colors"
                          onClick={() => setManualCollapsed((prev) => {
                            const next = new Set(prev);
                            if (next.has(g.name)) next.delete(g.name);
                            else next.add(g.name);
                            return next;
                          })}
                        >
                          <div className="flex items-center gap-2">
                            <svg
                              className={`text-gray-400 transition-transform ${isCollapsed ? '' : 'rotate-180'}`}
                              width="12"
                              height="12"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2.5"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            >
                              <polyline points="6 9 12 15 18 9" />
                            </svg>
                            <span className="font-bold text-[length:calc(var(--ui-font-size)-2.5px)] font-ui text-gray-800">{g.name}</span>
                            <span className="text-[10.5px] text-gray-400">{g.items.length}</span>
                          </div>
                        </div>
                        {!isCollapsed && (
                          <div className="bg-white">
                            {g.items.map((m, idx) => {
                              const isSelected = m.id === chatModel;
                              return (
                                <div
                                  key={m.id}
                                  className={`flex items-center justify-between px-4 py-2.5 hover:bg-gray-50/50 transition-colors cursor-pointer ${
                                    idx < g.items.length - 1 ? 'border-b border-gray-100' : ''
                                  }`}
                                  onClick={() => setChatModel(m.id)}
                                >
                                  <div className="flex items-center gap-3 min-w-0">
                                    <ModelAvatar id={m.id} />
                                    <span className={`font-semibold text-[length:calc(var(--ui-font-size)-2px)] font-ui truncate ${isSelected ? 'text-emerald-600' : 'text-gray-800'}`}>
                                      {m.displayName ?? m.id}
                                    </span>
                                  </div>
                                  <div className="flex items-center gap-[18px] shrink-0">
                                    <button
                                      type="button"
                                      title={t('settings:models.picker.remove')}
                                      className="text-emerald-600 hover:text-emerald-700 transition-colors"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        removeManualModel(chatProvider, m.id);
                                      }}
                                    >
                                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                        <line x1="5" y1="12" x2="19" y2="12" />
                                      </svg>
                                    </button>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })()}
            
            {fetchStatusForCurrent === 'success' && modelsForCurrent.length === 0 && (
              <div className="text-[10.5px] mt-1 text-t3">{t('settings:models.fetchModels.empty')}</div>
            )}
          </div>

          {/* Info links — docs + models from providers.json metadata */}
          {(docsUrl || modelsUrl) && (
            <div className="mt-1 text-[11px] text-t3 flex flex-wrap items-center gap-x-1 gap-y-1">
              <span>{t('settings:models.infoLinks.prefix')}</span>
              {docsUrl && (
                <>
                  <a href={docsUrl} target="_blank" rel="noopener noreferrer" className="text-acc hover:underline">
                      {t('settings:models.infoLinks.docs')}
                  </a>
                  {modelsUrl && <span>{t('settings:models.infoLinks.and')}</span>}
                </>
              )}
              {modelsUrl && (
                <a href={modelsUrl} target="_blank" rel="noopener noreferrer" className="text-acc hover:underline">
                  {t('settings:models.infoLinks.models')}
                </a>
              )}
              <span>{t('settings:models.infoLinks.suffix')}</span>
            </div>
          )}

          {/* Set as chat provider button (only when current entry isn't the chatProvider) */}
          {entry.id !== chatProvider && (
            <div className="mt-3 pt-3 border-t border-brd2">
              <button
                type="button"
                className="btn btn-g btn-sm w-full"
                onClick={() => setChatProvider(entry.id as ChatProvider)}
              >
                {t('settings:models.setAsChat')}
              </button>
            </div>
          )}
        </section>
      </div>

      {drawer && (
        <CustomProviderDrawer
          state={drawer}
          existingIds={Object.keys(customerProviders)}
          initial={
            drawer.mode === 'edit'
              ? customerProviders[drawer.id] ?? null
              : null
          }
          onClose={() => setDrawer(null)}
          onSave={(data) => {
            if (drawer.mode === 'add') {
              const id = addCustomProvider(data);
              setChatProvider(id as ChatProvider);
            } else {
              updateCustomProvider(drawer.id, data);
            }
            setDrawer(null);
          }}
        />
      )}

      {testModalOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center"
          onClick={() => !chatTestStatus.testing && setTestModalOpen(false)}
        >
          <div
            className="bg-panel border border-brd rounded-md w-[400px] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-4 pt-4 pb-2">
              <div className="text-[length:calc(var(--ui-font-size)+1px)] font-bold text-t1">
                {t('settings:models.test.label')}
              </div>
            </div>
            <div className="h-px bg-brd mx-4" />
            <div className="px-4 py-4 flex flex-col gap-3">
              <label className="flex flex-col gap-1">
                <span className="text-[length:calc(var(--ui-font-size)-2.5px)] font-semibold text-t2">
                  {t('settings:models.test.selectModel') || 'Select model'}
                </span>
                <select
                  className="fi2 h-[34px] py-[7px] px-2.5 rounded-md border border-brd bg-inp text-t1 text-[length:calc(var(--ui-font-size)-2px)] outline-none font-ui"
                  value={testModelId}
                  onChange={(e) => setTestModelId(e.target.value)}
                >
                  {selectedModelIds.map((mid) => (
                    <option key={mid} value={mid}>{mid}</option>
                  ))}
                </select>
              </label>
              {chatTestStatus.result && (
                <div style={{ fontSize: 11, color: chatTestStatus.result.success ? 'var(--green, #22a863)' : 'var(--red, #f06a6a)' }}>
                  {chatTestStatus.result.success ? '✓ ' : '✗ '}{chatTestStatus.result.message}
                </div>
              )}
            </div>
            <div className="h-px bg-brd mx-4" />
            <div className="flex justify-end gap-2 px-4 py-3">
              <button
                className="btn btn-g btn-sm"
                disabled={chatTestStatus.testing}
                onClick={() => setTestModalOpen(false)}
              >
                {t('settings:models.cancel')}
              </button>
              <button
                className="btn btn-p btn-sm"
                disabled={chatTestStatus.testing || !testModelId}
                onClick={async () => {
                  setChatTestStatus({ testing: true });
                  try {
                    // ponytail: custom providers route via chat.rs `_` fallback arm.
                    const result = await testChatConnection({
                      provider: chatProvider,
                      model: testModelId || placeholderModel,
                      apiKey: chatApiKey,
                      baseUrl: chatBaseUrl || undefined,
                      azureDeploymentId: chatAzureDeploymentId || undefined,
                      azureApiVersion: chatAzureApiVersion || undefined,
                      // PR2e: route custom providers via endpoint resolver.
                      customProvider: isCustom,
                      defaultChatEndpoint: isCustom ? (customerProviders[chatProvider]?.defaultChatEndpoint) : undefined,
                    });
                    setChatTestStatus({ testing: false, result });
                  } catch (err) {
                    setChatTestStatus({ testing: false, result: { success: false, message: String(err) } });
                  }
                }}
              >
                {chatTestStatus.testing ? t('settings:models.test.testing') : t('settings:models.test.label')}
              </button>
            </div>
          </div>
        </div>
      )}

      {pickerOpen && (
        <ModelPickerModal
          providerName={providerDisplayName(entry, t)}
          models={modelsForCurrent}
          selectedId={chatModel}
          selectedIds={providerSettings[chatProvider]?.selectedModelIds ?? EMPTY_SELECTED}
          fetchStatus={fetchStatusForCurrent}
          fetchError={fetchErrorForCurrent}
          onClose={() => setPickerOpen(false)}
          onSelect={(id) => {
            const current = providerSettings[chatProvider]?.selectedModelIds ?? [];
            if (current.includes(id)) {
              removeSelectedModelId(chatProvider, id);
            } else {
              setChatModel(id);
              addSelectedModelId(chatProvider, id);
            }
          }}
          onRefresh={() => {
            void fetchModelsForProvider(
              chatProvider,
              chatApiKey,
              chatBaseUrl || providersJsonBaseUrl || undefined,
              chatAzureApiVersion || undefined,
              isCustom,
              isCustom ? customerProviders[chatProvider]?.defaultChatEndpoint : undefined,
            );
          }}
        />
      )}

      {manualModalOpen && (
        <AddManualModelModal
          onClose={() => setManualModalOpen(false)}
          onSave={({ id, displayName, group }) => {
            addManualModel(chatProvider, { id, displayName, group });
            setManualModalOpen(false);
          }}
        />
      )}

      {pendingDeleteProvider && (
        <div className="fixed inset-0 z-[9999] bg-black/35 flex items-center justify-center" onClick={() => setDeleteConfirmId(null)}>
          <div className="bg-panel rounded-[10px] py-5 px-6 min-w-[300px] max-w-[400px] shadow-[0_8px_32px_rgba(0,0,0,0.18)] border border-brd" onClick={(e) => e.stopPropagation()}>
            <div className="text-[15px] font-semibold text-t1 mb-2">{t('settings:models.confirmDelete')}</div>
            <div className="text-[13px] text-t2 leading-relaxed mb-4">
              <strong>{pendingDeleteProvider.name || pendingDeleteProvider.id}</strong>
            </div>
            <div className="flex justify-end gap-2">
              <button className="py-1.5 px-4 rounded-md text-[13px] cursor-pointer border border-brd font-ui transition-all duration-[140ms] bg-panel text-t2 hover:bg-hov" onClick={() => setDeleteConfirmId(null)}>{t('settings:models.cancel')}</button>
              <button
                className="py-1.5 px-4 rounded-md text-[13px] cursor-pointer border border-[#e74c3c] font-ui transition-all duration-[140ms] bg-[#e74c3c] text-white hover:bg-[#c0392b] hover:border-[#c0392b]"
                onClick={() => {
                  removeCustomProvider(pendingDeleteProvider.id);
                  setDeleteConfirmId(null);
                }}
              >
                {t('settings:models.deleteCustom')}
              </button>
            </div>
          </div>
        </div>
      )}

      {refetchStatus.kind !== 'idle' && (
        // ponytail: containing block = SettingsPage root (added `relative` there).
        // `left-[190px]` skips the left nav (`<nav className="sn w-[190px]">`)
        // so the nav stays interactive while the right panel + right-side
        // blank are grayed. Coupled to nav width — change there too.
        <div className="absolute top-0 right-0 bottom-0 left-[190px] z-[100] flex items-center justify-center bg-black/40 pointer-events-none">
          {refetchStatus.kind === 'loading' && (
            <Loader2 size={28} className="animate-spin text-t2" />
          )}
          {refetchStatus.kind === 'ok' && (
            <div className="flex items-center gap-2 text-white text-[14px]">
              <Check size={16} className="text-green-400" />
              <span>{t('settings:models.refetchModelsDevOk')}</span>
            </div>
          )}
          {refetchStatus.kind === 'err' && (
            <span className="text-red-400 text-[12px] px-4 text-center max-w-[400px]">
              {t('settings:models.refetchModelsDevErr', { message: refetchStatus.message })}
            </span>
          )}
        </div>
      )}


    </div>
  );
}

// ── Custom provider drawer ─────────────────────────────────────
// ponytail: endpoint options are the 7 actual endpoint keys present in
// bundled providers.json's endpointConfigs — NOT the legacy
// CustomProviderType label enum. `new-api` was never an endpoint key; the
// legacy drawer emitting it was a bug.
const ENDPOINT_OPTIONS: DefaultChatEndpoint[] = [
  'openai-chat-completions',
  'openai-responses',
  'anthropic-messages',
  'google-generate-content',
  'ollama',
  'ollama-chat',
  'openai-image-generation',
];

const ID_PATTERN = /^[A-Za-z0-9_-]+$/;

function CustomProviderDrawer({
  state,
  existingIds,
  initial,
  onClose,
  onSave,
}: {
  state: DrawerState;
  existingIds: readonly string[];
  initial: CustomProvider | null;
  onClose: () => void;
  onSave: (data: {
    id: string;
    name: string;
    defaultChatEndpoint: DefaultChatEndpoint;
    description?: string;
    metadata?: CustomProvider['metadata'];
  }) => void;
}) {
  const { t } = useTranslation();
  const [id, setId] = useState(initial?.id ?? '');
  const [name, setName] = useState(initial?.name ?? '');
  const [defaultChatEndpoint, setDefaultChatEndpoint] = useState<DefaultChatEndpoint>(
    (initial?.defaultChatEndpoint as DefaultChatEndpoint) ?? 'openai-chat-completions',
  );
  const [description, setDescription] = useState(initial?.description ?? '');
  const [apiKey, setApiKey] = useState(initial?.metadata?.website?.apiKey ?? '');
  const [docs, setDocs] = useState(initial?.metadata?.website?.docs ?? '');
  const [models, setModels] = useState(initial?.metadata?.website?.models ?? '');
  const [official, setOfficial] = useState(initial?.metadata?.website?.official ?? '');
  const [metadataOpen, setMetadataOpen] = useState(false);

  const idValid = ID_PATTERN.test(id.trim());
  const idUnique = state.mode === 'edit' || !existingIds.includes(id.trim());
  const nameValid = name.trim().length > 0;
  const valid = idValid && idUnique && nameValid;

  const previewChar = (name.trim()[0] ?? '?').toUpperCase();

  const buildMetadata = (): CustomProvider['metadata'] | undefined => {
    if (!apiKey && !docs && !models && !official) return undefined;
    return { website: { apiKey: apiKey || undefined, docs: docs || undefined, models: models || undefined, official: official || undefined } };
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center"
      onClick={onClose}
    >
      <div
        className="bg-panel border border-brd rounded-md w-[480px] max-h-[90vh] overflow-y-auto flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-4 pt-4 pb-2">
          <div className="text-[length:calc(var(--ui-font-size)+1px)] font-bold text-t1">
            {state.mode === 'add' ? t('settings:models.addCustomTitle') : t('settings:models.editCustomTitle')}
          </div>
        </div>
        <div className="h-px bg-brd mx-4" />

        <div className="px-4 py-4 flex flex-col gap-3">
          <div className="flex justify-center">
            <span
              className="inline-flex items-center justify-center rounded-full text-white text-[16px] font-bold"
              style={{ width: 40, height: 40, background: avatarColor(name || 'custom') }}
            >
              {previewChar}
            </span>
          </div>

          {state.mode === 'add' && (
            <label className="flex flex-col gap-1">
              <span className="text-[length:calc(var(--ui-font-size)-2.5px)] font-semibold text-t2">
                {t('settings:models.idLabel') || 'ID'}
              </span>
              <input
                className={`fi2 h-[34px] py-[7px] px-2.5 rounded-md border bg-inp text-t1 text-[length:calc(var(--ui-font-size)-2px)] outline-none font-ui ${id && !idValid ? 'border-red text-red' : 'border-brd'}`}
                value={id}
                onChange={(e) => setId(e.target.value.slice(0, 64))}
                placeholder="my-provider"
                autoCapitalize="off"
                spellCheck={false}
                autoFocus
              />
              <span className={`text-[10px] ${id && !idValid ? 'text-red' : 'text-t3'}`}>
                {ID_PATTERN.test(id.trim())
                  ? (idUnique ? t('settings:models.idHint') || 'Letters, digits, - and _ only.'
                    : t('settings:models.idDuplicate') || 'ID already exists.')
                  : (t('settings:models.idInvalid') || 'Letters, digits, - and _ only.')}
              </span>
            </label>
          )}

          <label className="flex flex-col gap-1">
            <span className="text-[length:calc(var(--ui-font-size)-2.5px)] font-semibold text-t2">
              {t('settings:models.displayNameLabel')}
            </span>
            <input
              className="fi2 h-[34px] py-[7px] px-2.5 rounded-md border border-brd bg-inp text-t1 text-[length:calc(var(--ui-font-size)-2px)] outline-none font-ui"
              value={name}
              onChange={(e) => setName(e.target.value.slice(0, 32))}
              placeholder={t('settings:models.customNamePlaceholder')}
              maxLength={32}
              autoFocus={state.mode === 'edit'}
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-[length:calc(var(--ui-font-size)-2.5px)] font-semibold text-t2">
              {t('settings:models.categoryLabel')}
            </span>
            <select
              className="fi2 h-[34px] py-[7px] px-2.5 rounded-md border border-brd bg-inp text-t1 text-[length:calc(var(--ui-font-size)-2px)] outline-none font-ui"
              value={defaultChatEndpoint}
              onChange={(e) => setDefaultChatEndpoint(e.target.value as DefaultChatEndpoint)}
            >
              {[...ENDPOINT_OPTIONS].sort().map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-[length:calc(var(--ui-font-size)-2.5px)] font-semibold text-t2">
              {t('settings:models.descriptionLabel') || 'Description'}
            </span>
            <textarea
              className="fi2 py-[7px] px-2.5 rounded-md border border-brd bg-inp text-t1 text-[length:calc(var(--ui-font-size)-2px)] outline-none font-ui min-h-[60px] resize-y"
              value={description}
              onChange={(e) => setDescription(e.target.value.slice(0, 500))}
              placeholder={t('settings:models.descriptionPlaceholder') || 'Optional'}
            />
          </label>

          <div className="flex flex-col gap-1.5">
            <button
              type="button"
              className="flex items-center gap-1 text-[length:calc(var(--ui-font-size)-2.5px)] font-semibold text-t2 select-none"
              onClick={() => setMetadataOpen((v) => !v)}
            >
              <svg
                className={`transition-transform ${metadataOpen ? 'rotate-180' : ''}`}
                width="10"
                height="10"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polyline points="6 9 12 15 18 9" />
              </svg>
              {t('settings:models.metadataLabel') || 'Metadata'}
            </button>
            {metadataOpen && (
              <>
                <input
                  className="fi2 h-[30px] py-[5px] px-2.5 rounded-md border border-brd bg-inp text-t1 text-[length:calc(var(--ui-font-size)-2px)] outline-none font-ui"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder={t('settings:models.metadata.apiKey') || 'API key URL'}
                />
                <input
                  className="fi2 h-[30px] py-[5px] px-2.5 rounded-md border border-brd bg-inp text-t1 text-[length:calc(var(--ui-font-size)-2px)] outline-none font-ui"
                  value={docs}
                  onChange={(e) => setDocs(e.target.value)}
                  placeholder={t('settings:models.metadata.docs') || 'Docs URL'}
                />
                <input
                  className="fi2 h-[30px] py-[5px] px-2.5 rounded-md border border-brd bg-inp text-t1 text-[length:calc(var(--ui-font-size)-2px)] outline-none font-ui"
                  value={models}
                  onChange={(e) => setModels(e.target.value)}
                  placeholder={t('settings:models.metadata.models') || 'Models list URL'}
                />
                <input
                  className="fi2 h-[30px] py-[5px] px-2.5 rounded-md border border-brd bg-inp text-t1 text-[length:calc(var(--ui-font-size)-2px)] outline-none font-ui"
                  value={official}
                  onChange={(e) => setOfficial(e.target.value)}
                  placeholder={t('settings:models.metadata.official') || 'Official site URL'}
                />
              </>
            )}
          </div>
        </div>

        <div className="h-px bg-brd mx-4" />
        <div className="flex justify-end gap-2 px-4 py-3">
          <button className="btn btn-g btn-sm" onClick={onClose}>
            {t('settings:models.cancel')}
          </button>
          <button
            className="btn btn-p btn-sm"
            disabled={!valid}
            onClick={() =>
              onSave({
                id: id.trim(),
                name: name.trim(),
                defaultChatEndpoint,
                description: description.trim() || undefined,
                metadata: buildMetadata(),
              })
            }
          >
            {t('settings:models.save')}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Model picker modal (HTML-styled) ────────────────────────────
const CATEGORY_TABS: { id: 'all' | Capability; labelKey: string }[] = [
  { id: 'all', labelKey: 'settings:models.filterAll' },
  { id: 'reasoning', labelKey: 'settings:models.capability.reasoning' },
  { id: 'vision', labelKey: 'settings:models.capability.vision' },
  { id: 'web-search', labelKey: 'settings:models.capability.web-search' },
  { id: 'function-call', labelKey: 'settings:models.capability.function-call' },
];

type PickerCategory = 'all' | Capability;

function ModelPickerModal({
  providerName,
  models,
  selectedId,
  selectedIds,
  fetchStatus,
  fetchError,
  onClose,
  onSelect,
  onRefresh,
}: {
  providerName: string;
  models: readonly Model[];
  selectedId: string;
  selectedIds: readonly string[];
  fetchStatus: string;
  fetchError: string | null;
  onClose: () => void;
  onSelect: (id: string) => void;
  onRefresh: () => void;
}) {
  const { t } = useTranslation();
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<PickerCategory>('all');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  // ponytail: native keydown — no new dep, ESC closes.
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);

  // ponytail: auto-fetch on open when list is empty — matches HTML design
  // where the in-modal refresh button is the fetch trigger. Run once per
  // mount; deps intentionally empty.
  // Always refetch on open — user expects clicking "获取模型" to trigger a
  // fresh request, not just reuse cached results. Mount-only; deps empty.
  useEffect(() => {
    onRefresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const groups = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = models.filter((m) => {
      const haystack = (m.displayName ?? m.id).toLowerCase();
      if (q && !haystack.includes(q) && !m.id.toLowerCase().includes(q)) return false;
      if (category !== 'all' && !m.capabilities.includes(category)) return false;
      return true;
    });
    const map = new Map<string, Model[]>();
    for (const m of filtered) {
      const g = m.group ?? familyGroup(m.id);
      const arr = map.get(g) ?? [];
      arr.push(m);
      map.set(g, arr);
    }
    return Array.from(map.entries()).map(([name, items]) => ({ name, items }));
  }, [models, search, category]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-5"
      style={{ background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(4px)' }}
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl w-full max-w-[780px] h-[90vh] flex flex-col overflow-hidden relative"
        style={{ boxShadow: '0 10px 25px -5px rgba(0,0,0,0.1), 0 8px 10px -6px rgba(0,0,0,0.05)' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header — pinned */}
        <div className="flex justify-between items-center px-6 pt-6 pb-4 shrink-0">
          <h2 className="text-xl font-bold text-gray-900">{providerName}</h2>
          <button
            type="button"
            aria-label={t('settings:models.picker.close')}
            title={t('settings:models.picker.close')}
            onClick={onClose}
            className="text-gray-400 p-1 rounded-md hover:bg-gray-100 hover:text-gray-600 transition"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Search row — pinned, antd Compact style (input + primary button) */}
        <div className="flex px-6 pb-3 shrink-0">
          <div className="relative flex-1">
            <svg
              className="absolute left-[10px] top-1/2 -translate-y-1/2 text-gray-400"
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              type="text"
              placeholder={t('settings:models.picker.searchPlaceholder')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full h-[32px] pl-[30px] pr-[12px] border border-gray-200 border-r-0 rounded-l-md text-[13px] text-gray-800 outline-none focus:border-emerald-500"
              style={{ fontFamily: 'inherit' }}
              autoFocus
            />
          </div>
          <button
            type="button"
            onClick={onRefresh}
            disabled={fetchStatus === 'loading'}
            className="shrink-0 h-[32px] px-3 rounded-r-md border border-gray-200 text-white text-[13px] font-medium flex items-center gap-1.5 disabled:opacity-60 disabled:cursor-not-allowed hover:opacity-90"
            style={{ background: 'var(--acc, #3a6ef0)' }}
          >
            {fetchStatus === 'loading' ? (
              <>
                <Loader2 size={13} className="animate-spin" />
                {t('settings:models.picker.refreshing')}
              </>
            ) : (
              t('settings:models.picker.refresh')
            )}
          </button>
        </div>

        {/* Category tabs — pinned */}
        <div className="flex gap-6 border-b border-gray-100 px-6 pb-2 shrink-0 overflow-x-auto">
          {CATEGORY_TABS.map((tab) => {
            const active = category === tab.id;
            return (
              <div
                key={tab.id}
                onClick={() => setCategory(tab.id)}
                className={`text-sm cursor-pointer pb-2.5 font-medium relative whitespace-nowrap select-none ${
                  active ? 'text-emerald-500 font-semibold' : 'text-gray-600'
                }`}
              >
                {t(tab.labelKey)}
                {active && (
                  <span
                    className="absolute -bottom-px left-0 right-0 rounded-sm"
                    style={{ height: 2, background: '#10b981' }}
                  />
                )}
              </div>
            );
          })}
        </div>

        {/* Groups — scrollable */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {fetchStatus === 'error' && fetchError && (
            <div className="text-[12.5px] break-all mb-3" style={{ color: 'var(--red, #f06a6a)' }}>
              {fetchError}
            </div>
          )}
          <div className="flex flex-col gap-3">
            {groups.length === 0 ? (
              <div className="text-sm text-gray-400 italic py-4 text-center">
                {fetchStatus === 'loading'
                  ? t('settings:models.fetchModels.fetching')
                  : t('settings:models.fetchModels.empty')}
              </div>
            ) : (
              groups.map((g) => {
                const isCollapsed = collapsed.has(g.name);
                return (
                  <div key={g.name} className="bg-gray-100 rounded-xl overflow-hidden">
                    {/* Group header — click to toggle collapse */}
                    <div
                      className="px-4 py-2.5 flex items-center justify-between select-none cursor-pointer hover:bg-gray-200/60 transition-colors"
                      onClick={() => setCollapsed((prev) => {
                        const next = new Set(prev);
                        if (next.has(g.name)) next.delete(g.name);
                        else next.add(g.name);
                        return next;
                      })}
                    >
                      <div className="flex items-center gap-2">
                        <svg
                          className={`text-gray-500 transition-transform ${isCollapsed ? '' : 'rotate-180'}`}
                          width="12"
                          height="12"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2.5"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <polyline points="6 9 12 15 18 9" />
                        </svg>
                        <span className="text-[13px] font-bold text-gray-900">{g.name}</span>
                        <span
                          className="text-[11px] font-semibold px-[6px] py-px rounded-full leading-tight"
                          style={{ background: '#d1fae5', color: '#059669' }}
                        >
                          {g.items.length}
                        </span>
                      </div>
                    </div>
                    {/* Group body — hidden when collapsed */}
                    {!isCollapsed && (
                      <div className="bg-white px-4">
                        {g.items.map((m, idx) => {
                          const isSelected = selectedIds.includes(m.id);
                          const isActive = m.id === selectedId;
                          return (
                            <div
                              key={m.id}
                              title={modelOptionTitle(m)}
                              className={`flex items-center justify-between py-3.5 ${
                                idx < g.items.length - 1 ? 'border-b border-gray-100' : ''
                              }`}
                            >
                              <div className="flex items-center gap-3 min-w-0">
                                <ModelAvatar id={m.id} />
                                <span
                                  className={`text-[length:calc(var(--ui-font-size)-2px)] font-ui truncate ${
                                    isActive
                                      ? 'font-bold text-emerald-700'
                                      : isSelected
                                        ? 'font-semibold text-emerald-600'
                                        : 'font-semibold text-gray-800'
                                  }`}
                                >
                                  {m.displayName ?? m.id}
                                </span>
                              </div>
                              <div className="flex items-center gap-[18px] shrink-0">
                                <CapabilityPills capabilities={m.capabilities} />
                                <button
                                  type="button"
                                  onClick={() => onSelect(m.id)}
                                  title={isSelected ? t('settings:models.picker.remove') : t('settings:models.picker.select')}
                                  className={
                                    isSelected
                                      ? 'text-emerald-600 hover:text-emerald-700'
                                      : 'text-gray-700 hover:text-emerald-600'
                                  }
                                >
                                  {isSelected ? (
                                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                      <line x1="5" y1="12" x2="19" y2="12" />
                                    </svg>
                                  ) : (
                                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                      <line x1="12" y1="5" x2="12" y2="19" />
                                      <line x1="5" y1="12" x2="19" y2="12" />
                                    </svg>
                                  )}
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Loading overlay — centered spinner while fetching */}
        {fetchStatus === 'loading' && (
          <div className="absolute inset-0 flex items-center justify-center bg-white/60 z-10 pointer-events-none">
            <Loader2 size={32} className="animate-spin text-gray-500" />
          </div>
        )}
      </div>
    </div>
  );
}

// ── Add manual model modal ───────────────────────────────────────
function AddManualModelModal({
  onClose,
  onSave,
}: {
  onClose: () => void;
  onSave: (data: { id: string; displayName: string; group: string }) => void;
}) {
  const { t } = useTranslation();
  const [id, setId] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [group, setGroup] = useState('');

  const valid = id.trim().length > 0;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center"
      onClick={onClose}
    >
      <div
        className="bg-panel border border-brd rounded-md w-[420px] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-4 pt-4 pb-2">
          <div className="text-[length:calc(var(--ui-font-size)+1px)] font-bold text-t1">
            {t('settings:models.addManual.title')}
          </div>
        </div>
        <div className="h-px bg-brd mx-4" />

        <div className="px-4 py-4 flex flex-col gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-[length:calc(var(--ui-font-size)-2.5px)] font-semibold text-t2">
              {t('settings:models.addManual.idLabel')}
            </span>
            <input
              className="fi2 h-[34px] py-[7px] px-2.5 rounded-md border border-brd bg-inp text-t1 text-[length:calc(var(--ui-font-size)-2px)] outline-none font-ui"
              value={id}
              onChange={(e) => setId(e.target.value.slice(0, 128))}
              placeholder="gpt-4o-mini"
              autoCapitalize="off"
              autoComplete="off"
              autoFocus
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[length:calc(var(--ui-font-size)-2.5px)] font-semibold text-t2">
              {t('settings:models.addManual.nameLabel')}
            </span>
            <input
              className="fi2 h-[34px] py-[7px] px-2.5 rounded-md border border-brd bg-inp text-t1 text-[length:calc(var(--ui-font-size)-2px)] outline-none font-ui"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value.slice(0, 64))}
              placeholder="GPT-4o mini"
              autoCapitalize="off"
              autoComplete="off"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[length:calc(var(--ui-font-size)-2.5px)] font-semibold text-t2">
              {t('settings:models.addManual.groupLabel')}
            </span>
            <input
              className="fi2 h-[34px] py-[7px] px-2.5 rounded-md border border-brd bg-inp text-t1 text-[length:calc(var(--ui-font-size)-2px)] outline-none font-ui"
              value={group}
              onChange={(e) => setGroup(e.target.value.slice(0, 32))}
              placeholder="Gpt 4"
              autoCapitalize="off"
              autoComplete="off"
            />
          </label>
        </div>

        <div className="h-px bg-brd mx-4" />
        <div className="flex justify-end gap-2 px-4 py-3">
          <button className="btn btn-g btn-sm" onClick={onClose}>
            {t('settings:models.cancel')}
          </button>
          <button
            className="btn btn-p btn-sm"
            disabled={!valid}
            onClick={() =>
              onSave({
                id: id.trim(),
                displayName: displayName.trim() || id.trim(),
                group: group.trim() || familyGroup(id.trim()),
              })
            }
          >
            {t('settings:models.save')}
          </button>
        </div>
      </div>
    </div>
  );
}
