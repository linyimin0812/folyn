/**
 * Right section of ModelServicesSettings — header (avatar + name + badges
 * + enable toggle) + api key + base url + azure fields + model list
 * (selected group + manual group) + info links + set-as-chat button.
 * Pure code motion out of the main file; no behavior change.
 */

import { useTranslation } from 'react-i18next';
import { Plus } from 'lucide-react';
import {
  providerDisplayName,
  type ProviderEntry,
} from '@/services/providers/catalog';
import { buildPreviewUrl } from '@/services/providers/providersCatalog';
import type { Model } from '@/services/modelRegistry/types';
import type { ChatTestStatus } from './TestChatModal';
import { Toggle } from '../primitives';
import {
  familyGroup,
  ModelAvatar,
  CapabilityPills,
  Avatar,
} from './helpers';

interface ProviderDetailSectionProps {
  entry: ProviderEntry;
  entryEnabled: boolean;
  chatProvider: string;
  chatModel: string;
  chatApiKey: string;
  chatBaseUrl: string;
  chatAzureApiVersion: string;
  showChatKey: boolean;
  requiresApiKey: boolean;
  requiresAzureFields: boolean;
  apiKeyUrl: string | null;
  providersJsonBaseUrl: string | null;
  providersJsonPath: string | null;
  docsUrl: string | null;
  modelsUrl: string | null;
  isCustom: boolean;
  chatTestStatus: ChatTestStatus;
  selectedModelIds: readonly string[];
  manualForCurrent: readonly { id: string; displayName: string; group: string; createdAt: number }[];
  modelsForCurrent: readonly Model[];
  fetchStatusForCurrent: string;
  manualCollapsed: Set<string>;
  canFetchModels: boolean;
  testButtonDisabled: boolean;
  onSetChatProvider: (id: string) => void;
  onSetChatModel: (id: string) => void;
  onSetChatApiKey: (v: string) => void;
  onSetChatBaseUrl: (v: string) => void;
  onSetChatAzureApiVersion: (v: string) => void;
  onSetProviderEnabled: (v: boolean) => void;
  onToggleShowChatKey: () => void;
  onResetBaseUrl: () => void;
  onRemoveSelectedModel: (id: string) => void;
  onRemoveManualModel: (id: string) => void;
  onToggleManualCollapsed: (key: string) => void;
  onOpenPicker: () => void;
  onOpenManualModal: () => void;
  onOpenTestModal: () => void;
}

export function ProviderDetailSection({
  entry,
  entryEnabled,
  chatProvider,
  chatModel,
  chatApiKey,
  chatBaseUrl,
  chatAzureApiVersion,
  showChatKey,
  requiresApiKey,
  requiresAzureFields,
  apiKeyUrl,
  providersJsonBaseUrl,
  providersJsonPath,
  docsUrl,
  modelsUrl,
  isCustom,
  chatTestStatus,
  selectedModelIds,
  manualForCurrent,
  modelsForCurrent,
  fetchStatusForCurrent,
  manualCollapsed,
  canFetchModels,
  testButtonDisabled,
  onSetChatProvider,
  onSetChatModel,
  onSetChatApiKey,
  onSetChatBaseUrl,
  onSetChatAzureApiVersion,
  onSetProviderEnabled,
  onToggleShowChatKey,
  onResetBaseUrl,
  onRemoveSelectedModel,
  onRemoveManualModel,
  onToggleManualCollapsed,
  onOpenPicker,
  onOpenManualModal,
  onOpenTestModal,
}: ProviderDetailSectionProps) {
  const { t } = useTranslation();

  return (
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
          onChange={onSetProviderEnabled}
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
                onChange={(e) => onSetChatApiKey(e.target.value)}
                placeholder="sk-…"
                autoCapitalize="off"
                autoComplete="off"
              />
              <button
                type="button"
                aria-label={showChatKey ? t('settings:models.apiKey.hide') : t('settings:models.apiKey.show')}
                title={showChatKey ? t('settings:models.apiKey.hide') : t('settings:models.apiKey.show')}
                className="absolute right-1 top-1/2 -translate-y-1/2 w-[26px] h-[26px] flex items-center justify-center rounded bg-transparent border-none text-t3 cursor-pointer hover:bg-hov hover:text-t1"
                onClick={onToggleShowChatKey}
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
              disabled={testButtonDisabled}
              onClick={onOpenTestModal}
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
            onChange={(e) => onSetChatBaseUrl(e.target.value)}
            placeholder={providersJsonBaseUrl ?? t('settings:models.baseUrl.placeholder')}
            autoCapitalize="off"
          />
          {!isCustom && providersJsonBaseUrl && chatBaseUrl !== '' && (
            <button
              type="button"
              onClick={onResetBaseUrl}
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
            onChange={(e) => onSetChatAzureApiVersion(e.target.value)}
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
              onClick={onOpenPicker}
              disabled={!canFetchModels}
            >
              {fetchStatusForCurrent === 'loading' ? t('settings:models.fetchModels.fetching') : t('settings:models.fetchModels.label')}
            </button>
            <button
              type="button"
              className="btn btn-g btn-sm"
              onClick={onOpenManualModal}
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
                      onClick={() => onToggleManualCollapsed(key)}
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
                              onClick={() => onSetChatModel(mid)}
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
                                    onRemoveSelectedModel(mid);
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
          type ManualItem = { id: string; displayName: string; group: string; createdAt: number };
          const groups = (() => {
            const map = new Map<string, ManualItem[]>();
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
                      onClick={() => onToggleManualCollapsed(g.name)}
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
                              onClick={() => onSetChatModel(m.id)}
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
                                    onRemoveManualModel(m.id);
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
            onClick={() => onSetChatProvider(entry.id)}
          >
            {t('settings:models.setAsChat')}
          </button>
        </div>
      )}
    </section>
  );
}
