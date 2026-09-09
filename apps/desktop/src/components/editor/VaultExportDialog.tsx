/**
 * "Export entire vault" dialog. Lets the user pick the product shape
 * (single self-contained HTML — default, or an HTML folder) and the output
 * target (download locally — default, or upload to a configured storage
 * provider). Drives {@link exportVaultToHtml} / {@link uploadVaultSingleToCloud}.
 *
 * Upload is single-mode only (folder is multi-file); choosing upload locks
 * the shape to single. Surfaces per-document progress, a final summary, and
 * the uploaded URL (copy + open).
 */
import { useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Copy, ExternalLink, Check } from 'lucide-react';
import { useVaultStore } from '@/store/vaultStore';
import { useStorageConfigStore } from '@/services/storage/storageConfigStore';
import { getProvider } from '@/services/storage/registry';
import { exportVaultToHtml, uploadVaultSingleToCloud, uploadVaultFolderToCloud, type VaultExportMode } from '@/services/export/vaultExport';

interface VaultExportDialogProps {
  onClose: () => void;
}

type Phase = 'idle' | 'exporting' | 'done' | 'error';
type Output = 'download' | 'upload';

export function VaultExportDialog({ onClose }: VaultExportDialogProps): React.JSX.Element {
  const { t } = useTranslation();
  const currentVault = useVaultStore((s) => s.currentVault);

  const activeProvider = useStorageConfigStore((s) => s.activeProvider);
  const activeCfg = useStorageConfigStore((s) => s.configs[s.activeProvider] ?? null);
  const shareEnabled = activeCfg ? getProvider(activeProvider).isConfigured(activeCfg) : false;

  const [mode, setMode] = useState<VaultExportMode>('single');
  const [output, setOutput] = useState<Output>('download');
  const [phase, setPhase] = useState<Phase>('idle');
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ docCount: number; filteredCount: number } | null>(null);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [urlCopied, setUrlCopied] = useState(false);

  const vaultName = currentVault?.name ?? '';

  const handleExport = useCallback(async () => {
    setPhase('exporting');
    setProgress({ done: 0, total: 0 });
    setError(null);
    setResult(null);
    setShareUrl(null);
    try {
      if (output === 'upload') {
        const url = mode === 'folder'
          ? await uploadVaultFolderToCloud({ onProgress: (done, total) => setProgress({ done, total }) })
          : await uploadVaultSingleToCloud({ onProgress: (done, total) => setProgress({ done, total }) });
        await navigator.clipboard.writeText(url).catch(() => {});
        setShareUrl(url);
        setPhase('done');
        return;
      }
      const r = await exportVaultToHtml(mode, {
        onProgress: (done, total) => setProgress({ done, total }),
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
  }, [mode, output, onClose, t]);

  return (
    <div className="dlg-overlay" onClick={phase === 'exporting' ? undefined : onClose}>
      <div className="dlg" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 440 }}>
        <div className="dlg-hd">
          <h3>{t('editor:export.vault.title')}</h3>
          {phase !== 'exporting' && (
            <button className="dlg-close" onClick={onClose}>✕</button>
          )}
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
                    onChange={() => setMode('folder')}
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
                  className={`flex items-start gap-2.5 py-1.5 px-2.5 rounded-[5px] transition-[background] duration-100 ${shareEnabled ? 'cursor-pointer hover:bg-hov' : 'opacity-50 pointer-events-none'}`}
                  style={{ outline: output === 'upload' ? '1.5px solid var(--acc)' : '1px solid var(--brd2)' }}
                >
                  <input
                    type="radio"
                    name="vault-output"
                    checked={output === 'upload'}
                    onChange={() => setOutput('upload')}
                    disabled={!shareEnabled}
                    className="mt-0.5 accent-[var(--acc)]"
                  />
                  <span className="flex flex-col gap-px">
                    <span className="text-xs font-medium text-t1">{t('editor:export.vault.output.upload')}</span>
                    <span className="text-[10px] text-t3">
                      {shareEnabled ? t('editor:export.vault.output.uploadDesc') : t('editor:export.vault.output.uploadDisabled')}
                    </span>
                  </span>
                </label>
              </div>

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
          <button
            className="btn btn-g btn-sm"
            onClick={onClose}
            disabled={phase === 'exporting'}
          >
            {t('editor:export.vault.close')}
          </button>
          {phase !== 'done' && phase !== 'error' && (
            <button
              className="btn btn-p btn-sm"
              onClick={handleExport}
              disabled={phase === 'exporting' || !currentVault || (output === 'upload' && !shareEnabled)}
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
