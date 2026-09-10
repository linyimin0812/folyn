import { useState, useRef, useEffect, useCallback, type ReactNode } from 'react';
import { ImageDown, Cloud, Copy, ExternalLink, Check, FolderArchive } from 'lucide-react';
import { useExport, hasContainerSyntax } from '@/hooks/useExport';
import { VaultExportDialog } from './VaultExportDialog';
import { SingleDocExportDialog } from './SingleDocExportDialog';
import { SourceExportDialog } from './SourceExportDialog';
import { FormatExportDialog } from './FormatExportDialog';
import { useEditorStore, detectFileType } from '@/store/editorStore';
import { useVaultStore } from '@/store/vaultStore';
import { exportService } from '@/services/export/exporterRegistry';
import { FileIcon } from '@/components/icons/FileIcon';
import { useTranslation } from 'react-i18next';
import { hideWebviewsForOverlay } from '@/components/file-types/web/WebViewer';
import { getPluginExportersForFileType } from '@/services/plugin-host/exporterAdapter';
import { runCommand } from '@/services/commandRegistry';

// File types that ship a canvas → SVG/PNG export. Markdown goes HTML instead.
const CANVAS_TYPES = new Set(['dbml', 'excalidraw', 'drawio', 'markmap', 'plantuml', 'graphviz', 'mermaid']);
// File types with a per-type source label. Others fall back to "default".
const KNOWN_SOURCE_TYPES = new Set(['markdown', ...CANVAS_TYPES]);

interface Item {
  key: string;
  icon: ReactNode;
  label: string;
  description: string;
  run: () => void;
}

