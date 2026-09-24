/**
 * Collectors settings tab (design §7.3): per-collector enable/poll toggles,
 * authSchema-rendered config form (values persisted via
 * activityCollectorStore), manual「立即采集」, last-sync info, and the
 * entity-type registration conflict badge (design §3.4). Install/permission
 * confirmation flows through the existing extension consent modal
 * (hostAllowlist already renders there) — this tab manages collectors of
 * ACTIVE extensions only. A second「商店」tab lists catalog entries with
 * `type: 'collector'` (reuses StoreEntryCard + the shared extension catalog).
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import i18n from '@/i18n';
import { Check, Loader2, Play, TriangleAlert } from 'lucide-react';
import { isTauri } from '@/utils/platform';
import { useShallow } from 'zustand/react/shallow';
import { useExtensionStore } from '@/store/extensionStore';
import { StoreEntryCard } from '@/components/settings/ExtensionsSettings';
import { useCollectorRegistryStore, type CollectorRegistration } from '@/services/activity/registry';
import { collectNow, effectiveIntervalMs } from '@/services/activity/runtime';
import {
  getCollectorSettings,
  useActivityCollectorStore,
} from '@/store/activityCollectorStore';
import { Toggle } from '@/components/settings/primitives';
import { invoke } from '@/services/tauriInvoke';
import { useAsync } from '@/hooks/useAsync';

interface WebhookInfo {
  enabled: boolean;
  port?: number | null;
  endpoint?: string | null;
}

/** authSchema-rendered config form. Draft + save (prototype interaction). */
function ConfigForm({
  reg,
  footerExtra,
  footerLeft,
}: { reg: CollectorRegistration; footerExtra?: ReactNode; footerLeft?: ReactNode }) {
  const { t } = useTranslation();
  const schema = reg.authSchema;
  const config = useActivityCollectorStore((s) => s.configs[reg.collectorId]);
  const setCollectorConfig = useActivityCollectorStore((s) => s.setCollectorConfig);
  const [draft, setDraft] = useState<Record<string, unknown>>(() => ({ ...(config ?? {}) }));
  const [saved, setSaved] = useState(false);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (savedTimer.current) clearTimeout(savedTimer.current);
  }, []);
  const onSave = () => {
    setCollectorConfig(reg.collectorId, draft);
    setSaved(true);
    if (savedTimer.current) clearTimeout(savedTimer.current);
    savedTimer.current = setTimeout(() => setSaved(false), 900);
  };
  if (!schema || Object.keys(schema.properties).length === 0) return null;

  return (
    <div className="mt-2">
      <p className="m-0 mb-2 text-[11px] font-semibold text-t2">
        {t('activity:collectors.configTitle')}
      </p>
      {Object.entries(schema.properties).map(([key, prop]) => {
        const value = draft[key] ?? prop.default ?? '';
        const label = prop.title ?? key;
        return (
          <label
            key={key}
            className={prop.type === 'boolean' && !prop.enum
              ? 'flex items-center gap-1.5 mb-2.5'
              : 'block mb-2.5'}
          >
            {prop.enum ? (
              <>
                <span className="block text-[11px] text-t2 mb-1">{label}</span>
                <select
                  className="w-full text-[length:calc(var(--ui-font-size)-1px)] bg-panel border border-brd2 rounded-md px-2 py-1 text-t1 outline-none transition-[border-color] duration-100 focus:border-acc"
                  value={String(value)}
                  onChange={(e) => setDraft({ ...draft, [key]: e.target.value })}
                >
                  {prop.enum.map((v) => (
                    <option key={v} value={v}>{v}</option>
                  ))}
                </select>
              </>
            ) : prop.type === 'boolean' ? (
              <>
                <Toggle
                  value={value === true}
                  onChange={(v) => setDraft({ ...draft, [key]: v })}
                />
                <span className="text-[11px] text-t2">{label}</span>
              </>
            ) : (
              <>
                <span className="block text-[11px] text-t2 mb-1">{label}</span>
                <input
                  className="w-full text-[length:calc(var(--ui-font-size)-1px)] bg-panel border border-brd2 rounded-md px-2 py-1 text-t1 outline-none transition-[border-color] duration-100 focus:border-acc"
                  type={prop.type === 'number' ? 'number' : 'text'}
                  value={String(value)}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      [key]: prop.type === 'number' ? Number(e.target.value) : e.target.value,
                    })
                  }
                />
              </>
            )}
          </label>
        );
      })}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        {footerLeft && <div className="min-w-0 text-[11px] text-t2 flex items-center gap-2 flex-wrap">{footerLeft}</div>}
        <div className="flex gap-2">
          {footerExtra}
          <button className="btn btn-g btn-sm" onClick={onSave}>
            {saved && <Check size={11} />}
            {t('activity:collectors.save')}
          </button>
        </div>
      </div>
    </div>
  );
}

