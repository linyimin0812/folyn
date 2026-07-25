/**
 * 模型服务 settings tab — chat/LLM provider config, model fetch, refetch-all,
 * test-connection.
 *
 * Extracted from SettingsPage.tsx (split from old "AI 工具" tab). Reads
 * aiConfigStore + modelRegistryStore; owns local UI state for chat-test
 * result, api-key visibility, and refetch-all summary.
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAiConfigStore, type ChatProvider } from '@/store/aiConfigStore';
import { testChatConnection } from '@/services/rigChat';
import {
  PROVIDER_CATALOG,
  PROVIDER_CATEGORY_ORDER,
  providersByCategory,
  getProviderEntry,
} from '@/services/providers/catalog';
import { isSelectedModelInList } from '@/services/modelRegistry/fetchModels';
import { useModelRegistryStore, canFetchModelsFromStore } from '@/store/modelRegistryStore';
import { findModelInCatalog } from '@/services/modelRegistry/loader';
import { isReasoningModel } from '@/services/modelRegistry/merge';
import type { Model } from '@/services/modelRegistry/types';

// ponytail: option labels can't host styled children, so badges are plain
// text appended to the id. Pricing goes in the title attr (hover).
function modelOptionLabel(m: Model, t: (k: string) => string): string {
  const caps = m.capabilities.map((c) => t(`settings:models.capability.${c}`)).filter(Boolean);
  const parts = [m.id];
  if (caps.length > 0) parts.push(caps.join(' · '));
  if (m.pricing) {
    const inPrice = m.pricing.inputPerMtok !== undefined ? `$${m.pricing.inputPerMtok}/M` : '';
    const outPrice = m.pricing.outputPerMtok !== undefined ? `$${m.pricing.outputPerMtok}/M` : '';
    const priceStr = [inPrice, outPrice].filter(Boolean).join(' in / ');
    if (priceStr) parts.push(priceStr);
  }
  return parts.join(' · ');
}

function modelOptionTitle(m: Model): string {
  const inPrice = m.pricing?.inputPerMtok;
  const outPrice = m.pricing?.outputPerMtok;
  if (inPrice === undefined && outPrice === undefined) return '';
  return `Input: $${inPrice ?? '—'} / Output: $${outPrice ?? '—'} per million tokens`;
}

// ponytail: tiny status dot — grey/idle, yellow/loading, green/success,
// red/error. Title attr carries the provider id + error message for hover.
function FetchStatusDot({
  status,
  error,
  label,
}: {
  status: 'idle' | 'loading' | 'success' | 'error';
  error?: string | null;
  label?: string;
}) {
  if (status === 'idle') return null;
  const color =
    status === 'loading' ? 'var(--yellow, #f5c518)'
    : status === 'success' ? 'var(--green, #22a863)'
    : 'var(--red, #f06a6a)';
  const parts = [
    label,
    status === 'error' ? (error ?? 'error')
    : status === 'loading' ? 'fetching…'
    : 'fetched',
  ].filter(Boolean);
  return (
    <span
      title={parts.join(' · ')}
      style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: color }}
    />
  );
}

const EMPTY_MODELS: Model[] = [];

export function ModelServicesSettings() {
  const { t } = useTranslation();
  const chatProvider = useAiConfigStore((s) => s.chatProvider);
  const chatModel = useAiConfigStore((s) => s.chatModel);
  const chatApiKey = useAiConfigStore((s) => s.chatApiKey);
  const chatBaseUrl = useAiConfigStore((s) => s.chatBaseUrl);
  const chatAzureDeploymentId = useAiConfigStore((s) => s.chatAzureDeploymentId);
  const chatAzureApiVersion = useAiConfigStore((s) => s.chatAzureApiVersion);
  const chatThinkingBudget = useAiConfigStore((s) => s.chatThinkingBudget);
  const setChatProvider = useAiConfigStore((s) => s.setChatProvider);
  const setChatModel = useAiConfigStore((s) => s.setChatModel);
  const setChatApiKey = useAiConfigStore((s) => s.setChatApiKey);
  const setChatBaseUrl = useAiConfigStore((s) => s.setChatBaseUrl);
  const setChatAzureDeploymentId = useAiConfigStore((s) => s.setChatAzureDeploymentId);
  const setChatAzureApiVersion = useAiConfigStore((s) => s.setChatAzureApiVersion);
  const setChatThinkingBudget = useAiConfigStore((s) => s.setChatThinkingBudget);
  const [chatTestStatus, setChatTestStatus] = useState<{ testing: boolean; result?: { success: boolean; message: string } }>({ testing: false });
  const [showChatKey, setShowChatKey] = useState(false);
  // T04: model list per-provider, persisted via modelRegistryStore.
  // ponytail: stable empty array so the selector returns the same reference
  // when the provider key is absent — otherwise useSyncExternalStore loops.
  const modelsForCurrent = useModelRegistryStore((s) => s.modelsByProvider[chatProvider] ?? EMPTY_MODELS);
  // T05: selectedModel = catalog entry or fetched-list entry for the current
  // chatModel. Unknown (orphan / never-fetched) → undefined → reasoning UI
  // hidden (no model to reason about).
  const selectedModel = findModelInCatalog(chatProvider, chatModel) ?? modelsForCurrent.find((m) => m.id === chatModel);
  const showThinkingBudget = selectedModel ? isReasoningModel(selectedModel) : false;
  const fetchStatusForCurrent = useModelRegistryStore((s) => s.fetchStatusByProvider[chatProvider] ?? 'idle');
  const fetchErrorForCurrent = useModelRegistryStore((s) => s.fetchErrorByProvider[chatProvider] ?? null);
  const fetchModelsForProvider = useModelRegistryStore((s) => s.fetchModelsForProvider);
  // T06: subscribe to the per-provider config map so we can iterate
  // configured providers in the "重新拉取全部" button.
  const providerConfigs = useAiConfigStore((s) => s.providerConfigs);
  // T06: per-provider status grid.
  const fetchStatusMap = useModelRegistryStore((s) => s.fetchStatusByProvider);
  const fetchErrorMap = useModelRegistryStore((s) => s.fetchErrorByProvider);
  const refetchAll = useModelRegistryStore((s) => s.refetchAll);
  // T06: compute the configured-provider list inline (O(20), no memoization
  // needed). Reactive: depends on chatProvider + providerConfigs.
  const configuredIds: string[] = [];
  for (const entry of PROVIDER_CATALOG) {
    if (!entry.requiresApiKey) {
      if (chatProvider === entry.id || providerConfigs[entry.id]) {
        configuredIds.push(entry.id);
      }
      continue;
    }
    const slot = providerConfigs[entry.id];
    if (slot && slot.apiKey.trim() !== '') configuredIds.push(entry.id);
  }
  const hasConfiguredProviders = configuredIds.length > 0;
  const [refetchAllStatus, setRefetchAllStatus] = useState<{ running: boolean; summary?: string }>({ running: false });

  const entry = getProviderEntry(chatProvider) ?? PROVIDER_CATALOG[0];

  return (
    <div className="mb-8 whitespace-nowrap">
      <div className="pb-3 mb-5 border-b border-brd2 flex items-baseline gap-2">
        <div className="text-[length:calc(var(--ui-font-size)+3px)] font-bold text-t1 tracking-[-0.01em]">{t('settings:models.title')}</div>
        <div className="text-[length:calc(var(--ui-font-size)-1px)] text-t3">{t('settings:models.description')}</div>
      </div>
      <div className="flex items-center justify-between mb-[3px]">
        <div className="text-[length:calc(var(--ui-font-size)-1px)] font-bold text-t1">{t('settings:models.chat.title')}</div>
        <div className="flex items-center gap-2">
          {/* T06: per-provider status dot grid — one dot per configured
              provider. Idle providers (never configured) are omitted. */}
          {configuredIds.map((pid) => (
            <FetchStatusDot
              key={pid}
              status={fetchStatusMap[pid] ?? 'idle'}
              error={fetchErrorMap[pid] ?? null}
              label={pid}
            />
          ))}
          <button
            type="button"
            className="text-[10.5px] text-acc hover:underline disabled:text-t3 disabled:no-underline disabled:cursor-not-allowed"
            disabled={!hasConfiguredProviders || refetchAllStatus.running}
            title={!hasConfiguredProviders ? t('settings:models.refetchAllHint') : ''}
            onClick={async () => {
              const ids = useAiConfigStore.getState().configuredProviderIds();
              if (ids.length === 0) return;
              setRefetchAllStatus({ running: true });
              // Build the configured list from providerConfigs slots.
              // Ollama (no api_key) sends an empty string — the Rust side
              // skips the empty-key check for ollama.
              const configured = ids.map((pid) => {
                const slot = useAiConfigStore.getState().providerConfigs[pid];
                return {
                  providerId: pid,
                  apiKey: slot?.apiKey ?? '',
                  baseUrl: slot?.baseUrl || undefined,
                  azureApiVersion: slot?.azureApiVersion || undefined,
                };
              });
              const result = await refetchAll(configured);
              const summary = t('settings:models.refetchAllSummary', {
                success: result.success,
                failed: result.failed,
              });
              setRefetchAllStatus({ running: false, summary });
              setTimeout(() => setRefetchAllStatus((s) => ({ ...s, summary: undefined })), 6000);
            }}
          >
            {refetchAllStatus.running
              ? t('settings:models.refetchAllRunning')
              : t('settings:models.refetchAll')}
          </button>
        </div>
      </div>
      {refetchAllStatus.summary && (
        <div className="text-[10.5px] mb-2" style={{ color: 'var(--green, #22a863)' }}>{refetchAllStatus.summary}</div>
      )}
      <div className="text-[length:calc(var(--ui-font-size)-2px)] text-t3 mb-3">{t('settings:models.chat.description')}</div>
      <div className="mb-3.5">
        <div className="text-[length:calc(var(--ui-font-size)-2.5px)] font-semibold text-t2 mb-[5px]">{t('settings:models.provider.label')}</div>
        <select
          className="fi2 w-full h-[34px] py-[7px] px-2.5 rounded-md border border-brd bg-inp text-t1 text-[length:calc(var(--ui-font-size)-2px)] outline-none font-ui"
          value={chatProvider}
          onChange={(e) => setChatProvider(e.target.value as ChatProvider)}
        >
          {PROVIDER_CATEGORY_ORDER.map((cat) => {
            const items = providersByCategory(cat);
            if (items.length === 0) return null;
            return (
              <optgroup key={cat} label={t(`settings:models.category.${cat}`)}>
                {items.map((p) => (
                  <option key={p.id} value={p.id}>{t(p.i18nKey)}</option>
                ))}
              </optgroup>
            );
          })}
        </select>
      </div>
      <div className="mb-3.5">
        <div className="flex items-center justify-between mb-[5px]">
          <div className="text-[length:calc(var(--ui-font-size)-2.5px)] font-semibold text-t2">{t('settings:models.model.label')}</div>
          <button
            type="button"
            className="text-[10.5px] text-acc hover:underline disabled:text-t3 disabled:no-underline disabled:cursor-not-allowed"
            disabled={!canFetchModelsFromStore(chatProvider, chatApiKey) || fetchStatusForCurrent === 'loading'}
            onClick={() => {
              void fetchModelsForProvider(
                chatProvider,
                chatApiKey,
                chatBaseUrl || undefined,
                chatAzureApiVersion || undefined,
              );
            }}
          >
            {fetchStatusForCurrent === 'loading'
              ? t('settings:models.fetchModels.fetching')
              : t('settings:models.fetchModels.label')}
          </button>
        </div>
        {modelsForCurrent.length > 0 ? (
          <select
            className="fi2 w-full h-[34px] py-[7px] px-2.5 rounded-md border border-brd bg-inp text-t1 text-[length:calc(var(--ui-font-size)-2px)] outline-none font-ui"
            value={chatModel}
            onChange={(e) => setChatModel(e.target.value as string)}
          >
            {chatModel && !isSelectedModelInList(chatModel, modelsForCurrent) && (
              <option value={chatModel}>⚠ {chatModel} · {t('settings:models.fetchModels.orphan')}</option>
            )}
            {modelsForCurrent.map((m) => (
              <option key={m.id} value={m.id} title={modelOptionTitle(m)}>
                {modelOptionLabel(m, t)}
              </option>
            ))}
          </select>
        ) : (
          <>
            <input
              className="fi2 w-full py-[7px] px-2.5 rounded-md border border-brd bg-inp text-t1 text-[length:calc(var(--ui-font-size)-2px)] outline-none font-ui"
              value={chatModel}
              onChange={(e) => setChatModel(e.target.value)}
              placeholder={entry.placeholderModel}
              autoCapitalize="off"
            />
            {fetchStatusForCurrent === 'error' && fetchErrorForCurrent && (
              <div className="text-[10.5px] mt-1" style={{ color: 'var(--red, #f06a6a)' }}>{fetchErrorForCurrent}</div>
            )}
            {fetchStatusForCurrent === 'success' && modelsForCurrent.length === 0 && (
              <div className="text-[10.5px] mt-1 text-t3">{t('settings:models.fetchModels.empty')}</div>
            )}
          </>
        )}
      </div>
      {entry.requiresApiKey && (
        <div className="mb-3.5">
          <div className="flex items-center justify-between mb-[5px]">
            <div className="text-[length:calc(var(--ui-font-size)-2.5px)] font-semibold text-t2">{t('settings:models.apiKey.label')}</div>
            {entry.apiKeyUrl && (
              <a
                href={entry.apiKeyUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[10.5px] text-acc hover:underline"
              >
                {t('settings:models.apiKey.getKey')}
              </a>
            )}
          </div>
          <div className="relative">
            <input
              type={showChatKey ? 'text' : 'password'}
              className="fi2 w-full py-[7px] px-2.5 pr-[34px] rounded-md border border-brd bg-inp text-t1 text-[length:calc(var(--ui-font-size)-2px)] outline-none font-ui"
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
        </div>
      )}
      {entry.requiresAzureFields && (
        <>
          <div className="mb-3.5">
            <div className="text-[length:calc(var(--ui-font-size)-2.5px)] font-semibold text-t2 mb-[5px]">{t('settings:models.azure.deploymentId.label')}</div>
            <input
              className="fi2 w-full py-[7px] px-2.5 rounded-md border border-brd bg-inp text-t1 text-[length:calc(var(--ui-font-size)-2px)] outline-none font-ui"
              value={chatAzureDeploymentId}
              onChange={(e) => setChatAzureDeploymentId(e.target.value)}
              placeholder="my-deployment"
              autoCapitalize="off"
            />
          </div>
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
        </>
      )}
      {showThinkingBudget && (
        <div className="mb-3.5">
          <div className="text-[length:calc(var(--ui-font-size)-2.5px)] font-semibold text-t2 mb-[5px]">{t('settings:models.thinkingBudget.label')}</div>
          <input
            type="number"
            min={0}
            className="fi2 w-full py-[7px] px-2.5 rounded-md border border-brd bg-inp text-t1 text-[length:calc(var(--ui-font-size)-2px)] outline-none font-ui"
            value={chatThinkingBudget ?? ''}
            onChange={(e) => {
              const v = e.target.value;
              setChatThinkingBudget(v === '' ? null : Math.max(0, Math.floor(Number(v))));
            }}
            placeholder="1024"
            autoCapitalize="off"
          />
          <div className="text-[10.5px] text-t3 mt-1">{t('settings:models.thinkingBudget.hint')}</div>
        </div>
      )}
      <div className="mb-1">
        <div className="text-[length:calc(var(--ui-font-size)-2.5px)] font-semibold text-t2 mb-[5px]">{t('settings:models.baseUrl.label')}</div>
        <input
          className="fi2 w-full py-[7px] px-2.5 rounded-md border border-brd bg-inp text-t1 text-[length:calc(var(--ui-font-size)-2px)] outline-none font-ui"
          value={chatBaseUrl}
          onChange={(e) => setChatBaseUrl(e.target.value)}
          placeholder={entry.defaultBaseUrl ?? t('settings:models.baseUrl.placeholder')}
          autoCapitalize="off"
        />
      </div>
      <div style={{ display: 'flex', gap: 7, alignItems: 'center', marginTop: 8 }}>
        <button
          className="btn btn-g btn-sm"
          disabled={chatTestStatus.testing || (entry.requiresApiKey && !chatApiKey) || !entry.backendReady}
          onClick={async () => {
            if (!entry.backendReady) {
              setChatTestStatus({ testing: false, result: { success: false, message: t('settings:models.backendNotReady') } });
              setTimeout(() => setChatTestStatus((s) => ({ ...s, result: undefined })), 6000);
              return;
            }
            setChatTestStatus({ testing: true });
            try {
              const result = await testChatConnection({
                provider: chatProvider,
                model: chatModel || entry.placeholderModel,
                apiKey: chatApiKey,
                baseUrl: chatBaseUrl || undefined,
                azureDeploymentId: chatAzureDeploymentId || undefined,
                azureApiVersion: chatAzureApiVersion || undefined,
              });
              setChatTestStatus({ testing: false, result });
              setTimeout(() => setChatTestStatus((s) => ({ ...s, result: undefined })), 6000);
            } catch (err) {
              setChatTestStatus({ testing: false, result: { success: false, message: String(err) } });
              setTimeout(() => setChatTestStatus((s) => ({ ...s, result: undefined })), 6000);
            }
          }}
        >{chatTestStatus.testing ? t('settings:models.test.testing') : t('settings:models.test.label')}</button>
        {chatTestStatus.result && (
          <span style={{ fontSize: 11, color: chatTestStatus.result.success ? 'var(--green, #22a863)' : 'var(--red, #f06a6a)' }}>
            {chatTestStatus.result.success ? '✓ ' : '✗ '}{chatTestStatus.result.message}
          </span>
        )}
      </div>
    </div>
  );
}
