/**
 * "Export entire vault" dialog. Lets the user pick the product shape
 * (single self-contained HTML — default, or an HTML folder) and the output
 * target (download locally — default, or upload to a configured storage
 * provider). Drives {@link exportVaultToHtml} / {@link uploadVaultSingleToCloud}.
 *
 * Upload is single-only — an HTML folder is multi-file and object stores
 * don't serve it as one shareable URL — so picking folder greys out the
 * upload target (and resets it to download). Surfaces per-document progress,
 * a final summary, and the uploaded URL (copy + open).
 */
import { useState, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Copy, ExternalLink, Check, Settings } from 'lucide-react';
import { useVaultStore } from '@/store/vaultStore';
import { useStorageConfigStore } from '@/services/storage/storageConfigStore';
import { getProvider, getAllProviders } from '@/services/storage/registry';
import { IconSelect } from '@/components/common/IconSelect';
import { useNavStore } from '@/store/navStore';
import { exportVaultToHtml, uploadVaultSingleToCloud, type VaultExportMode } from '@/services/export/vaultExport';
import type { HtmlImageMode } from '@/services/export/shared';

interface VaultExportDialogProps {
  onClose: () => void;
}

type Phase = 'idle' | 'exporting' | 'done' | 'error';
type Output = 'download' | 'upload';

