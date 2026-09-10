/**
 * Single-document (markdown) export dialog. Lets the user pick the output
 * target (download locally — default, or upload to a configured storage
 * provider) and the in-doc image handling (base64 inline — default, or
 * upload each image to the provider and rewrite src). Drives
 * {@link exportActiveHtml} / {@link shareActiveToCloud} with the chosen
 * imageMode.
 *
 * Replaces the old two-step ExportMenu items ("导出 HTML" download +
 * "分享到云端" upload) for markdown with one settings dialog, so image
 * handling is chosen per export instead of a global toggle. Mirrors
 * {@link VaultExportDialog}'s shape but drops the shape picker (a single
 * doc has one product).
 */
import { useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Copy, ExternalLink, Check, Settings } from 'lucide-react';
import { useStorageConfigStore } from '@/services/storage/storageConfigStore';
import { getProvider, getAllProviders } from '@/services/storage/registry';
import { IconSelect } from '@/components/common/IconSelect';
import { useNavStore } from '@/store/navStore';
import { exportActiveHtml, shareActiveToCloud } from '@/hooks/useExport';
import type { HtmlImageMode } from '@/services/export/shared';

interface SingleDocExportDialogProps {
  /** Active doc name (e.g. "notes.md"), for the title + download filename. */
  docName: string;
  onClose: () => void;
}

type Phase = 'idle' | 'exporting' | 'done' | 'error';
type Output = 'download' | 'upload';

