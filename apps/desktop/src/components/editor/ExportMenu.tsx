import { useState, useRef, useEffect, useCallback, type ReactNode } from 'react';
import { ImageDown, Cloud } from 'lucide-react';
import { useExport, hasContainerSyntax } from '@/hooks/useExport';
import { useEditorStore, detectFileType } from '@/store/editorStore';
import { FileIcon } from '@/components/icons/FileIcon';
import { useTranslation } from 'react-i18next';
import { hideWebviewsForOverlay } from '@/components/file-types/web/WebViewer';
import { getPluginExportersForFileType } from '@/services/plugin-host/exporterAdapter';
import { runCommand } from '@/services/commandRegistry';
import { useStorageConfigStore } from '@/services/storage/storageConfigStore';
import { getProvider } from '@/services/storage/registry';

// File types that ship a canvas → SVG/PNG export. Markdown goes HTML instead.
const CANVAS_TYPES = new Set(['dbml', 'excalidraw', 'drawio', 'mmap', 'plantuml', 'graphviz', 'mermaid']);
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
  const [shareError, setShareError] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const { exportSource, exportHtml, exportRichTextHtml, exportSvg, exportPng, exportMarkmap, shareToCloud, getActiveContent } = useExport();
  const activeProvider = useStorageConfigStore((s) => s.activeProvider);
  const activeCfg = useStorageConfigStore((s) => s.configs[s.activeProvider] ?? null);
  const shareEnabled = activeCfg ? getProvider(activeProvider).isConfigured(activeCfg) : false;

  const fileType = useEditorStore((s) => {
    const tab = s.tabs.find((t) => t.id === s.activeTabId);
    return tab?.fileType ?? detectFileType(tab?.path ?? '');
  });
  const tabName = useEditorStore((s) => {
    const tab = s.tabs.find((t) => t.id === s.activeTabId);
    return tab?.name ?? '';
  });

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
      if (open) window.dispatchEvent(new CustomEvent('quill:overlay-closed'));
    };
  }, [open]);

  const runWithOverlay = useCallback((fn: () => void | Promise<void>) => {
    setOpen(false);
    setExporting(true);
    Promise.resolve(fn()).catch(() => {}).finally(() => setExporting(false));
  }, []);

  const handleSource = useCallback(() => {
    if (fileType === 'markdown') {
      const { content } = getActiveContent();
      if (hasContainerSyntax(content)) {
        setContainerWarning(true);
        setOpen(false);
        return;
      }
    }
    runWithOverlay(() => exportSource());
  }, [fileType, getActiveContent, exportSource, runWithOverlay]);

  const confirmExportSource = useCallback(() => {
    setContainerWarning(false);
    runWithOverlay(() => exportSource());
  }, [exportSource, runWithOverlay]);

  const handleHtml = useCallback(() => {
    runWithOverlay(() => exportHtml());
  }, [exportHtml, runWithOverlay]);

  const handleRichTextHtml = useCallback(() => {
    runWithOverlay(() => exportRichTextHtml());
  }, [exportRichTextHtml, runWithOverlay]);

  const handleSvg = useCallback(() => {
    runWithOverlay(() => exportSvg());
  }, [exportSvg, runWithOverlay]);

  const handlePng = useCallback(() => {
    runWithOverlay(() => exportPng());
  }, [exportPng, runWithOverlay]);

  const handleMarkmap = useCallback(() => {
    runWithOverlay(() => exportMarkmap());
  }, [exportMarkmap, runWithOverlay]);

  const handleShareToCloud = useCallback(() => {
    setOpen(false);
    setShareError(null);
    setExporting(true);
    shareToCloud()
      .then(async (url) => {
        await navigator.clipboard.writeText(url).catch(() => {});
        setShareUrl(url);
      })
      .catch((err: Error) => {
        const msg = err.message === 'STORAGE_NOT_CONFIGURED'
          ? t('settings:storage.toast.notConfigured')
          : err.message === 'STORAGE_NO_HTML_CAPABILITY'
            ? t('settings:storage.toast.notConfigured')
            : `${t('settings:storage.toast.uploadFailed')}: ${err.message}`;
        setShareError(msg);
      })
      .finally(() => setExporting(false));
  }, [shareToCloud, t]);

  const sourceKey = KNOWN_SOURCE_TYPES.has(fileType) ? fileType : 'default';
  const items: Item[] = [
    {
      key: 'source',
      icon: <span className="text-base w-6 flex justify-center shrink-0"><FileIcon filename={tabName || `doc.${fileType}`} /></span>,
      label: t(`editor:export.source.${sourceKey}.label`),
      description: t(`editor:export.source.${sourceKey}.description`),
      run: handleSource,
    },
  ];
  if (fileType === 'markdown') {
    items.push({
      key: 'html',
      icon: <span className="text-base w-6 text-center shrink-0">🌐</span>,
      label: t('editor:export.html.label'),
      description: t('editor:export.html.description'),
      run: handleHtml,
    });
    items.push({
      key: 'markmap',
      icon: <ImageDown size={16} className="w-6 flex justify-center shrink-0" />,
      label: t('editor:export.markmap.label'),
      description: t('editor:export.markmap.description'),
      run: handleMarkmap,
    });
    if (shareEnabled) {
      items.push({
        key: 'share-cloud',
        icon: <Cloud size={16} className="w-6 flex justify-center shrink-0" />,
        label: t('settings:storage.share.menu'),
        description: t('settings:storage.description'),
        run: handleShareToCloud,
      });
    }
  } else if (fileType === 'rich-text') {
    items.push({
      key: 'html',
      icon: <span className="text-base w-6 text-center shrink-0">🌐</span>,
      label: t('editor:export.html.label'),
      description: t('editor:export.html.description'),
      run: handleRichTextHtml,
    });
    if (shareEnabled) {
      items.push({
        key: 'share-cloud',
        icon: <Cloud size={16} className="w-6 flex justify-center shrink-0" />,
        label: t('settings:storage.share.menu'),
        description: t('settings:storage.description'),
        run: handleShareToCloud,
      });
    }
  } else if (CANVAS_TYPES.has(fileType)) {
    items.push(
      {
        key: 'svg',
        icon: <ImageDown size={16} className="w-6 flex justify-center shrink-0" />,
        label: t('editor:export.svg.label'),
        description: t('editor:export.svg.description'),
        run: handleSvg,
      },
    );
    // PNG export: only for canvas types whose SVG has no foreignObject.
    // mmap (markmap) uses foreignObject for topic text — WebKit taints the
    // canvas (SecurityError on toBlob) when rasterizing SVG-as-Image with
    // foreignObject. Skip PNG for mmap; SVG covers the gap.
    // plantuml + graphviz ship SVG-only for now — PNG can be added later via
    // the shared svgToPngBlob helper (no foreignObject in their server SVGs).
    if (fileType !== 'mmap' && fileType !== 'plantuml' && fileType !== 'graphviz' && fileType !== 'mermaid') {
      items.push({
        key: 'png',
        icon: <ImageDown size={16} className="w-6 flex justify-center shrink-0" />,
        label: t('editor:export.png.label'),
        description: t('editor:export.png.description'),
        run: handlePng,
      });
    }
    if (shareEnabled) {
      items.push({
        key: 'share-cloud',
        icon: <Cloud size={16} className="w-6 flex justify-center shrink-0" />,
        label: t('settings:storage.share.menu'),
        description: t('settings:storage.description'),
        run: handleShareToCloud,
      });
    }
  }

  // ponytail: append plugin-contributed exporters matching the active file
  // type. Surfaces as a menu item that runs the registered command; the
  // exporterAdapter already pipes the result through `downloadBlob` (native
  // save dialog). Reuses runWithOverlay for the exporting spinner.
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
          <div className="dlg" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 480, padding: 24 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
              <Cloud size={18} className="text-acc" />
              <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--t1)' }}>{t('settings:storage.toast.htmlShared')}</div>
            </div>
            <div style={{ fontSize: 12, color: 'var(--t3)', marginBottom: 8 }}>{t('settings:storage.description')}</div>
            <input
              readOnly
              value={shareUrl}
              className="w-full py-2 px-2.5 border border-brd2 rounded-md bg-surf text-t1 text-[12px] font-mono outline-none"
              onFocus={(e) => e.currentTarget.select()}
            />
            <div className="dlg-ft" style={{ marginTop: 16 }}>
              <button className="btn btn-p btn-sm" onClick={() => setShareUrl(null)}>OK</button>
            </div>
          </div>
        </div>
      )}

      {/* Share error: surface the cause; user closes */}
      {shareError && (
        <div className="dlg-overlay" onClick={() => setShareError(null)}>
          <div className="dlg" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 480, padding: 24 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--t1)', marginBottom: 10 }}>
              {t('settings:storage.toast.uploadFailed')}
            </div>
            <div style={{ fontSize: 12, color: 'var(--t3)', lineHeight: 1.6, wordBreak: 'break-word' }}>
              {shareError}
            </div>
            <div className="dlg-ft" style={{ marginTop: 16 }}>
              <button className="btn btn-p btn-sm" onClick={() => setShareError(null)}>OK</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
