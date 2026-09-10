import { useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Copy, ExternalLink, Check } from 'lucide-react';
import { useStorageConfigStore } from '@/services/storage/storageConfigStore';
import { getProvider } from '@/services/storage/registry';
import { ProviderPicker, useGoToSettings, ExportRadioRow, EXPORT_DIALOG_STYLE } from './ProviderPicker';
import type { ExportResult } from 'folyn-plugin-sdk';

interface FormatExportDialogProps {
  /** Display name of the export target, e.g. "SVG" or "PNG". */
  formatLabel: string;
  /** Active doc name for the title. */
  docName: string;
  /** The exporter to run (produces an ExportResult). */
  exporterId: string;
  /** Context passed to the exporter. */
  ctx: { filePath: string; vaultRoot: string; content: string };
  /** Output extension (for upload key + filename). */
  ext: string;
  onClose: () => void;
}

type Phase = 'idle' | 'exporting' | 'done' | 'error';
type Output = 'download' | 'upload';

export function FormatExportDialog({
  formatLabel, docName, exporterId, ctx, ext, onClose,
}: FormatExportDialogProps): React.JSX.Element {
  const { t } = useTranslation();

  const configs = useStorageConfigStore((s) => s.configs);
  const [fileProviderId, setFileProviderId] = useState<string | null>(null);
  const [output, setOutput] = useState<Output>('download');
  const fileUpload = output === 'upload';
  const fileReady = (() => {
    if (!fileProviderId) return false;
    const c = configs[fileProviderId] ?? null;
    return c ? getProvider(fileProviderId).isConfigured(c) : false;
  })();
  const fileMissing = fileUpload && !fileReady;
  const [showProviderError, setShowProviderError] = useState(false);
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState<string | null>(null);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [urlCopied, setUrlCopied] = useState(false);

  const handleExport = useCallback(async () => {
    if (fileMissing) {
      setShowProviderError(true);
      return;
    }
    setShowProviderError(false);
    setPhase('exporting');
    setError(null);
    setShareUrl(null);
    try {
      // Run the exporter → ExportResult (data + mimeType + suggestedName).
      const { exportService } = await import('@/services/export/exporterRegistry');
      const result: ExportResult = await exportService.runExporter(exporterId, ctx);
      const blob = typeof result.data === 'string'
        ? new Blob([result.data], { type: result.mimeType })
        : new Blob([result.data as BlobPart], { type: result.mimeType });

      if (output === 'upload') {
        const store = useStorageConfigStore.getState();
        const fileId = fileProviderId ?? store.activeProvider;
        const cfg = store.configs[fileId] ?? null;
        if (!cfg || !getProvider(fileId).isConfigured(cfg)) {
          throw new Error('STORAGE_NOT_CONFIGURED');
        }
        const provider = getProvider(fileId);
        if (!provider.capabilities.image) {
          throw new Error('STORAGE_NO_IMAGE_CAPABILITY');
        }
        const bytes = new Uint8Array(await blob.arrayBuffer());
        const url = await provider.uploadImage(bytes, ext, cfg);
        await navigator.clipboard.writeText(url).catch(() => {});
        setShareUrl(url);
        setPhase('done');
        return;
      }
      // Download locally.
      const { downloadBlob } = await import('@/services/export/shared');
      await downloadBlob(blob, result.suggestedName, [ext]);
      setPhase('done');
    } catch (err) {
      const e = err as Error;
      setError(
        e.message === 'STORAGE_NOT_CONFIGURED' || e.message === 'STORAGE_NO_IMAGE_CAPABILITY'
          ? t('settings:storage.toast.notConfigured')
          : `${t('editor:export.vault.error')}: ${e.message}`,
      );
      setPhase('error');
    }
  }, [output, fileMissing, fileProviderId, exporterId, ctx, ext, t]);

  const goToSettings = useGoToSettings(onClose);


  return (
    <div className="dlg-overlay" data-tauri-drag-region={false} onClick={phase === 'exporting' ? undefined : onClose}>
      <div className="dlg" data-tauri-drag-region={false} onClick={(e) => e.stopPropagation()} style={EXPORT_DIALOG_STYLE}>
        <div className="dlg-hd" onDoubleClick={(e) => { e.preventDefault(); e.stopPropagation(); }}>
          <h3>{t('editor:export.singleDoc.title', { name: `${docName} · ${formatLabel}` })}</h3>
        </div>

        <div className="dlg-body">
          {phase !== 'done' && phase !== 'error' && (
            <>
              <div className="text-[10px] text-t3" style={{ margin: '6px 0 4px' }}>{t('editor:export.vault.target')}</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <ExportRadioRow checked={output === 'download'} onChange={() => setOutput('download')} label={t('editor:export.vault.output.download')} />
                <ExportRadioRow checked={output === 'upload'} onChange={() => setOutput('upload')} label={t('editor:export.vault.output.upload')} desc={t('editor:export.vault.output.uploadDesc')} />
              </div>

              <div className="flex items-center gap-2 text-t3" style={{ margin: '8px 0 4px' }}>
                <span className="text-[10px]">{t('editor:export.provider.fileLabel')}</span>
                <button className="text-[10px] text-acc hover:underline cursor-pointer" onClick={goToSettings}>{t('editor:export.provider.openSettings')}</button>
              </div>
              <ProviderPicker value={fileProviderId} onChange={setFileProviderId} enabled={fileUpload} missing={fileMissing} showRequired={showProviderError} onGoToSettings={goToSettings} />

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
              {t('editor:export.singleDoc.downloaded', { name: `${docName}.${ext}` })}
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
            <>
              <button className="btn btn-g btn-sm" onClick={onClose} disabled={phase === 'exporting'}>
                {t('editor:export.vault.close')}
              </button>
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
            </>
          )}
          {(phase === 'done' || phase === 'error') && (
            <button className="btn btn-p btn-sm" onClick={onClose}>OK</button>
          )}
        </div>
      </div>
    </div>
  );
}
