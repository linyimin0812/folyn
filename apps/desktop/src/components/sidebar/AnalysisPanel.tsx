import { useState, useEffect, useCallback } from 'react';
import { useAnalysisStore, type ReportFile } from '@/store/analysisStore';
import { useEditorStore } from '@/store/editorStore';
import type { ReportLanguage } from '@/services/githubAnalysisService';
import { ThemeIcon } from '@/components/icons/ThemeIcon';

function ReportCard({
  report,
  onDelete,
}: {
  report: ReportFile;
  onDelete: () => void;
}) {
  const openFile = useEditorStore((s) => s.openFile);

  const handleOpen = useCallback(async () => {
    try {
      await openFile(report.path, report.name);
    } catch (err) {
      console.error('[AnalysisPanel] Failed to open report:', report.path, err);
    }
  }, [report.path, report.name, openFile]);

  const handleDeleteClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onDelete();
    },
    [onDelete],
  );

  // Parse date from filename: "2026-06-13-repo-name.html"
  const dateMatch = report.name.match(/^(\d{4}-\d{2}-\d{2})/);
  const dateStr = dateMatch ? dateMatch[1] : '';
  const repoName = report.name
    .replace(/^\d{4}-\d{2}-\d{2}-/, '')
    .replace(/\.html$/, '');

  return (
    <div
      className="clip-card flex flex-col gap-1.5 p-2.5 mx-1.5 mb-1.5 rounded-lg border border-brd bg-surf cursor-pointer transition-all duration-150 hover:border-acc hover:shadow-[0_1px_4px_rgba(0,0,0,.08)]"
      onClick={handleOpen}
    >
      <div className="flex items-start gap-2 min-w-0">
        <div className="flex-1 min-w-0">
          <div className="text-[calc(var(--ui-font-size)-2px)] text-t1 font-medium break-words leading-snug">
            {repoName}
          </div>
          {dateStr && (
            <div className="text-[10px] text-t3 mt-0.5">{dateStr}</div>
          )}
        </div>
        <button
          className="shrink-0 w-5 h-5 rounded flex items-center justify-center bg-transparent border-none cursor-pointer text-t3 hover:bg-red-500/10 hover:text-red-500 transition-colors"
          onClick={handleDeleteClick}
          title="删除"
        >
          <ThemeIcon name="delete" size={12} />
        </button>
      </div>
    </div>
  );
}

/** Dialog for creating new GitHub analysis */
function AnalysisDialog({
  onClose,
}: {
  onClose: () => void;
}) {
  const isAnalyzing = useAnalysisStore((s) => s.isAnalyzing);
  const analysisProgress = useAnalysisStore((s) => s.analysisProgress);
  const error = useAnalysisStore((s) => s.error);
  const startAnalysis = useAnalysisStore((s) => s.startAnalysis);

  const [url, setUrl] = useState('');
  const [lang, setLang] = useState<ReportLanguage>('auto');

  const handleStart = useCallback(async () => {
    if (!url.trim() || isAnalyzing) return;
    try {
      await startAnalysis(url.trim(), lang);
      onClose();
    } catch {
      // error is shown below from store
    }
  }, [url, isAnalyzing, startAnalysis, lang, onClose]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleStart();
      } else if (e.key === 'Escape' && !isAnalyzing) {
        onClose();
      }
    },
    [handleStart, isAnalyzing, onClose],
  );

  return (
    <div
      className="fixed inset-0 z-[9999] bg-black/35 flex items-center justify-center"
      onClick={() => !isAnalyzing && onClose()}
    >
      <div
        className="bg-panel rounded-[10px] py-5 px-6 w-[380px] shadow-[0_8px_32px_rgba(0,0,0,0.18)] border border-brd"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Title */}
        <div className="flex items-center gap-2 mb-4">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" className="text-acc">
            <path d="M21 21H4.6c-.56 0-.84 0-1.054-.109a1 1 0 01-.437-.437C3 20.24 3 19.96 3 19.4V3" />
            <path d="M7 14l4-4 4 4 6-6" />
          </svg>
          <span className="text-[15px] font-semibold text-t1">新建项目分析</span>
        </div>

        {/* Input mode */}
        {!isAnalyzing && (
          <div className="flex flex-col gap-3">
            {/* URL input */}
            <div className="flex flex-col gap-1.5">
              <label className="text-[11px] text-t3 font-medium">GitHub 仓库链接</label>
              <input
                type="text"
                className="w-full px-3 py-2 text-[13px] rounded-md border border-brd bg-bg text-t1 outline-none focus:border-acc transition-colors"
                placeholder="https://github.com/owner/repo"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                onKeyDown={handleKeyDown}
                autoFocus
              />
            </div>

            {/* Language selector */}
            <div className="flex flex-col gap-1.5">
              <label className="text-[11px] text-t3 font-medium">报告语言</label>
              <div className="flex gap-1.5">
                {(
                  [
                    { value: 'zh' as ReportLanguage, label: '中文' },
                    { value: 'en' as ReportLanguage, label: 'English' },
                    { value: 'auto' as ReportLanguage, label: '自动检测' },
                  ] as const
                ).map((opt) => (
                  <button
                    key={opt.value}
                    className={`flex-1 px-2 py-1.5 text-[12px] rounded-md border cursor-pointer transition-colors ${
                      lang === opt.value
                        ? 'bg-acc text-white border-acc'
                        : 'bg-bg text-t2 border-brd hover:bg-hov'
                    }`}
                    onClick={() => setLang(opt.value)}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Error */}
            {error && (
              <div className="text-[11px] text-red-500 bg-red-500/5 border border-red-500/20 rounded-md px-2.5 py-1.5">
                {error}
              </div>
            )}

            {/* Actions */}
            <div className="flex gap-2 mt-1">
              <button
                className="flex-1 py-2 text-[13px] rounded-md bg-acc text-white border-none cursor-pointer hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed font-medium"
                onClick={handleStart}
                disabled={!url.trim()}
              >
                开始分析
              </button>
              <button
                className="px-4 py-2 text-[13px] rounded-md bg-bg text-t2 border border-brd cursor-pointer hover:bg-hov transition-colors"
                onClick={onClose}
              >
                取消
              </button>
            </div>
          </div>
        )}

        {/* Progress mode */}
        {isAnalyzing && (
          <div className="flex flex-col items-center gap-3 py-4">
            <span className="inline-block w-8 h-8 rounded-full border-[2.5px] border-brd border-t-acc animate-spin" />
            <div className="text-[13px] text-t2 text-center">{analysisProgress || '准备中...'}</div>
            <div className="text-[11px] text-t3 text-center">分析过程可能需要几分钟，请耐心等待</div>
          </div>
        )}
      </div>
    </div>
  );
}