export function ExportMenu() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [containerWarning, setContainerWarning] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [vaultExportOpen, setVaultExportOpen] = useState(false);
  const [singleDocExportOpen, setSingleDocExportOpen] = useState(false);
  const [sourceExportOpen, setSourceExportOpen] = useState(false);
  const [formatExport, setFormatExport] = useState<{ exporterId: string; formatId: string; label: string; ext: string } | null>(null);
  const [shareError, setShareError] = useState<string | null>(null);
  const [urlCopied, setUrlCopied] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const { getActiveContent } = useExport();

  const fileType = useEditorStore((s) => {
    const tab = s.tabs.find((t) => t.id === s.activeTabId);
    return tab?.fileType ?? detectFileType(tab?.path ?? '');
  });
  const tabName = useEditorStore((s) => {
    const tab = s.tabs.find((t) => t.id === s.activeTabId);
    return tab?.name ?? '';
  });
  const activeTabPath = useEditorStore((s) => s.tabs.find((t) => t.id === s.activeTabId)?.path ?? '');

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    if (open) {
      // Hide the native webview so the export menu isn't covered by it.
      hideWebviewsForOverlay();
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      if (open) window.dispatchEvent(new CustomEvent('folyn:overlay-closed'));
    };
  }, [open]);

  const runWithOverlay = useCallback((fn: () => void | Promise<void>) => {
    setOpen(false);
    setExporting(true);
    Promise.resolve(fn()).catch(() => {}).finally(() => setExporting(false));
  }, []);

  // Markdown container-syntax gate — pre-flight before opening the source
  // export dialog (the dialog handles download-vs-upload choice).
  const checkSourceExport = useCallback(() => {
    if (fileType === 'markdown') {
      const { content } = getActiveContent();
      if (hasContainerSyntax(content)) {
        setContainerWarning(true);
        setOpen(false);
        return;
      }
    }
    setOpen(false);
    setSourceExportOpen(true);
  }, [fileType, getActiveContent]);

  const confirmExportSource = useCallback(() => {
    setContainerWarning(false);
    setSourceExportOpen(true);
  }, []);

  // ── Context-driven export menu (doc §80: no per-file-type if/else) ───────
  // Source item first (per-type label + markdown container-warning gate),
  // then format exporters from the ExporterRegistry (html/svg/png/markmap),
  // then share-to-cloud (special — not a file save), then plugin exporters.
  const exportCtx = {
    filePath: activeTabPath,
    vaultRoot: useVaultStore.getState().currentVault?.basePath ?? '',
    content: getActiveContent().content,
  };
  const sourceKey = KNOWN_SOURCE_TYPES.has(fileType) ? fileType : 'default';
  const items: Item[] = [
    {
      key: 'source',
      icon: <span className="text-base w-6 flex justify-center shrink-0"><FileIcon filename={tabName || `doc.${fileType}`} /></span>,
      label: t(`editor:export.source.${sourceKey}.label`),
      description: t(`editor:export.source.${sourceKey}.description`),
      run: () => { setOpen(false); checkSourceExport(); },
    },
  ];

  // Markdown single-doc HTML export — modal target + image-mode picker
  // (master's richer HTML export path; the registry's markdown.html exporter
  // is removed to avoid a duplicate HTML entry).
  if (fileType === 'markdown') {
    items.push({
      key: 'single-doc',
      icon: <span className="text-base w-6 text-center shrink-0">🌐</span>,
      label: t('editor:export.singleDoc.menu'),
      description: t('editor:export.html.description'),
      run: () => { setOpen(false); setSingleDocExportOpen(true); },
    });
  }

  // Builtin format exporters (markdown html/markmap, rich-text html, canvas svg/png).
  for (const d of exportService.getAvailableExporters(exportCtx, fileType)) {
    if (d.id === 'builtin.source') continue; // already rendered above
    const exporterId = d.id;
    // Markdown HTML / markmap keep their i18n labels; canvas svg/png too.
    const labelKey = d.id === 'markdown.markmap' ? 'editor:export.markmap'
      : d.format.id === 'html' ? 'editor:export.html'
      : d.format.id === 'svg' ? 'editor:export.svg'
      : d.format.id === 'png' ? 'editor:export.png'
      : null;
    items.push({
      key: `export-${exporterId}-${d.format.id}`,
      icon: d.format.id === 'html'
        ? <span className="text-base w-6 text-center shrink-0">🌐</span>
        : <ImageDown size={16} className="w-6 flex justify-center shrink-0" />,
      label: labelKey ? t(`${labelKey}.label`) : d.title,
      description: labelKey ? t(`${labelKey}.description`) : d.title,
      run: () => {
        setOpen(false);
        setFormatExport({
          exporterId,
          formatId: d.format.id,
          label: d.format.title,
          ext: d.format.extension,
        });
      },
    });
  }

  // Plugin-contributed exporters (kept via the adapter for now; will migrate
  // to ExporterRegistry in a later pass).
  for (const e of getPluginExportersForFileType(fileType)) {
    const commandId = e.commandId;
    items.push({
      key: `plugin-export-${e.pluginId}-${e.contrib.format}`,
      icon: <ImageDown size={16} className="w-6 flex justify-center shrink-0" />,
      label: e.contrib.label,
      description: e.contrib.label,
      run: () => runWithOverlay(() => runCommand(commandId)),
    });
  }

  // Vault-level export — independent of the active tab's type. Placed last
  // so the per-file export options stay on top and the whole-vault action
  // sits at the bottom of the menu.
  items.push({
    key: 'vault-html',
    icon: <FolderArchive size={16} className="w-6 flex justify-center shrink-0" />,
    label: t('editor:export.vault.menu'),
    description: t('editor:export.vault.menuDesc'),
    run: () => { setOpen(false); setVaultExportOpen(true); },
  });

  return (
    <>
      <div className="export-wrap relative" ref={menuRef}>
        <button className="tb-btn w-[30px] h-[30px] flex items-center justify-center rounded-[5px] text-sm text-t3 transition-all duration-150 hover:bg-hov hover:text-t1" onClick={() => setOpen(!open)} title={t('editor:export.title')}>
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
            <path d="M8 2v8" /><path d="M4.5 5.5L8 2l3.5 3.5" />
            <path d="M2.5 10v2.5a1 1 0 001 1h9a1 1 0 001-1V10" />
          </svg>
        </button>
        {open && (
          <div className="export-menu absolute top-full right-0 z-50 bg-panel border border-brd2 rounded-lg shadow-[0_8px_32px_rgba(0,0,0,.12)] min-w-[200px] p-1.5 mt-1 animate-[fadeIn_.12s]">
            {items.map((item) => (
              <div
                key={item.key}
                className="flex items-center gap-2 py-2 px-2.5 rounded-[5px] cursor-pointer transition-[background] duration-100 hover:bg-hov"
                onClick={item.run}
              >
                {item.icon}
                <div className="flex flex-col gap-px">
                  <span className="text-xs font-medium text-t1">{item.label}</span>
                  <span className="text-[10px] text-t3">{item.description}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Container syntax warning dialog */}
      {containerWarning && (
        <div className="dlg-overlay" onClick={() => setContainerWarning(false)}>
          <div className="dlg" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 420 }}>
            <div className="dlg-hd">
              <h3>{t('editor:export.containerWarning.title')}</h3>
              <button className="dlg-close" onClick={() => setContainerWarning(false)}>✕</button>
            </div>
            <div className="dlg-body">
              <p style={{ margin: '8px 0', lineHeight: 1.7 }}>
                {t('editor:export.containerWarning.body')}
              </p>
              <p style={{ margin: '8px 0', lineHeight: 1.7, fontSize: 13, color: 'var(--t3)' }}>
                {t('editor:export.containerWarning.hint')}
              </p>
            </div>
            <div className="dlg-ft">
              <button className="btn btn-g btn-sm" onClick={() => setContainerWarning(false)}>{t('editor:export.containerWarning.cancel')}</button>
              <button className="btn btn-p btn-sm" onClick={confirmExportSource}>{t('editor:export.containerWarning.confirm')}</button>
            </div>
          </div>
        </div>
      )}

      {/* Export-in-progress overlay: shown from click until the OS save dialog appears */}
      {exporting && (
        <div className="dlg-overlay" style={{ cursor: 'wait' }}>
          <div className="dlg" style={{ maxWidth: 320, padding: 24, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}>
            <span className="inline-block w-5 h-5 rounded-full border-[1.5px] border-brd border-t-acc animate-spin shrink-0" />
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--t1)' }}>{t('editor:export.processing.title')}</div>
              <div style={{ fontSize: 12, color: 'var(--t3)', marginTop: 4 }}>{t('editor:export.processing.hint')}</div>
            </div>
          </div>
        </div>
      )}

      {/* Share success: URL copied to clipboard; show the URL + dismiss */}
      {shareUrl && (
        <div className="dlg-overlay" onClick={() => setShareUrl(null)}>
          <div className="dlg" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 480, padding: '18px 20px 16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
              <Cloud size={18} className="text-acc" />
              <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--t1)' }}>{t('settings:storage.toast.htmlShared')}</div>
            </div>
            <div style={{ fontSize: 12, color: 'var(--t3)', marginBottom: 8 }}>{t('settings:storage.description')}</div>
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
                  onClick={() => {
                    import('@tauri-apps/plugin-shell').then(({ open }) => open(shareUrl));
                  }}
                  title={t('editor:export.share.openExternal')}
                >
                  <ExternalLink size={14} />
                </button>
              </div>
            </div>
            <div className="dlg-ft" style={{ marginTop: 14, padding: 0, borderTop: 'none' }}>
              <button className="btn btn-p btn-sm" onClick={() => setShareUrl(null)}>OK</button>
            </div>
          </div>
        </div>
      )}

      {/* Share error: surface the cause; user closes */}
      {shareError && (
        <div className="dlg-overlay" onClick={() => setShareError(null)}>
          <div className="dlg" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 480, padding: '18px 20px 16px' }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--t1)', marginBottom: 8 }}>
              {t('settings:storage.toast.uploadFailed')}
            </div>
            <div style={{ fontSize: 12, color: 'var(--t3)', lineHeight: 1.6, wordBreak: 'break-word' }}>
              {shareError}
            </div>
            <div className="dlg-ft" style={{ marginTop: 14, padding: 0, borderTop: 'none' }}>
              <button className="btn btn-p btn-sm" onClick={() => setShareError(null)}>OK</button>
            </div>
          </div>
        </div>
      )}

      {/* Export entire vault — modal mode picker */}
      {vaultExportOpen && (
        <VaultExportDialog onClose={() => setVaultExportOpen(false)} />
      )}

      {/* Export single markdown doc — target + image-mode picker */}
      {singleDocExportOpen && (
        <SingleDocExportDialog docName={tabName} onClose={() => setSingleDocExportOpen(false)} />
      )}

      {/* Source-file export — download or upload to a storage provider */}
      {sourceExportOpen && (
        <SourceExportDialog docName={tabName} onClose={() => setSourceExportOpen(false)} />
      )}

      {/* Format export (svg/png/…) — download or upload to a storage provider */}
      {formatExport && (
        <FormatExportDialog
          formatLabel={formatExport.label}
          docName={tabName}
          exporterId={formatExport.exporterId}
          ctx={exportCtx}
          ext={formatExport.ext}
          onClose={() => setFormatExport(null)}
        />
      )}
    </>
  );
}
