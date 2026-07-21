import { useState, useRef, useEffect, useCallback } from 'react';
import { useExport, hasContainerSyntax } from '@/hooks/useExport';
import { useTranslation } from 'react-i18next';

export function ExportMenu() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [containerWarning, setContainerWarning] = useState(false);
  const [exporting, setExporting] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const { exportMarkdown, exportHtml, getActiveContent } = useExport();

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    if (open) document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  const handleExportMarkdown = useCallback(() => {
    const { content } = getActiveContent();
    if (hasContainerSyntax(content)) {
      setContainerWarning(true);
      setOpen(false);
      return;
    }
    setOpen(false);
    setExporting(true);
    exportMarkdown(() => setExporting(false));
  }, [getActiveContent, exportMarkdown]);

  const confirmExportMarkdown = useCallback(() => {
    setContainerWarning(false);
    setExporting(true);
    exportMarkdown(() => setExporting(false));
  }, [exportMarkdown]);

  const handleExportHtml = useCallback(() => {
    setOpen(false);
    setExporting(true);
    exportHtml(() => setExporting(false)).catch(() => setExporting(false));
  }, [exportHtml]);

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
            <div className="flex items-center gap-2 py-2 px-2.5 rounded-[5px] cursor-pointer transition-[background] duration-100 hover:bg-hov" onClick={handleExportMarkdown}>
              <span className="text-base w-6 text-center shrink-0">📝</span>
              <div className="flex flex-col gap-px">
                <span className="text-xs font-medium text-t1">{t('editor:export.markdown.label')}</span>
                <span className="text-[10px] text-t3">{t('editor:export.markdown.description')}</span>
              </div>
            </div>
            <div
              className="flex items-center gap-2 py-2 px-2.5 rounded-[5px] cursor-pointer transition-[background] duration-100 hover:bg-hov"
              onClick={handleExportHtml}
            >
              <span className="text-base w-6 text-center shrink-0">🌐</span>
              <div className="flex flex-col gap-px">
                <span className="text-xs font-medium text-t1">{t('editor:export.html.label')}</span>
                <span className="text-[10px] text-t3">{t('editor:export.html.description')}</span>
              </div>
            </div>
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
              <button className="btn btn-p btn-sm" onClick={confirmExportMarkdown}>{t('editor:export.containerWarning.confirm')}</button>
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
    </>
  );
}
