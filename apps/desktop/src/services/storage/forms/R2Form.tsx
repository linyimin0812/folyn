/**
 * Cloudflare R2 config form for Settings → Storage & Sharing. Self-contained:
 * owns its draft state, calls `useTranslation()` internally, narrows the opaque
 * saved config to {@link R2ProviderConfig}. Mirrors the shape every contributed
 * storage-provider form follows (`StorageConfigFormProps`).
 */
import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Save, Trash2, Copy } from 'lucide-react';
import type { StorageConfigFormProps } from 'folyn-extension-sdk';
import type { R2ProviderConfig } from '../types';
import { defaultR2Config } from '../storageConfigStorage';
import { ThemeIcon } from '@/components/icons/ThemeIcon';
import { Field, Hint } from './shared';

export function R2Form({ config, onSave, onRemove }: StorageConfigFormProps) {
  const { t } = useTranslation();
  const initial = (config as R2ProviderConfig | null) ?? defaultR2Config();
  const [draft, setDraft] = useState<R2ProviderConfig>({ ...initial, provider: 'r2' });
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [copiedCors, setCopiedCors] = useState(false);
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const set = (patch: Partial<R2ProviderConfig>) => setDraft((d) => ({ ...d, ...patch }));

  useEffect(() => () => {
    if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
  }, []);

  return (
    <div className="p-4 border border-brd2 rounded-lg bg-surf">
      <div className="flex items-center gap-2 mb-3">
        <ThemeIcon name="cloudflare" size={16} />
        <div className="text-[13px] font-semibold text-t1">{t('settings:storage.provider.r2.label')}</div>
      </div>
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
          onClick={() => onRemove()}
        >
          <Trash2 size={13} className="inline mr-1" />
          {t('settings:storage.clear')}
        </button>
        {savedAt !== null && (
          <span className="self-center text-[11px] text-[var(--green,#22a863)]">✓ {t('settings:storage.toast.saved')}</span>
        )}
      </div>
      <Hint i18nKey="settings:storage.r2.publicHint" />
      <button
        type="button"
        className="mt-2 inline-flex items-center gap-1 h-[24px] px-2.5 rounded-md text-[11px] font-ui cursor-pointer border border-brd2 text-t3 hover:border-acc hover:text-acc transition-all duration-100 bg-transparent"
        onClick={async () => {
          const cors = JSON.stringify([
            {
              AllowedOrigins: ['tauri://localhost', 'http://tauri.localhost', 'http://localhost:1420'],
              AllowedMethods: ['PUT', 'POST', 'GET', 'HEAD'],
              AllowedHeaders: ['authorization', 'content-type', 'x-amz-content-sha256', 'x-amz-date'],
              ExposeHeaders: ['ETag'],
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
        {copiedCors ? `✓ ${t('settings:storage.cors.copied')}` : t('settings:storage.cors.copyButton')}
      </button>
    </div>
  );
}
