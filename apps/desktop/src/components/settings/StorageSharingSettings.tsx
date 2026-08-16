/**
 * 存储与分享 settings tab. Configures R2 / 七牛云 storage provider
 * credentials (shared by image-hosting paste flow and markdown→HTML
 * share flow). Also houses the global htmlImageMode toggle.
 */
import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { CloudCog, Save, Trash2 } from 'lucide-react';
import { useStorageConfigStore } from '@/services/storage/storageConfigStore';
import { getAllProviders } from '@/services/storage/registry';
import type {
  ProviderConfig,
  R2ProviderConfig,
  QiniuProviderConfig,
} from '@/services/storage/types';
import { isR2Config, isQiniuConfig } from '@/services/storage/types';
import { Toggle } from './primitives';

export function StorageSharingSettings() {
  const { t } = useTranslation();
  const providers = getAllProviders();
  const activeProvider = useStorageConfigStore((s) => s.activeProvider);
  const setActiveProvider = useStorageConfigStore((s) => s.setActiveProvider);
  const configs = useStorageConfigStore((s) => s.configs);
  const saveProviderConfig = useStorageConfigStore((s) => s.saveProviderConfig);
  const removeProviderConfig = useStorageConfigStore((s) => s.removeProviderConfig);
  const htmlImageMode = useStorageConfigStore((s) => s.htmlImageMode);
  const setHtmlImageMode = useStorageConfigStore((s) => s.setHtmlImageMode);

  const activeCfg = configs[activeProvider] ?? null;

  return (
    <div className="mb-8">
      <div className="pb-3 mb-5 border-b border-brd2 flex items-baseline gap-2">
        <CloudCog size={20} className="text-acc" />
        <div className="text-[length:calc(var(--ui-font-size)+3px)] font-bold text-t1 tracking-[-0.01em]">{t('settings:storage.title')}</div>
        <div className="text-[length:calc(var(--ui-font-size)-1px)] text-t3">{t('settings:storage.description')}</div>
      </div>

      {/* Provider selector */}
      <div className="mb-5">
        <div className="text-[length:calc(var(--ui-font-size)-2.5px)] font-semibold text-t2 mb-[5px]">{t('settings:storage.provider.label')}</div>
        <select
          className="settings-select"
          value={activeProvider}
          onChange={(e) => setActiveProvider(e.target.value)}
        >
          {providers.map((p) => {
            const cfg = configs[p.id] ?? null;
            const configured = p.isConfigured(cfg);
            const suffix = configured ? '' : ` (${t('settings:storage.provider.notConfigured')})`;
            return (
              <option key={p.id} value={p.id}>{t(p.labelKey)}{suffix}</option>
            );
          })}
        </select>
      </div>

      {/* Active provider form */}
      {isR2Config(activeCfg) && (
        <R2Form
          cfg={activeCfg}
          onSave={saveProviderConfig}
          onRemove={removeProviderConfig}
          t={t}
        />
      )}
      {isQiniuConfig(activeCfg) && (
        <QiniuForm
          cfg={activeCfg}
          onSave={saveProviderConfig}
          onRemove={removeProviderConfig}
          t={t}
        />
      )}

      {/* HTML image mode (global) */}
      <div className="mt-7 pt-5 border-t border-brd2">
        <div className="text-[length:calc(var(--ui-font-size)-2.5px)] font-semibold text-t2 mb-1">{t('settings:storage.htmlImageMode.label')}</div>
        <div className="text-[11px] text-t3 mb-3">{t('settings:storage.htmlImageMode.help')}</div>
        <div className="flex border border-brd2 rounded-md overflow-hidden">
          {(['inline', 'upload'] as const).map((m) => (
            <button
              key={m}
              type="button"
              className={`flex-1 py-1.5 px-3.5 text-xs font-medium cursor-pointer transition-all duration-150 border-r border-r-brd2 last:border-r-0 ${htmlImageMode === m ? 'bg-acc text-white font-semibold' : 'bg-surf text-t2 hover:bg-hov hover:text-t1'}`}
              onClick={() => setHtmlImageMode(m)}
            >
              {t(`settings:storage.htmlImageMode.${m}`)}
            </button>
          ))}
        </div>
        <div className="text-[11px] text-t3 mt-2 leading-relaxed">
          {t(`settings:storage.htmlImageMode.${htmlImageMode}Desc`)}
        </div>
      </div>
    </div>
  );
}