export function VaultExportDialog({ onClose }: VaultExportDialogProps): React.JSX.Element {
  const { t } = useTranslation();
  const currentVault = useVaultStore((s) => s.currentVault);

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

  const [imageMode, setImageMode] = useState<HtmlImageMode>('inline');
  const [mode, setMode] = useState<VaultExportMode>('single');
  const [output, setOutput] = useState<Output>('download');
  // Upload is single-only: a folder is multi-file and can't be one shareable
  // URL on an object store. Grey out the upload target while folder is picked.
  const uploadDisabled = mode === 'folder';
  const fileUpload = output === 'upload' && !uploadDisabled;
  const imageUpload = imageMode === 'upload';
  // Whether the chosen provider for each stream is configured.
  const fileReady = (() => { if (!fileProviderId) return false; const c = configs[fileProviderId] ?? null; return c ? getProvider(fileProviderId).isConfigured(c) : false; })();
  const imageReady = (() => { if (!imageProviderId) return false; const c = configs[imageProviderId] ?? null; return c ? getProvider(imageProviderId).isConfigured(c) : false; })();
  // Whether an upload stream is selected but its provider isn't picked.
  const fileMissing = fileUpload && !fileReady;
  const imageMissing = imageUpload && !imageReady;
  const [showProviderError, setShowProviderError] = useState(false);
  const [phase, setPhase] = useState<Phase>('idle');
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ docCount: number; filteredCount: number } | null>(null);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [urlCopied, setUrlCopied] = useState(false);
  // Aborts an in-flight whole-vault export. Set true by the close button /
  // overlay click while exporting; prepareVaultExport checks it between docs.
  const cancelRef = useRef(false);

  const handleExport = useCallback(async () => {
    // If an upload stream is on but its provider isn't picked, flag the
    // pickers red instead of exporting (provider is required for upload).
    if (fileMissing || imageMissing) {
      setShowProviderError(true);
      return;
    }
    setShowProviderError(false);
    cancelRef.current = false;
    setPhase('exporting');
    setProgress({ done: 0, total: 0 });
    setError(null);
    setResult(null);
    setShareUrl(null);
    try {
      if (output === 'upload') {
        const url = await uploadVaultSingleToCloud({ imageMode, imageProviderId: imageProviderId ?? undefined, fileProviderId: fileProviderId ?? undefined, onProgress: (done, total) => setProgress({ done, total }), shouldCancel: () => cancelRef.current });
        await navigator.clipboard.writeText(url).catch(() => {});
        setShareUrl(url);
        setPhase('done');
        return;
      }
      const r = await exportVaultToHtml(mode, {
        imageMode,
        imageProviderId: imageProviderId ?? undefined,
        onProgress: (done, total) => setProgress({ done, total }),
        shouldCancel: () => cancelRef.current,
      });
      if (r.docCount === 0 && r.mode === 'folder') {
        // user cancelled the folder pick — close silently
        setPhase('idle');
        setProgress(null);
        onClose();
        return;
      }
      setResult({ docCount: r.docCount, filteredCount: r.filteredCount });
      setPhase('done');
    } catch (err) {
      const e = err as Error;
      // User clicked close during export — abort silently (no error toast).
      if (e.message === 'CANCELLED') {
        setPhase('idle');
        setProgress(null);
        onClose();
        return;
      }
      setError(
        e.message === 'NO_VAULT'
          ? t('editor:export.vault.noVault')
          : e.message === 'NO_TEXT_FILES'
            ? t('editor:export.vault.noTextFiles')
            : e.message === 'STORAGE_NOT_CONFIGURED' || e.message === 'STORAGE_NO_HTML_CAPABILITY'
              ? t('settings:storage.toast.notConfigured')
              : `${t('editor:export.vault.error')}: ${e.message}`,
      );
      setPhase('error');
    }
  }, [mode, output, imageMode, fileMissing, imageMissing, onClose, t]);

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

  return (
    <div className="dlg-overlay" data-tauri-drag-region={false} onClick={phase === 'exporting' ? undefined : onClose}>
      <div className="dlg" data-tauri-drag-region={false} onClick={(e) => e.stopPropagation()} style={{ maxWidth: 440 }}>
        <div className="dlg-hd" onDoubleClick={(e) => { e.preventDefault(); e.stopPropagation(); }}>
          <h3>{t('editor:export.vault.title')}</h3>
        </div>

        <div className="dlg-body">
          {phase !== 'done' && phase !== 'error' && (
            <>
              <p className="text-[12px] text-t3" style={{ margin: '4px 0 10px', lineHeight: 1.6 }}>
                {t('editor:export.vault.hint')}
              </p>

              <div className="text-[10px] text-t3" style={{ margin: '6px 0 4px' }}>{t('editor:export.vault.shape')}</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <label
                  className="flex items-start gap-2.5 py-1.5 px-2.5 rounded-[5px] cursor-pointer transition-[background] duration-100 hover:bg-hov"
                  style={{ outline: mode === 'single' ? '1.5px solid var(--acc)' : '1px solid var(--brd2)' }}
                >
                  <input
                    type="radio"
                    name="vault-export-mode"
                    checked={mode === 'single'}
                    onChange={() => setMode('single')}
                    className="mt-0.5 accent-[var(--acc)]"
                  />
                  <span className="flex flex-col gap-px">
                    <span className="text-xs font-medium text-t1">{t('editor:export.vault.single.label')}</span>
                    <span className="text-[10px] text-t3">{t('editor:export.vault.single.desc')}</span>
                  </span>
                </label>

                <label
                  className="flex items-start gap-2.5 py-1.5 px-2.5 rounded-[5px] cursor-pointer transition-[background] duration-100 hover:bg-hov"
                  style={{ outline: mode === 'folder' ? '1.5px solid var(--acc)' : '1px solid var(--brd2)' }}
                >
                  <input
                    type="radio"
                    name="vault-export-mode"
                    checked={mode === 'folder'}
                    onChange={() => { setMode('folder'); if (output === 'upload') setOutput('download'); }}
                    className="mt-0.5 accent-[var(--acc)]"
                  />
                  <span className="flex flex-col gap-px">
                    <span className="text-xs font-medium text-t1">{t('editor:export.vault.folder.label')}</span>
                    <span className="text-[10px] text-t3">{t('editor:export.vault.folder.desc')}</span>
                  </span>
                </label>
              </div>

              <div className="text-[10px] text-t3" style={{ margin: '12px 0 4px' }}>{t('editor:export.vault.target')}</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <label
                  className="flex items-start gap-2.5 py-1.5 px-2.5 rounded-[5px] cursor-pointer transition-[background] duration-100 hover:bg-hov"
                  style={{ outline: output === 'download' ? '1.5px solid var(--acc)' : '1px solid var(--brd2)' }}
                >
                  <input
                    type="radio"
                    name="vault-output"
                    checked={output === 'download'}
                    onChange={() => setOutput('download')}
                    className="mt-0.5 accent-[var(--acc)]"
                  />
                  <span className="text-xs font-medium text-t1">{t('editor:export.vault.output.download')}</span>
                </label>

                <label
                  className={`flex items-start gap-2.5 py-1.5 px-2.5 rounded-[5px] transition-[background] duration-100 ${uploadDisabled ? 'opacity-50 pointer-events-none' : 'cursor-pointer hover:bg-hov'}`}
                  style={{ outline: output === 'upload' ? '1.5px solid var(--acc)' : '1px solid var(--brd2)' }}
                >
                  <input
                    type="radio"
                    name="vault-output"
                    checked={output === 'upload'}
                    onChange={() => setOutput('upload')}
                    disabled={uploadDisabled}
                    className="mt-0.5 accent-[var(--acc)]"
                  />
                  <span className="flex flex-col gap-px">
                    <span className="text-xs font-medium text-t1">{t('editor:export.vault.output.upload')}</span>
                    <span className="text-[10px] text-t3">{t('editor:export.vault.output.uploadDesc')}</span>
                  </span>
                </label>
              </div>

              {/* File upload provider — under the output target. */}
              <div className="flex items-center gap-2 text-t3" style={{ margin: '8px 0 4px' }}>
                <span className="text-[10px]">{t('editor:export.provider.fileLabel')}</span>
                <button className="text-[10px] text-acc hover:underline cursor-pointer" onClick={goToSettings}>{t('editor:export.provider.openSettings')}</button>
              </div>
              {providerPicker(t('editor:export.provider.fileLabel'), fileProviderId, setFileProviderId, fileUpload, fileMissing)}

              {/* Image handling */}
              <div className="text-[10px] text-t3" style={{ margin: '12px 0 4px' }}>{t('editor:export.vault.imageMode.label')}</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <label
                  className="flex items-start gap-2.5 py-1.5 px-2.5 rounded-[5px] cursor-pointer transition-[background] duration-100 hover:bg-hov"
                  style={{ outline: imageMode === 'inline' ? '1.5px solid var(--acc)' : '1px solid var(--brd2)' }}
                >
                  <input type="radio" name="vault-image-mode" checked={imageMode === 'inline'} onChange={() => setImageMode('inline')} className="mt-0.5 accent-[var(--acc)]" />
                  <span className="flex flex-col gap-px">
                    <span className="text-xs font-medium text-t1">{t('editor:export.vault.imageMode.inline')}</span>
                  </span>
                </label>
                <label
                  className="flex items-start gap-2.5 py-1.5 px-2.5 rounded-[5px] cursor-pointer transition-[background] duration-100 hover:bg-hov"
                  style={{ outline: imageMode === 'upload' ? '1.5px solid var(--acc)' : '1px solid var(--brd2)' }}
                >
                  <input type="radio" name="vault-image-mode" checked={imageMode === 'upload'} onChange={() => setImageMode('upload')} className="mt-0.5 accent-[var(--acc)]" />
                  <span className="flex flex-col gap-px">
                    <span className="text-xs font-medium text-t1">{t('editor:export.vault.imageMode.upload')}</span>
                  </span>
                </label>
              </div>

              {/* Image upload provider — under the image-mode group. */}
              <div className="flex items-center gap-2 text-t3" style={{ margin: '8px 0 4px' }}>
                <span className="text-[10px]">{t('editor:export.provider.imageLabel')}</span>
                <button className="text-[10px] text-acc hover:underline cursor-pointer" onClick={goToSettings}>{t('editor:export.provider.openSettings')}</button>
              </div>
              {providerPicker(t('editor:export.provider.imageLabel'), imageProviderId, setImageProviderId, imageUpload, imageMissing)}

              {phase === 'exporting' && progress && (
                <div style={{ marginTop: 14, display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span className="inline-block w-4 h-4 rounded-full border-[1.5px] border-brd border-t-acc animate-spin shrink-0" />
                  <span className="text-[12px] text-t2">
                    {progress.total > 0
                      ? t('editor:export.vault.progress', { done: progress.done, total: progress.total })
                      : t('editor:export.processing.hint')}
                  </span>
                </div>
              )}
            </>
          )}

          {phase === 'done' && result && !shareUrl && (
            <p style={{ margin: '8px 0', lineHeight: 1.7, fontSize: 13 }}>
              {t('editor:export.vault.success', { docs: result.docCount, filtered: result.filteredCount })}
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
            <button
              className="btn btn-g btn-sm"
              onClick={() => {
                // During export, close = abort the render (prepareVaultExport
                // checks the flag between docs and throws CANCELLED).
                if (phase === 'exporting') cancelRef.current = true;
                else onClose();
              }}
            >
              {phase === 'exporting' ? t('editor:export.vault.cancel') : t('editor:export.vault.close')}
            </button>
          )}
          {phase !== 'done' && phase !== 'error' && (
            <button
              className="btn btn-p btn-sm"
              onClick={handleExport}
              disabled={phase === 'exporting' || !currentVault || (output === 'upload' && uploadDisabled)}
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