export function SingleDocExportDialog({ docName, onClose }: SingleDocExportDialogProps): React.JSX.Element {
  const { t } = useTranslation();

  const configs = useStorageConfigStore((s) => s.configs);
  // Configured providers for the pickers — based on what's actually filled
  // in, NOT on which provider the Storage & Sharing page happens to have
  // selected as active.
  const providers = getAllProviders();
  const configuredProviders = providers.filter((p) =>
    (configs[p.id] ? p.isConfigured(configs[p.id]!) : false));
  // File upload and image upload may use different providers; each picker
  // is its own per-export choice. No default — the user picks; nothing is
  // pre-selected (independent of the global activeProvider selection).
  const [fileProviderId, setFileProviderId] = useState<string | null>(null);
  const [imageProviderId, setImageProviderId] = useState<string | null>(null);

  const [output, setOutput] = useState<Output>('download');
  // Per-export image handling — default base64 inline. 'upload' uploads
  // each image to the chosen provider and rewrites src.
  const [imageMode, setImageMode] = useState<HtmlImageMode>('inline');
  const fileUpload = output === 'upload';
  const imageUpload = imageMode === 'upload';
  // Whether the chosen provider for each stream is configured.
  const fileReady = (() => { if (!fileProviderId) return false; const c = configs[fileProviderId] ?? null; return c ? getProvider(fileProviderId).isConfigured(c) : false; })();
  const imageReady = (() => { if (!imageProviderId) return false; const c = configs[imageProviderId] ?? null; return c ? getProvider(imageProviderId).isConfigured(c) : false; })();
  // Whether an upload stream is selected but its provider isn't picked.
  const fileMissing = fileUpload && !fileReady;
  const imageMissing = imageUpload && !imageReady;
  const [showProviderError, setShowProviderError] = useState(false);
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState<string | null>(null);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [urlCopied, setUrlCopied] = useState(false);

  const handleExport = useCallback(async () => {
    // If an upload stream is on but its provider isn't picked, flag the
    // pickers red instead of exporting (provider is required for upload).
    if (fileMissing || imageMissing) {
      setShowProviderError(true);
      return;
    }
    setShowProviderError(false);
    setPhase('exporting');
    setError(null);
    setShareUrl(null);
    try {
      if (output === 'upload') {
        const url = await shareActiveToCloud({ imageMode, imageProviderId: imageProviderId ?? undefined, fileProviderId: fileProviderId ?? undefined });
        await navigator.clipboard.writeText(url).catch(() => {});
        setShareUrl(url);
        setPhase('done');
        return;
      }
      await exportActiveHtml({ imageMode, imageProviderId: imageProviderId ?? undefined });
      setPhase('done');
    } catch (err) {
      const e = err as Error;
      setError(
        e.message === 'STORAGE_NOT_CONFIGURED' || e.message === 'STORAGE_NO_HTML_CAPABILITY'
          ? t('settings:storage.toast.notConfigured')
          : `${t('editor:export.vault.error')}: ${e.message}`,
      );
      setPhase('error');
    }
  }, [output, imageMode, fileMissing, imageMissing, t]);

  // Jump to Settings → Storage & Sharing so the user can configure a
  // provider, then close this dialog.
  const goToSettings = useCallback(() => {
    useNavStore.getState().setCurrentPage('settings');
    useNavStore.getState().setSettingsTab('storage');
    onClose();
  }, [onClose]);

  // A provider picker for one upload stream (file or image). Always shown;
  // greyed when that stream isn't uploading. When no provider is configured
  // at all, show the config-required hint + go-to-settings instead.
  const providerPicker = (label: string, value: string | null, onChange: (v: string) => void, enabled: boolean, missing: boolean) => {
    if (configuredProviders.length === 0) {
      return (
        <div className="flex items-center gap-2 py-1.5 px-2.5 rounded-[5px] border border-brd2 bg-surf">
          <span className="text-[11px] text-t3 flex-1">{t('editor:export.provider.notConfigured')}</span>
          <button className="btn btn-g btn-sm shrink-0" onClick={goToSettings}>
            <Settings size={13} className="inline mr-1 -mt-px" />
            {t('editor:export.provider.goToSettings')}
          </button>
        </div>
      );
    }
    const showErr = showProviderError && missing;
    return (
      <div className={enabled ? '' : 'opacity-50 pointer-events-none'} style={showErr ? { outline: '1.5px solid var(--danger, #d33)', borderRadius: 5 } : undefined}>
        <IconSelect
          value={value ?? ''}
          onChange={onChange}
          ariaLabel={label}
          placeholder={t('editor:export.provider.selectPlaceholder')}
          options={configuredProviders.map((p) => ({
            value: p.id,
            label: t(p.labelKey),
            icon: <span className="text-[14px] leading-none">{p.icon}</span>,
          }))}
        />
        {showErr && (
          <div style={{ fontSize: 11, color: 'var(--danger, #d33)', marginTop: 4 }}>{t('editor:export.provider.required')}</div>
        )}
      </div>
    );
  };

  const radioRow = (checked: boolean, onChange: () => void, label: string, desc?: string) => (
    <label
      className="flex items-start gap-2.5 py-1.5 px-2.5 rounded-[5px] cursor-pointer transition-[background] duration-100 hover:bg-hov"
      style={{ outline: checked ? '1.5px solid var(--acc)' : '1px solid var(--brd2)' }}
    >
      <input type="radio" checked={checked} onChange={onChange} className="mt-0.5 accent-[var(--acc)]" />
      <span className="flex flex-col gap-px">
        <span className="text-xs font-medium text-t1">{label}</span>
        {desc && <span className="text-[10px] text-t3">{desc}</span>}
      </span>
    </label>
  );

  return (
    <div className="dlg-overlay" data-tauri-drag-region={false} onClick={phase === 'exporting' ? undefined : onClose}>
      <div className="dlg" data-tauri-drag-region={false} onClick={(e) => e.stopPropagation()} style={{ maxWidth: 440 }}>
        <div className="dlg-hd" onDoubleClick={(e) => { e.preventDefault(); e.stopPropagation(); }}>
          <h3>{t('editor:export.singleDoc.title', { name: docName })}</h3>
        </div>

        <div className="dlg-body">
          {phase !== 'done' && phase !== 'error' && (
            <>
              {/* Output target */}
              <div className="text-[10px] text-t3" style={{ margin: '6px 0 4px' }}>{t('editor:export.vault.target')}</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {radioRow(output === 'download', () => setOutput('download'), t('editor:export.vault.output.download'))}
                {radioRow(output === 'upload', () => setOutput('upload'), t('editor:export.vault.output.upload'), t('editor:export.vault.output.uploadDesc'))}
              </div>

              {/* File upload provider — under the output target. */}
              <div className="text-[10px] text-t3" style={{ margin: '8px 0 4px' }}>{t('editor:export.provider.fileLabel')}</div>
              {providerPicker(t('editor:export.provider.fileLabel'), fileProviderId, setFileProviderId, fileUpload, fileMissing)}

              {/* Image handling */}
              <div className="text-[10px] text-t3" style={{ margin: '12px 0 4px' }}>{t('editor:export.singleDoc.imageMode.label')}</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {radioRow(imageMode === 'inline', () => setImageMode('inline'), t('editor:export.singleDoc.imageMode.inline'), t('editor:export.singleDoc.imageMode.inlineDesc'))}
                {radioRow(imageMode === 'upload', () => setImageMode('upload'), t('editor:export.singleDoc.imageMode.upload'), t('editor:export.singleDoc.imageMode.uploadDesc'))}
              </div>

              {/* Image upload provider — under the image-mode group. */}
              <div className="text-[10px] text-t3" style={{ margin: '8px 0 4px' }}>{t('editor:export.provider.imageLabel')}</div>
              {providerPicker(t('editor:export.provider.imageLabel'), imageProviderId, setImageProviderId, imageUpload, imageMissing)}

              {phase === 'exporting' && (
                <div style={{ marginTop: 14, display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span className="inline-block w-4 h-4 rounded-full border-[1.5px] border-brd border-t-acc animate-spin shrink-0" />
                  <span className="text-[12px] text-t2">{t('editor:export.processing.hint')}</span>
                </div>
              )}
            </>
          )}

          {phase === 'done' && !shareUrl && (
            <p style={{ margin: '8px 0', lineHeight: 1.7, fontSize: 13 }}>
              {t('editor:export.singleDoc.downloaded', { name: docName })}
            </p>
          )}

          {phase === 'done' && shareUrl && (
            <div style={{ padding: '4px 0' }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--t1)', marginBottom: 8 }}>
                {t('editor:export.vault.uploaded')}
              </div>
              <div style={{ position: 'relative' }}>
                <input
                  readOnly
                  value={shareUrl}
                  className="w-full py-2 pl-2.5 pr-14 border border-brd2 rounded-md bg-surf text-t1 text-[12px] font-mono outline-none"
                  onFocus={(e) => e.currentTarget.select()}
                />
                <div style={{ position: 'absolute', right: 4, top: '50%', transform: 'translateY(-50%)', display: 'flex', gap: 2 }}>
                  <button
                    className="tb-btn flex items-center justify-center w-7 h-7 rounded text-t2 hover:bg-hov hover:text-t1 transition-colors"
                    onClick={() => {
                      navigator.clipboard.writeText(shareUrl).catch(() => {});
                      setUrlCopied(true);
                      setTimeout(() => setUrlCopied(false), 1500);
                    }}
                    title={t('settings:storage.cors.copyButton')}
                  >
                    {urlCopied ? <Check size={14} className="text-acc" /> : <Copy size={14} />}
                  </button>
                  <button
                    className="tb-btn flex items-center justify-center w-7 h-7 rounded text-t2 hover:bg-hov hover:text-t1 transition-colors"
                    onClick={() => import('@tauri-apps/plugin-shell').then(({ open }) => open(shareUrl))}
                    title={t('editor:export.share.openExternal')}
                  >
                    <ExternalLink size={14} />
                  </button>
                </div>
              </div>
            </div>
          )}

          {phase === 'error' && (
            <p style={{ margin: '8px 0', lineHeight: 1.6, fontSize: 12, color: 'var(--danger, #d33)' }}>
              {error}
            </p>
          )}
        </div>

        <div className="dlg-ft">
          {phase !== 'done' && phase !== 'error' && (
            <button className="btn btn-g btn-sm" onClick={onClose} disabled={phase === 'exporting'}>
              {t('editor:export.vault.close')}
            </button>
          )}
          {phase !== 'done' && phase !== 'error' && (
            <button
              className="btn btn-p btn-sm"
              onClick={handleExport}
              disabled={phase === 'exporting'}
            >
              {phase === 'exporting'
                ? t('editor:export.vault.exporting')
                : output === 'upload'
                  ? t('editor:export.vault.output.upload')
                  : t('editor:export.vault.export')}
            </button>
          )}
          {(phase === 'done' || phase === 'error') && (
            <button className="btn btn-p btn-sm" onClick={onClose}>OK</button>
          )}
        </div>
      </div>
    </div>
  );
}
