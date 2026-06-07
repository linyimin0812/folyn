import { useState, useRef, useEffect, useCallback } from 'react';
import { useExport, hasContainerSyntax } from '@/hooks/useExport';

export function ExportMenu() {
  const [open, setOpen] = useState(false);
  const [containerWarning, setContainerWarning] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const { exportMarkdown, exportHtml, exportPdf, getActiveContent } = useExport();

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
    } else {
      exportMarkdown();
      setOpen(false);
    }
  }, [getActiveContent, exportMarkdown]);

  const confirmExportMarkdown = useCallback(() => {
    exportMarkdown();
    setContainerWarning(false);
  }, [exportMarkdown]);

  return (
    <>
      <div className="export-wrap relative" ref={menuRef}>
        <button className="tb-btn w-[30px] h-[30px] flex items-center justify-center rounded-[5px] text-sm text-t3 transition-all duration-150 hover:bg-hov hover:text-t1" onClick={() => setOpen(!open)} title="导出">
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
                <span className="text-xs font-medium text-t1">Markdown</span>
                <span className="text-[10px] text-t3">导出 .md 源文件</span>
              </div>
            </div>
            <div
              className="flex items-center gap-2 py-2 px-2.5 rounded-[5px] cursor-pointer transition-[background] duration-100 hover:bg-hov"
              onClick={() => { exportHtml(); setOpen(false); }}
            >
              <span className="text-base w-6 text-center shrink-0">🌐</span>
              <div className="flex flex-col gap-px">
                <span className="text-xs font-medium text-t1">HTML</span>
                <span className="text-[10px] text-t3">导出为渲染后的网页</span>
              </div>
            </div>
            <div
              className="flex items-center gap-2 py-2 px-2.5 rounded-[5px] cursor-pointer transition-[background] duration-100 hover:bg-hov"
              onClick={() => { exportPdf(); setOpen(false); }}
            >
              <span className="text-base w-6 text-center shrink-0">📄</span>
              <div className="flex flex-col gap-px">
                <span className="text-xs font-medium text-t1">PDF</span>
                <span className="text-[10px] text-t3">通过打印对话框导出</span>
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
              <h3>⚠️ 兼容性提示</h3>
              <button className="dlg-close" onClick={() => setContainerWarning(false)}>✕</button>
            </div>
            <div className="dlg-body">
              <p style={{ margin: '8px 0', lineHeight: 1.7 }}>
                当前文档使用了 Quill 容器语法（如提示框、标签页、折叠面板等），
                这些语法是 Quill 的扩展功能，<strong>在其他 Markdown 编辑器中打开预览可能无法正常渲染</strong>。
              </p>
              <p style={{ margin: '8px 0', lineHeight: 1.7, fontSize: 13, color: 'var(--t3)' }}>
                如需在其他编辑器中查看，建议导出为 HTML 格式。
              </p>
            </div>
            <div className="dlg-ft">
              <button className="btn btn-g btn-sm" onClick={() => setContainerWarning(false)}>取消</button>
              <button className="btn btn-p btn-sm" onClick={confirmExportMarkdown}>仍然导出</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