export function AnalysisPanel() {
  const reports = useAnalysisStore((s) => s.reports);
  const isLoading = useAnalysisStore((s) => s.isLoading);
  const error = useAnalysisStore((s) => s.error);
  const loadReports = useAnalysisStore((s) => s.loadReports);
  const deleteReport = useAnalysisStore((s) => s.deleteReport);

  const [showDialog, setShowDialog] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<ReportFile | null>(null);

  useEffect(() => {
    loadReports();
  }, [loadReports]);

  const handleDeleteClick = useCallback((report: ReportFile) => {
    setDeleteConfirm(report);
  }, []);

  const confirmDelete = useCallback(async () => {
    if (!deleteConfirm) return;
    try {
      await deleteReport(deleteConfirm.path);
    } catch (err) {
      console.error('[AnalysisPanel] Failed to delete report:', err);
    }
    setDeleteConfirm(null);
  }, [deleteConfirm, deleteReport]);

  return (
    <div className="flex-1 overflow-y-auto flex flex-col">
      {/* Header */}
      <div className="py-2 px-3 text-[11px] font-semibold text-t3 uppercase tracking-[0.5px] flex items-center gap-1.5">
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
        >
          <path d="M21 21H4.6c-.56 0-.84 0-1.054-.109a1 1 0 01-.437-.437C3 20.24 3 19.96 3 19.4V3" />
          <path d="M7 14l4-4 4 4 6-6" />
        </svg>
        <span>项目分析</span>
        {reports.length > 0 && (
          <span className="text-t3 font-normal">({reports.length})</span>
        )}
        <button
          className="ml-auto w-5 h-5 rounded flex items-center justify-center bg-transparent border-none cursor-pointer text-t2 hover:bg-hov hover:text-t1 transition-colors"
          onClick={() => setShowDialog(true)}
          title="新建分析"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
          >
            <path d="M8 3v10M3 8h10" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      {/* Error display */}
      {error && (
        <div className="mx-1.5 mb-2 p-2 rounded-lg border border-red-500/20 bg-red-500/5">
          <div className="text-[10px] text-red-500 leading-tight">{error}</div>
        </div>
      )}

      {/* Report list */}
      <div className="flex-1 overflow-y-auto pt-0.5 pb-2">
        {reports.map((report) => (
          <ReportCard
            key={report.path}
            report={report}
            onDelete={() => handleDeleteClick(report)}
          />
        ))}
        {reports.length === 0 && !isLoading && (
          <div className="p-4 text-center text-xs text-t3 leading-relaxed">
            暂无分析报告。点击右上角 + 按钮开始分析。
          </div>
        )}
        {isLoading && (
          <div className="p-4 text-center text-xs text-t3">加载中...</div>
        )}
      </div>

      {/* Analysis dialog */}
      {showDialog && (
        <AnalysisDialog onClose={() => setShowDialog(false)} />
      )}

      {/* Delete confirmation dialog */}
      {deleteConfirm && (
        <div
          className="fixed inset-0 z-[9999] bg-black/35 flex items-center justify-center"
          onClick={() => setDeleteConfirm(null)}
        >
          <div
            className="bg-panel rounded-[10px] py-5 px-6 min-w-[300px] max-w-[400px] shadow-[0_8px_32px_rgba(0,0,0,0.18)] border border-brd"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="text-[15px] font-semibold text-t1 mb-2">
              确认删除
            </div>
            <div className="text-[13px] text-t2 leading-relaxed mb-4">
              确定要删除分析报告{' '}
              <strong>
                {deleteConfirm.name.replace(/^\d{4}-\d{2}-\d{2}-/, '').replace(/\.html$/, '')}
              </strong>
              吗？
            </div>
            <div className="flex justify-end gap-2">
              <button
                className="py-1.5 px-4 rounded-md text-[13px] cursor-pointer border border-brd font-ui transition-all duration-[140ms] bg-panel text-t2 hover:bg-hov"
                onClick={() => setDeleteConfirm(null)}
              >
                取消
              </button>
              <button
                className="py-1.5 px-4 rounded-md text-[13px] cursor-pointer border border-[#e74c3c] font-ui transition-all duration-[140ms] bg-[#e74c3c] text-white hover:bg-[#c0392b] hover:border-[#c0392b]"
                onClick={confirmDelete}
              >
                删除
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