// ─── Field primitive ─────────────────────────────────────────────────────

function Field({ label, value, onChange, placeholder, type = 'text' }: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: 'text' | 'password';
}) {
  return (
    <div className="mb-3">
      <label className="block text-xs text-t3 mb-1 font-medium">{label}</label>
      <input
        type={type}
        className="w-full py-[6px] px-2.5 border border-brd2 rounded-md bg-surf text-t1 text-[13px] outline-none focus:border-acc focus:shadow-[0_0_0_2px_var(--accdim)]"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoCapitalize="off"
        autoComplete="off"
      />
    </div>
  );
}

// ─── R2 form ─────────────────────────────────────────────────────────────

function R2Form({ cfg, onSave, onRemove, t }: {
  cfg: R2ProviderConfig;
  onSave: (cfg: ProviderConfig) => Promise<void>;
  onRemove: (id: string) => Promise<void>;
  t: (k: string) => string;
}) {
  const [draft, setDraft] = useState<R2ProviderConfig>(cfg);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const set = (patch: Partial<R2ProviderConfig>) => setDraft((d) => ({ ...d, ...patch }));

  useEffect(() => () => {
    if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
  }, []);

  return (
    <div className="p-4 border border-brd2 rounded-lg bg-surf">
      <div className="text-[13px] font-semibold text-t1 mb-3">Cloudflare R2</div>
      <Field label={t('settings:storage.r2.accountId')} value={draft.accountId} onChange={(v) => set({ accountId: v })} placeholder="a1b2c3..." />
      <div className="grid grid-cols-2 gap-3">
        <Field label={t('settings:storage.r2.accessKeyId')} value={draft.accessKeyId} onChange={(v) => set({ accessKeyId: v })} />
        <Field label={t('settings:storage.r2.secretAccessKey')} value={draft.secretAccessKey} onChange={(v) => set({ secretAccessKey: v })} type="password" />
      </div>
      <Field label={t('settings:storage.r2.bucket')} value={draft.bucket} onChange={(v) => set({ bucket: v })} />
      <Field label={t('settings:storage.publicBaseUrl')} value={draft.publicBaseUrl} onChange={(v) => set({ publicBaseUrl: v })} placeholder="https://pub-xxx.r2.dev or https://cdn.example.com" />
      <div className="grid grid-cols-2 gap-3">
        <Field label={t('settings:storage.imageKeyPrefix')} value={draft.imageKeyPrefix} onChange={(v) => set({ imageKeyPrefix: v })} placeholder="images/" />
        <Field label={t('settings:storage.htmlKeyPrefix')} value={draft.htmlKeyPrefix} onChange={(v) => set({ htmlKeyPrefix: v })} placeholder="html/" />
      </div>
      <div className="flex gap-2 mt-3">
        <button
          className="py-[7px] px-[18px] rounded-md text-[13px] font-medium cursor-pointer border-none bg-acc text-white hover:brightness-110 disabled:opacity-50"
          disabled={saving}
          onClick={async () => {
            setSaving(true);
            try {
              await onSave({
                ...draft,
                accountId: draft.accountId.trim(),
                accessKeyId: draft.accessKeyId.trim(),
                secretAccessKey: draft.secretAccessKey.trim(),
                bucket: draft.bucket.trim(),
                publicBaseUrl: draft.publicBaseUrl.trim(),
              });
              setSavedAt(Date.now());
              if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
              savedTimerRef.current = setTimeout(() => setSavedAt(null), 2500);
            } finally { setSaving(false); }
          }}
        >
          <Save size={13} className="inline mr-1" />
          {t('settings:storage.save')}
        </button>
        <button
          className="py-[7px] px-[18px] rounded-md text-[13px] font-medium cursor-pointer border-none bg-surf2 text-t2 hover:bg-brd"
          onClick={() => onRemove('r2')}
        >
          <Trash2 size={13} className="inline mr-1" />
          {t('settings:storage.clear')}
        </button>
        {savedAt !== null && (
          <span className="self-center text-[11px] text-[var(--green,#22a863)]">✓ {t('settings:storage.toast.saved')}</span>
        )}
      </div>
      <div className="text-[11px] text-t3 mt-3 leading-relaxed">{t('settings:storage.r2.publicHint')}</div>
    </div>
  );
}

