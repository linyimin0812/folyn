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

import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAiConfigStore } from '@/store/aiConfigStore';
import {
  PROVIDER_CATALOG,
  allProviders,
  getProviderEntryIncludingCustom,
  isCustomProvider,
  providerApiKeyUrl,
  providerBaseUrl,
  providerDisplayName,
  providerPlaceholderModel,
  providerRequiresApiKey,
  providerRequiresAzureFields,
  type ProviderEntry,
} from '@/services/providers/catalog';
import { refetchAllFromModelsDev } from '@/services/modelRegistry/userProvidersCatalog';
import { useModelRegistryStore, canFetchModelsFromStore } from '@/store/modelRegistryStore';
import type { Model } from '@/services/modelRegistry/types';
import {
  getProviderApiPath,
  getProviderDocsUrl,
  getProviderModelsUrl,
} from '@/services/providers/providersCatalog';
import {
  EMPTY_MODELS,
  EMPTY_MANUAL,
  EMPTY_SELECTED,
} from './model-services/helpers';
import { ProviderListAside } from './model-services/ProviderListAside';
import { ProviderDetailSection } from './model-services/ProviderDetailSection';
import { CustomProviderDrawer, type DrawerState } from './model-services/CustomProviderDrawer';
import { ModelPickerModal } from './model-services/ModelPickerModal';
import { AddManualModelModal } from './model-services/AddManualModelModal';
import { TestChatModal, type ChatTestStatus } from './model-services/TestChatModal';
import { DeleteProviderConfirmDialog } from './model-services/DeleteProviderConfirmDialog';
import { RefetchOverlay, type RefetchStatus } from './model-services/RefetchOverlay';

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
  const [refetchStatus, setRefetchStatus] = useState<RefetchStatus>({ kind: 'idle' });
  const [drawer, setDrawer] = useState<DrawerState | null>(null);
  const [chatTestStatus, setChatTestStatus] = useState<ChatTestStatus>({ testing: false });
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
  const providersJsonPath = isCustomProvider(entry)
    // ponytail: Phase 3 — custom provider path preview dropped. adapterFamily
    // is a bundled id now, not an endpoint key; getEndpointPath would return
    // null for it. Pre-launch OK to not show the path for custom providers.
    ? null
    : getProviderApiPath(entry.id);
  const docsUrl = getProviderDocsUrl(entry.id);
  const modelsUrl = getProviderModelsUrl(entry.id);
  const placeholderModel = providerPlaceholderModel(entry);
  const isCustom = isCustomProvider(entry);
  const entryEnabled = providerSettings[entry.id]?.enabled === true;
  const canFetchModels = canFetchModelsFromStore(entry, chatApiKey);
  const testButtonDisabled =
    chatTestStatus.testing
    || !chatApiKey
    || (!PROVIDER_CATALOG.some((p) => p.id === chatProvider) && !isCustom)
    // ponytail: test needs at least one model to send. Selected models
    // come from the picker; manually-added models set chatModel without
    // entering selectedModelIds. Accept either.
    || (!chatModel && selectedModelIds.length === 0);

  return (
    <div className="h-full flex flex-col">
      <div className="pb-3 mb-3 border-b border-brd2 flex items-baseline gap-2 shrink-0">
        <div className="text-[length:calc(var(--ui-font-size)+3px)] font-bold text-t1 tracking-[-0.01em]">{t('settings:models.title')}</div>
        <div className="text-[length:calc(var(--ui-font-size)-1px)] text-t3">{t('settings:models.description')}</div>
      </div>

      <div className="flex flex-row gap-4 flex-1 min-h-0">
        {/* ── Left: provider list ─────────────────────────────── */}
        <ProviderListAside
          search={search}
          onSearch={setSearch}
          filtered={filtered}
          chatProvider={chatProvider}
          providerSettings={providerSettings}
          refetchStatus={refetchStatus}
          onRefetchAll={async () => {
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
          onSelectProvider={(id) => setChatProvider(id)}
          onEditCustom={(id) => setDrawer({ mode: 'edit', id })}
          onDeleteCustom={(id) => setDeleteConfirmId(id)}
          onAddCustom={() => setDrawer({ mode: 'add' })}
        />

        {/* ── Right: detail ───────────────────────────────────── */}
        <ProviderDetailSection
          entry={entry}
          entryEnabled={entryEnabled}
          chatProvider={chatProvider}
          chatModel={chatModel}
          chatApiKey={chatApiKey}
          chatBaseUrl={chatBaseUrl}
          chatAzureApiVersion={chatAzureApiVersion}
          showChatKey={showChatKey}
          requiresApiKey={requiresApiKey}
          requiresAzureFields={requiresAzureFields}
          apiKeyUrl={apiKeyUrl}
          providersJsonBaseUrl={providersJsonBaseUrl}
          providersJsonPath={providersJsonPath}
          docsUrl={docsUrl}
          modelsUrl={modelsUrl}
          isCustom={isCustom}
          chatTestStatus={chatTestStatus}
          selectedModelIds={selectedModelIds}
          manualForCurrent={manualForCurrent}
          modelsForCurrent={modelsForCurrent}
          fetchStatusForCurrent={fetchStatusForCurrent}
          manualCollapsed={manualCollapsed}
          canFetchModels={canFetchModels}
          testButtonDisabled={testButtonDisabled}
          onSetChatProvider={(id) => setChatProvider(id)}
          onSetChatModel={setChatModel}
          onSetChatApiKey={setChatApiKey}
          onSetChatBaseUrl={setChatBaseUrl}
          onSetChatAzureApiVersion={setChatAzureApiVersion}
          onSetProviderEnabled={(v) => setProviderEnabled(entry.id, v)}
          onToggleShowChatKey={() => setShowChatKey((v) => !v)}
          onResetBaseUrl={() => setChatBaseUrl('')}
          onRemoveSelectedModel={(id) => removeSelectedModelId(chatProvider, id)}
          onRemoveManualModel={(id) => removeManualModel(chatProvider, id)}
          onToggleManualCollapsed={(key) => setManualCollapsed((prev) => {
            const next = new Set(prev);
            if (next.has(key)) next.delete(key);
            else next.add(key);
            return next;
          })}
          onOpenPicker={() => setPickerOpen(true)}
          onOpenManualModal={() => setManualModalOpen(true)}
          onOpenTestModal={() => {
            setTestModelId(selectedModelIds[0] ?? '');
            setChatTestStatus({ testing: false });
            setTestModalOpen(true);
          }}
        />
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
              setChatProvider(id);
            } else {
              updateCustomProvider(drawer.id, data);
            }
            setDrawer(null);
          }}
        />
      )}

      {testModalOpen && (
        <TestChatModal
          open={testModalOpen}
          onClose={() => setTestModalOpen(false)}
          status={chatTestStatus}
          setStatus={setChatTestStatus}
          testModelId={testModelId}
          setTestModelId={setTestModelId}
          chatProvider={chatProvider}
          chatApiKey={chatApiKey}
          chatBaseUrl={chatBaseUrl}
          chatAzureDeploymentId={chatAzureDeploymentId}
          chatAzureApiVersion={chatAzureApiVersion}
          isCustom={isCustom}
          customerProviders={customerProviders}
          placeholderModel={placeholderModel}
          selectedModelIds={selectedModelIds}
        />
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
              isCustom ? customerProviders[chatProvider]?.adapterFamily : undefined,
            );
          }}
        />
      )}

      {manualModalOpen && (
        <AddManualModelModal
          onClose={() => setManualModalOpen(false)}
          onSave={({ id, displayName, group }) => {
            addManualModel(chatProvider, { id, displayName, group });
            addSelectedModelId(chatProvider, id);
            setManualModalOpen(false);
          }}
        />
      )}

      {pendingDeleteProvider && (
        <DeleteProviderConfirmDialog
          provider={pendingDeleteProvider}
          onCancel={() => setDeleteConfirmId(null)}
          onConfirm={() => {
            removeCustomProvider(pendingDeleteProvider.id);
            setDeleteConfirmId(null);
          }}
        />
      )}

      <RefetchOverlay status={refetchStatus} />


    </div>
  );
}

