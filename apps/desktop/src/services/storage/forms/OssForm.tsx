/**
 * Aliyun OSS config form for Settings → Storage & Sharing. Self-contained:
 * owns its draft state, calls `useTranslation()` internally, narrows the
 * opaque saved config to {@link OssProviderConfig}.
 */
import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Save, Trash2, Copy } from 'lucide-react';
import type { StorageConfigFormProps } from 'folyn-extension-sdk';
import type { OssProviderConfig } from '../types';
import { defaultOssConfig } from '../storageConfigStorage';
import { ThemeIcon } from '@/components/icons/ThemeIcon';
import { Field, Hint } from './shared';

export function OssForm({ config, onSave, onRemove }: StorageConfigFormProps) {
  const { t } = useTranslation();
  const initial = (config as OssProviderConfig | null) ?? defaultOssConfig();
  const [draft, setDraft] = useState<OssProviderConfig>({ ...initial, provider: 'oss' });
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [copiedCors, setCopiedCors] = useState(false);
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const set = (patch: Partial<OssProviderConfig>) => setDraft((d) => ({ ...d, ...patch }));

  useEffect(() => () => {
    if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
  }, []);

  return (
    <div className="p-4 border border-brd2 rounded-lg bg-surf">
      <div className="flex items-center gap-2 mb-3">
        <ThemeIcon name="aliyun" size={16} />
        <div className="text-[13px] font-semibold text-t1">{t('settings:storage.provider.oss.label')}</div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label={t('settings:storage.oss.accessKeyId')} value={draft.accessKeyId} onChange={(v) => set({ accessKeyId: v })} />
        <Field label={t('settings:storage.oss.accessKeySecret')} value={draft.accessKeySecret} onChange={(v) => set({ accessKeySecret: v })} type="password" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label={t('settings:storage.oss.bucket')} value={draft.bucket} onChange={(v) => set({ bucket: v })} />
        <Field label={t('settings:storage.oss.region')} value={draft.region} onChange={(v) => set({ region: v })} placeholder="cn-hangzhou" />
      </div>
      <Field label={t('settings:storage.publicBaseUrl')} value={draft.publicBaseUrl} onChange={(v) => set({ publicBaseUrl: v })} placeholder="https://cdn.example.com or https://bucket.oss-cn-hangzhou.aliyuncs.com" />
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
                accessKeyId: draft.accessKeyId.trim(),
                accessKeySecret: draft.accessKeySecret.trim(),
                bucket: draft.bucket.trim(),
                region: draft.region.trim(),
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
      <Hint i18nKey="settings:storage.oss.publicHint" />
      <button
        type="button"
        className="mt-2 inline-flex items-center gap-1 h-[24px] px-2.5 rounded-md text-[11px] font-ui cursor-pointer border border-brd2 text-t3 hover:border-acc hover:text-acc transition-all duration-100 bg-transparent"
        onClick={async () => {
          const cors = JSON.stringify([
            {
              AllowedOrigin: ['tauri://localhost', 'http://tauri.localhost', 'http://localhost:1420'],
              AllowedMethod: ['PUT', 'GET', 'HEAD'],
              AllowedHeader: ['authorization', 'content-type', 'x-oss-date', 'x-oss-content-sha256'],
              ExposeHeader: ['ETag'],
              MaxAgeSeconds: 3600,
            },
          ], null, 2);
          try {
            await navigator.clipboard.writeText(cors);
            setCopiedCors(true);
            setTimeout(() => setCopiedCors(false), 1500);
          } catch {
            // Non-fatal — the JSON stays selectable for manual copy.
          }
        }}
      >
        <Copy size={12} />
        {copiedCors ? `✓ ${t('settings:storage.cors.copied')}` : t('settings:storage.cors.ossCopyButton')}
      </button>
    </div>
  );
}