// ─── Qiniu form ──────────────────────────────────────────────────────────

function QiniuForm({ cfg, onSave, onRemove, t }: {
  cfg: QiniuProviderConfig;
  onSave: (cfg: ProviderConfig) => Promise<void>;
  onRemove: (id: string) => Promise<void>;
  t: (k: string) => string;
}) {
  const [draft, setDraft] = useState<QiniuProviderConfig>(cfg);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const set = (patch: Partial<QiniuProviderConfig>) => setDraft((d) => ({ ...d, ...patch }));

  useEffect(() => () => {
    if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
  }, []);

  return (
    <div className="p-4 border border-brd2 rounded-lg bg-surf">
      <div className="text-[13px] font-semibold text-t1 mb-3">七牛云 Kodo</div>
      <div className="grid grid-cols-2 gap-3">
        <Field label={t('settings:storage.qiniu.accessKey')} value={draft.accessKey} onChange={(v) => set({ accessKey: v })} />
        <Field label={t('settings:storage.qiniu.secretKey')} value={draft.secretKey} onChange={(v) => set({ secretKey: v })} type="password" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label={t('settings:storage.qiniu.bucket')} value={draft.bucket} onChange={(v) => set({ bucket: v })} />
        <div className="mb-3">
          <label className="block text-xs text-t3 mb-1 font-medium">{t('settings:storage.qiniu.region')}</label>
          <select
            className="settings-select"
            value={draft.region}
            onChange={(e) => set({ region: e.target.value as QiniuProviderConfig['region'] })}
          >
            <option value="z0">z0 (East China)</option>
            <option value="z1">z1 (North China)</option>
            <option value="z2">z2 (South China)</option>
            <option value="na0">na0 (North America)</option>
            <option value="as0">as0 (SE Asia / Oceania)</option>
          </select>
        </div>
      </div>
      <Field label={t('settings:storage.publicBaseUrl')} value={draft.publicBaseUrl} onChange={(v) => set({ publicBaseUrl: v })} placeholder="https://cdn.example.com" />
      <div className="grid grid-cols-2 gap-3">
        <Field label={t('settings:storage.imageKeyPrefix')} value={draft.imageKeyPrefix} onChange={(v) => set({ imageKeyPrefix: v })} placeholder="images/" />
        <Field label={t('settings:storage.htmlKeyPrefix')} value={draft.htmlKeyPrefix} onChange={(v) => set({ htmlKeyPrefix: v })} placeholder="html/" />
      </div>
      <div className="flex gap-2 mt-3">
        <button
          className="py-[7px] px-[18px] rounded-md text-[13px] font-medium cursor-pointer border-none bg-acc text-white hover:brightness-110 disabled:opacity-50"
          disabled={saving}
          onClick={async () => {
            setSaving(true);
            try {
              await onSave({
                ...draft,
                accessKey: draft.accessKey.trim(),
                secretKey: draft.secretKey.trim(),
                bucket: draft.bucket.trim(),
                publicBaseUrl: draft.publicBaseUrl.trim(),
              });
              setSavedAt(Date.now());
              if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
              savedTimerRef.current = setTimeout(() => setSavedAt(null), 2500);
            } finally { setSaving(false); }
          }}
        >
          <Save size={13} className="inline mr-1" />
          {t('settings:storage.save')}
        </button>
        <button
          className="py-[7px] px-[18px] rounded-md text-[13px] font-medium cursor-pointer border-none bg-surf2 text-t2 hover:bg-brd"
          onClick={() => onRemove('qiniu')}
        >
          <Trash2 size={13} className="inline mr-1" />
          {t('settings:storage.clear')}
        </button>
        {savedAt !== null && (
          <span className="self-center text-[11px] text-[var(--green,#22a863)]">✓ {t('settings:storage.toast.saved')}</span>
        )}
      </div>
      <div className="text-[11px] text-t3 mt-3 leading-relaxed">{t('settings:storage.qiniu.publicHint')}</div>
    </div>
  );
}