function CollectorCard({ reg, webhookEndpoint }: { reg: CollectorRegistration; webhookEndpoint: string }) {
  const { t } = useTranslation();
  const settings = useActivityCollectorStore((s) =>
    getCollectorSettings(s, reg.collectorId),
  );
  const setCollectorSettings = useActivityCollectorStore((s) => s.setCollectorSettings);
  const lastSync = useActivityCollectorStore((s) => s.lastSync[reg.collectorId]);
  // Live progress from the collector's ctx.onProgress (cleared when the run
  // ends) — locale-neutral string from the collector, label localized here.
  const collectProgress = useActivityCollectorStore((s) => s.collectProgress[reg.collectorId]);
  const uninstall = useExtensionStore((s) => s.uninstall);
  const uninstallBusy = useExtensionStore(useShallow((s) => !!s.busy[`${reg.extensionId}:uninstall`]));
  // Select the stable array ref and derive in render (state-management spec:
  // a `.filter` in the selector mints a fresh array every call → re-render loop).
  const allConflicts = useCollectorRegistryStore((s) => s.conflicts);
  const conflicts = allConflicts.filter((c) => c.extensionId === reg.extensionId);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ error: boolean; text: string } | null>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
  }, []);

  const intervalMin = Math.round(effectiveIntervalMs(reg.pollIntervalMs, settings.intervalOverrideMs) / 60_000);

  const onCollectNow = async () => {
    setBusy(true);
    try {
      // null = skipped (not installed/enabled, no vault) or failed — same message.
      const outcome = await collectNow(reg.collectorId);
      setNotice(
        outcome === null
          ? { error: true, text: t('activity:collectors.collectFailed') }
          : {
              error: false,
              text: t('activity:collectors.collectResult', {
                accepted: outcome.accepted,
                deduped: outcome.deduped,
              }),
            },
      );
      if (noticeTimer.current) clearTimeout(noticeTimer.current);
      noticeTimer.current = setTimeout(() => setNotice(null), 5_000);
    } finally {
      setBusy(false);
    }
  };

  const onUninstall = useCallback(async () => {
    if (!isTauri()) {
      void uninstall(reg.extensionId);
      return;
    }
    const { confirm } = await import('@tauri-apps/plugin-dialog');
    const ok = await confirm(t('settings:extensions.uninstallConfirm.message'), {
      title: t('settings:extensions.uninstallConfirm.title'),
      okLabel: t('settings:extensions.uninstallConfirm.confirm'),
      cancelLabel: t('settings:extensions.uninstallConfirm.cancel'),
    });
    if (!ok) return;
    void uninstall(reg.extensionId);
  }, [reg.extensionId, uninstall, t]);

  // 立即采集 lives in the card footer, left of 保存 (ConfigForm's save). Poll
  // mode only — webhook collectors push on arrival, no manual trigger.
  const collectNowButton = reg.mode === 'poll' ? (
    <button
      className="btn btn-g btn-sm inline-flex items-center gap-1.5 active:scale-95"
      disabled={busy || !settings.enabled || !reg.impl}
      onClick={() => void onCollectNow()}
    >
      {busy ? <Loader2 size={11} className="animate-spin" /> : <Play size={11} />}
      {t('activity:collectors.collectNow')}
    </button>
  ) : null;
  // ConfigForm returns null when the schema has no properties — a schemaless
  // poll collector still needs the footer row.
  const hasConfigFields = !!(reg.authSchema && Object.keys(reg.authSchema.properties).length > 0);

  // Status text (last sync / progress / notice) merged into the footer action
  // row — left side, right of it the collect-now + save buttons.
  const statusContent = (
    <>
      <span>
        {lastSync?.at === undefined
          ? t('activity:collectors.neverSynced')
          : t('activity:collectors.lastSync', {
              time:
                Date.now() - lastSync.at < 60_000
                  ? t('activity:collectors.justNow')
                  : new Intl.DateTimeFormat(i18n.language, {
                      month: 'short',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    }).format(new Date(lastSync.at)),
              count: lastSync.accepted,
            })}
      </span>
      {collectProgress && (
        <span>{t('activity:collectors.collecting')} {collectProgress}</span>
      )}
      {notice && (
        <span className={notice.error ? 'text-red-600 dark:text-red-400' : 'text-acc'}>
          {notice.text}
        </span>
      )}
    </>
  );

  return (
    <div className="border border-brd rounded-lg p-3 mb-2 bg-surf">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[length:calc(var(--ui-font-size)-1px)] font-semibold text-t1 truncate">
              {reg.extensionName ?? reg.extensionId}
            </span>
            <span className="text-[10px] text-t3 font-mono truncate">{reg.collectorId}</span>
            <span
              className={
                reg.mode === 'poll'
                  ? 'text-[10px] px-1.5 py-0.5 rounded border border-acc/30 text-acc bg-accdim'
                  : 'text-[10px] px-1.5 py-0.5 rounded border border-green-500/30 text-green-600 dark:text-green-400 bg-green-500/15'
              }
            >
              {t(reg.mode === 'poll' ? 'activity:collectors.modePoll' : 'activity:collectors.modeWebhook')}
            </span>
            {conflicts.length > 0 && (
              <span
                className="text-[10px] px-1.5 py-0.5 rounded border border-amber/40 text-amber-700 dark:text-amber-400 bg-amber/10 inline-flex items-center gap-1"
                title={conflicts.map((c) => `${c.typeId} → ${c.winner}`).join('\n')}
              >
                <TriangleAlert size={10} />
                {t('activity:collectors.conflictBadge')}
              </span>
            )}
          </div>
          {!reg.impl && (
            <div className="text-[11px] text-t2 mt-0.5">{t('activity:collectors.noImpl')}</div>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            className="btn btn-sm text-t3 hover:text-red-600 dark:hover:text-red-400"
            disabled={uninstallBusy}
            onClick={() => void onUninstall()}
          >
            {uninstallBusy
              ? t('settings:extensions.uninstalling')
              : t('settings:extensions.uninstall')}
          </button>
          <span className="text-[11px] text-t2">
            {settings.enabled ? t('activity:collectors.enabled') : t('activity:collectors.disabled')}
          </span>
          <Toggle
            value={settings.enabled}
            onChange={(v) => setCollectorSettings(reg.collectorId, { enabled: v })}
          />
        </div>
      </div>

      {reg.mode === 'webhook' && webhookEndpoint && (
        <div className="mt-2.5 text-[11px] text-t2">
          {t('activity:collectors.webhookEndpoint')}:{' '}
          <span className="font-mono text-t1 select-all">
            POST {webhookEndpoint}/{reg.collectorId}
          </span>
        </div>
      )}

      {reg.mode === 'poll' && (
        <div className="mt-2.5 flex items-center gap-3 flex-wrap">
          <label className="flex items-center gap-1.5 text-[length:calc(var(--ui-font-size)-1px)] text-t1 cursor-pointer m-0">
            <Toggle
              value={settings.pollOn}
              onChange={(v) => setCollectorSettings(reg.collectorId, { pollOn: v })}
            />
            {t('activity:collectors.pollLabel')}
            <span className="text-[11px] text-t1">
              {settings.pollOn
                ? t('activity:collectors.pollEvery', { min: intervalMin })
                : t('activity:collectors.pollOff')}
            </span>
          </label>
          <label className="flex items-center gap-1 text-[11px] text-t1 m-0">
            {t('activity:collectors.intervalMinutes')}
            <input
              className="w-20 text-[length:calc(var(--ui-font-size)-1px)] bg-panel border border-brd2 rounded-md px-2 py-1 text-t1"
              type="number"
              min={1}
              value={settings.intervalOverrideMs ? Math.round(settings.intervalOverrideMs / 60_000) : ''}
              placeholder={String(Math.round((reg.pollIntervalMs ?? 60_000) / 60_000))}
              onChange={(e) => {
                const n = Number(e.target.value);
                setCollectorSettings(reg.collectorId, {
                  intervalOverrideMs: n >= 1 ? n * 60_000 : undefined,
                });
              }}
            />
          </label>
        </div>
      )}

      {hasConfigFields ? (
        <ConfigForm reg={reg} footerExtra={collectNowButton} footerLeft={statusContent} />
      ) : (
        <div className="mt-2 flex items-center justify-between gap-3 flex-wrap">
          <div className="min-w-0 text-[11px] text-t2 flex items-center gap-2 flex-wrap">{statusContent}</div>
          {collectNowButton}
        </div>
      )}
    </div>
  );
}

export function CollectorsSettings() {
  const { t } = useTranslation();
  const collectors = useCollectorRegistryStore((s) => s.collectors);
  const installing = useExtensionStore((s) => s.installing);
  const error = useExtensionStore((s) => s.error);
  const clearError = useExtensionStore((s) => s.clearError);
  const installFromFolder = useExtensionStore((s) => s.installFromFolder);
  const installFromZip = useExtensionStore((s) => s.installFromZip);
  const refresh = useExtensionStore((s) => s.refresh);
  // Store (catalog) selectors — the store tab shares the extension catalog and
  // filters to `type === 'collector'` in render (stable-array selector rule).
  const catalog = useExtensionStore((s) => s.catalog);
  const catalogLoading = useExtensionStore((s) => s.catalogLoading);
  const catalogError = useExtensionStore((s) => s.catalogError);
  const fetchCatalog = useExtensionStore((s) => s.fetchCatalog);
  const [folderOpen, setFolderOpen] = useState(false);
  const [zipOpen, setZipOpen] = useState(false);
  // Tab is component-local UI state (only this component reads it) — useState
  // per state-management.md, no store.
  const [tab, setTab] = useState<'collectors' | 'store'>('collectors');

  // Refresh the installed-extension rows on mount so store cards can show
  // their installed state (the registry store alone doesn't know rows).
  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Lazy-load the catalog when the user switches to the store tab and it's
  // not loaded yet (same pattern as ExtensionsSettings).
  useEffect(() => {
    if (tab === 'store' && !catalogLoading && catalog.length === 0 && !catalogError) {
      void fetchCatalog();
    }
  }, [tab, catalogLoading, catalog.length, catalogError, fetchCatalog]);

  const storeEntries = catalog.filter((e) => e.type === 'collector');

  const handleInstallFromFolder = useCallback(async () => {
    if (folderOpen) return;
    setFolderOpen(true);
    clearError();
    try {
      if (!isTauri()) {
        return;
      }
      const { open } = await import('@tauri-apps/plugin-dialog');
      const picked = await open({ directory: true, multiple: false });
      if (!picked || Array.isArray(picked)) return;
      await installFromFolder(picked as string);
      // Refresh so a newly activated collector's registration shows up here.
      await refresh();
    } finally {
      setFolderOpen(false);
    }
  }, [folderOpen, installFromFolder, clearError, refresh]);

  const handleInstallFromZip = useCallback(async () => {
    if (zipOpen) return;
    setZipOpen(true);
    clearError();
    try {
      if (!isTauri()) {
        return;
      }
      const { open } = await import('@tauri-apps/plugin-dialog');
      const picked = await open({
        filters: [{ name: 'Extension zip', extensions: ['zip'] }],
        multiple: false,
      });
      if (!picked || Array.isArray(picked)) return;
      await installFromZip(picked as string);
      await refresh();
    } finally {
      setZipOpen(false);
    }
  }, [zipOpen, installFromZip, clearError, refresh]);

  // Webhook endpoint (Rust activity_webhook_info) — only shown for
  // webhook-mode collectors; empty when the local server isn't running.
  const hasWebhook = collectors.some((c) => c.mode === 'webhook');
  const { data: webhookInfo } = useAsync<WebhookInfo>(
    () => (hasWebhook ? invoke<WebhookInfo>('activity_webhook_info') : Promise.resolve({ enabled: false })),
    [hasWebhook],
  );
  const webhookEndpoint = webhookInfo?.endpoint ?? '';

  return (
    <div className="max-w-[720px]">
      {/* Tab bar — same styling as the ExtensionsSettings tabs. */}
      <div className="flex items-center gap-1 mb-3 border-b border-brd2">
        <button
          className={`px-3 py-1.5 text-[length:calc(var(--ui-font-size)-1px)] font-medium border-b-2 -mb-px ${tab === 'collectors' ? 'border-acc text-t1' : 'border-transparent text-t3 hover:text-t2'}`}
          onClick={() => setTab('collectors')}
        >
          {t('activity:collectors.tab')}
        </button>
        <button
          className={`px-3 py-1.5 text-[length:calc(var(--ui-font-size)-1px)] font-medium border-b-2 -mb-px ${tab === 'store' ? 'border-acc text-t1' : 'border-transparent text-t3 hover:text-t2'}`}
          onClick={() => setTab('store')}
        >
          {t('settings:extensions.store.tabStore')}
        </button>
      </div>

      {tab === 'store' ? (
        <>
          <div className="flex items-center gap-2 mb-3">
            <button className="btn btn-g btn-sm" disabled={catalogLoading} onClick={() => void fetchCatalog()}>
              {catalogLoading ? t('settings:extensions.store.refreshing') : t('settings:extensions.store.refresh')}
            </button>
          </div>

          {(error || catalogError) && (
            <div className="bg-red-500/10 border border-red-500/30 text-red-600 dark:text-red-400 text-[11px] rounded-md p-2 mb-3 break-words">
              {error || catalogError}
            </div>
          )}

          {storeEntries.length === 0 ? (
            <div className="text-[12px] text-t2 bg-surf2 border border-brd2 rounded-md p-4 text-center">
              {catalogLoading ? t('settings:extensions.store.refreshing') : t('settings:extensions.store.empty')}
            </div>
          ) : (
            <div>
              {storeEntries.map((entry) => (
                <StoreEntryCard key={entry.id} entry={entry} />
              ))}
            </div>
          )}
        </>
      ) : (
        <>
          <div className="mb-3 flex gap-2 flex-wrap">
            <button
              className="btn btn-p btn-sm"
              disabled={!!installing || folderOpen || zipOpen || !isTauri()}
              onClick={handleInstallFromFolder}
            >
              {installing
                ? t('settings:extensions.installing', { id: installing.id })
                : t('activity:collectors.install')}
            </button>
            <button
              className="btn btn-g btn-sm"
              disabled={!!installing || folderOpen || zipOpen || !isTauri()}
              onClick={handleInstallFromZip}
            >
              {installing
                ? t('settings:extensions.installing', { id: installing.id })
                : t('activity:collectors.installZip')}
            </button>
            {error && (
              <div className="bg-red-500/10 border border-red-500/30 text-red-600 dark:text-red-400 text-[11px] rounded-md p-2 mb-3 break-words">
                {error}
              </div>
            )}
          </div>
          {collectors.length === 0 ? (
            <div className="text-[12px] text-t2 bg-surf2 border border-brd2 rounded-md p-4 text-center">
              {t('activity:collectors.empty')}
            </div>
          ) : (
            collectors.map((reg) => (
              <CollectorCard key={reg.collectorId} reg={reg} webhookEndpoint={webhookEndpoint} />
            ))
          )}
        </>
      )}
    </div>
  );
}
