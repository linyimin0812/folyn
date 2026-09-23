/**
 * Collectors settings tab (design §7.3): per-collector enable/poll toggles,
 * authSchema-rendered config form (values persisted via
 * activityCollectorStore), manual「立即采集」, last-sync info, and the
 * entity-type registration conflict badge (design §3.4). Install/permission
 * confirmation flows through the existing extension consent modal
 * (hostAllowlist already renders there) — this tab manages collectors of
 * ACTIVE extensions only.
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import i18n from '@/i18n';
import { Play, TriangleAlert } from 'lucide-react';
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
function ConfigForm({ reg }: { reg: CollectorRegistration }) {
  const { t } = useTranslation();
  const schema = reg.authSchema;
  const config = useActivityCollectorStore((s) => s.configs[reg.collectorId]);
  const setCollectorConfig = useActivityCollectorStore((s) => s.setCollectorConfig);
  const [draft, setDraft] = useState<Record<string, unknown>>(() => ({ ...(config ?? {}) }));
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
          <label key={key} className="block mb-2.5">
            <span className="block text-[11px] text-t2 mb-1">{label}</span>
            {prop.enum ? (
              <select
                className="w-full text-[length:calc(var(--ui-font-size)-1px)] bg-surf2 border border-brd2 rounded-md px-2 py-1 text-t1"
                value={String(value)}
                onChange={(e) => setDraft({ ...draft, [key]: e.target.value })}
              >
                {prop.enum.map((v) => (
                  <option key={v} value={v}>{v}</option>
                ))}
              </select>
            ) : prop.type === 'boolean' ? (
              <Toggle
                value={value === true}
                onChange={(v) => setDraft({ ...draft, [key]: v })}
              />
            ) : (
              <input
                className="w-full text-[length:calc(var(--ui-font-size)-1px)] bg-surf2 border border-brd2 rounded-md px-2 py-1 text-t1"
                type={prop.type === 'number' ? 'number' : 'text'}
                value={String(value)}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    [key]: prop.type === 'number' ? Number(e.target.value) : e.target.value,
                  })
                }
              />
            )}
          </label>
        );
      })}
      <button className="btn btn-g btn-sm" onClick={() => setCollectorConfig(reg.collectorId, draft)}>
        {t('activity:collectors.save')}
      </button>
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
  // Select the stable array ref and derive in render (state-management spec:
  // a `.filter` in the selector mints a fresh array every call → re-render loop).
  const allConflicts = useCollectorRegistryStore((s) => s.conflicts);
  const conflicts = allConflicts.filter((c) => c.extensionId === reg.extensionId);
  const [busy, setBusy] = useState(false);

  const intervalMin = Math.round(effectiveIntervalMs(reg.pollIntervalMs, settings.intervalOverrideMs) / 60_000);

  const onCollectNow = async () => {
    setBusy(true);
    try {
      await collectNow(reg.collectorId);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="border border-brd rounded-lg p-3 mb-2 bg-surf">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[length:calc(var(--ui-font-size)-1px)] font-semibold text-t1 truncate">
              {reg.extensionName ?? reg.extensionId}
            </span>
            <span className="text-[10px] text-t3 font-mono truncate">{reg.collectorId}</span>
            <span className="text-[10px] px-1.5 py-0.5 rounded border border-brd2 text-t2 bg-surf2">
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
            <div className="text-[11px] text-t3 mt-0.5">{t('activity:collectors.noImpl')}</div>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-[11px] text-t3">
            {settings.enabled ? t('activity:collectors.enabled') : t('activity:collectors.disabled')}
          </span>
          <Toggle
            value={settings.enabled}
            onChange={(v) => setCollectorSettings(reg.collectorId, { enabled: v })}
          />
        </div>
      </div>

      {reg.mode === 'webhook' && webhookEndpoint && (
        <div className="mt-2.5 text-[11px] text-t3">
          {t('activity:collectors.webhookEndpoint')}:{' '}
          <span className="font-mono text-t2 select-all">
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
            <span className="text-[11px] text-t3">
              {settings.pollOn
                ? t('activity:collectors.pollEvery', { min: intervalMin })
                : t('activity:collectors.pollOff')}
            </span>
          </label>
          <label className="flex items-center gap-1 text-[11px] text-t2 m-0">
            {t('activity:collectors.intervalMinutes')}
            <input
              className="w-16 text-[11px] bg-surf2 border border-brd2 rounded-md px-1.5 py-0.5 text-t1"
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
          <button
            className="btn btn-g btn-sm inline-flex items-center gap-1.5"
            disabled={busy || !settings.enabled || !reg.impl}
            onClick={() => void onCollectNow()}
          >
            <Play size={11} />
            {t('activity:collectors.collectNow')}
          </button>
        </div>
      )}

      <div className="text-[11px] text-t3 mt-2">
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
      </div>

      <ConfigForm reg={reg} />
    </div>
  );
}

export function CollectorsSettings() {
  const { t } = useTranslation();
  const collectors = useCollectorRegistryStore((s) => s.collectors);
  // Webhook endpoint (Rust activity_webhook_info) — only shown for
  // webhook-mode collectors; empty when the local server isn't running.
  const hasWebhook = collectors.some((c) => c.mode === 'webhook');
  const { data: webhookInfo } = useAsync<WebhookInfo>(
    () => (hasWebhook ? invoke<WebhookInfo>('activity_webhook_info') : Promise.resolve({ enabled: false })),
    [hasWebhook],
  );
  const webhookEndpoint = webhookInfo?.endpoint ?? '';

  return (
    <div>
      {collectors.length === 0 ? (
        <div className="text-[12px] text-t3 bg-surf2 border border-brd2 rounded-md p-4 text-center">
          {t('activity:collectors.empty')}
        </div>
      ) : (
        collectors.map((reg) => (
          <CollectorCard key={reg.collectorId} reg={reg} webhookEndpoint={webhookEndpoint} />
        ))
      )}
    </div>
  );
}
