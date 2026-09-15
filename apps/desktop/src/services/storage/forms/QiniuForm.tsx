/**
 * Qiniu Kodo config form for Settings → Storage & Sharing. Self-contained:
 * owns its draft state, calls `useTranslation()` internally, narrows the
 * opaque saved config to {@link QiniuProviderConfig}.
 */
import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Save, Trash2 } from 'lucide-react';
import type { StorageConfigFormProps } from 'folyn-extension-sdk';
import type { QiniuProviderConfig } from '../types';
import { defaultQiniuConfig } from '../storageConfigStorage';
import { ThemeIcon } from '@/components/icons/ThemeIcon';
import { Field, Hint } from './shared';

export function QiniuForm({ config, onSave, onRemove }: StorageConfigFormProps) {
  const { t } = useTranslation();
  const initial = (config as QiniuProviderConfig | null) ?? defaultQiniuConfig();
  const [draft, setDraft] = useState<QiniuProviderConfig>({ ...initial, provider: 'qiniu' });
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const set = (patch: Partial<QiniuProviderConfig>) => setDraft((d) => ({ ...d, ...patch }));

  useEffect(() => () => {
    if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
  }, []);

  return (
    <div className="p-4 border border-brd2 rounded-lg bg-surf">
      <div className="flex items-center gap-2 mb-3">
        <ThemeIcon name="qiniu" size={16} />
        <div className="text-[13px] font-semibold text-t1">{t('settings:storage.provider.qiniu.label')}</div>
      </div>
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
            <option value="z0">{t('settings:storage.qiniu.regionOption.z0')}</option>
            <option value="z1">{t('settings:storage.qiniu.regionOption.z1')}</option>
            <option value="z2">{t('settings:storage.qiniu.regionOption.z2')}</option>
            <option value="na0">{t('settings:storage.qiniu.regionOption.na0')}</option>
            <option value="as0">{t('settings:storage.qiniu.regionOption.as0')}</option>
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
          onClick={() => onRemove()}
        >
          <Trash2 size={13} className="inline mr-1" />
          {t('settings:storage.clear')}
        </button>
        {savedAt !== null && (
          <span className="self-center text-[11px] text-[var(--green,#22a863)]">✓ {t('settings:storage.toast.saved')}</span>
        )}
      </div>
      <Hint i18nKey="settings:storage.qiniu.publicHint" />
    </div>
  );
}
