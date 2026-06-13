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

  const handleOpen = useCallback(() => {
    openFile(report.path, report.name);
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
          title="Delete"
        >
          <ThemeIcon name="delete" size={12} />
        </button>
      </div>
    </div>
  );
}

function AnalysisProgress({ message }: { message: string }) {
  return (
    <div className="mx-1.5 mb-2 p-3 rounded-lg border border-acc/30 bg-surf flex items-center gap-2.5">
      <span className="inline-block w-3.5 h-3.5 rounded-full border-[1.5px] border-brd border-t-acc animate-spin shrink-0" />
      <span className="text-[11px] text-t2">{message}</span>
    </div>
  );
}

export function AnalysisPanel() {
  const reports = useAnalysisStore((s) => s.reports);
  const isLoading = useAnalysisStore((s) => s.isLoading);
  const isAnalyzing = useAnalysisStore((s) => s.isAnalyzing);
  const analysisProgress = useAnalysisStore((s) => s.analysisProgress);
  const error = useAnalysisStore((s) => s.error);
  const loadReports = useAnalysisStore((s) => s.loadReports);
  const startAnalysis = useAnalysisStore((s) => s.startAnalysis);
  const deleteReport = useAnalysisStore((s) => s.deleteReport);

  const [showInput, setShowInput] = useState(false);
  const [url, setUrl] = useState('');
  const [lang, setLang] = useState<ReportLanguage>('auto');
  const [deleteConfirm, setDeleteConfirm] = useState<ReportFile | null>(null);

  useEffect(() => {
    loadReports();
  }, [loadReports]);

  const handleAdd = useCallback(() => {
    setShowInput(true);
  }, []);

  const handleStartAnalysis = useCallback(async () => {
    if (!url.trim() || isAnalyzing) return;
    try {
      await startAnalysis(url.trim(), lang);
      setUrl('');
      setShowInput(false);
    } catch {
      // error is handled in analysisStore
    }
  }, [url, isAnalyzing, startAnalysis, lang]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        handleStartAnalysis();
      } else if (e.key === 'Escape') {
        setShowInput(false);
        setUrl('');
      }
    },
    [handleStartAnalysis],
  );

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
        <span>GitHub Analysis</span>
        {reports.length > 0 && (
          <span className="text-t3 font-normal">({reports.length})</span>
        )}
        <button
          className="ml-auto w-5 h-5 rounded flex items-center justify-center bg-transparent border-none cursor-pointer text-t2 hover:bg-hov hover:text-t1 transition-colors"
          onClick={handleAdd}
          title="New analysis"
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

      {/* Input area */}
      {(showInput || isAnalyzing) && (
        <div className="flex flex-col">
          {showInput && !isAnalyzing && (
            <div className="mx-1.5 mb-2 p-2 rounded-lg border border-acc/30 bg-surf flex flex-col gap-2">
              <input
                type="text"
                className="w-full px-2.5 py-1.5 text-xs rounded-md border border-brd bg-bg text-t1 outline-none focus:border-acc transition-colors"
                placeholder="Paste GitHub repo URL..."
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                onKeyDown={handleKeyDown}
                disabled={isAnalyzing}
                autoFocus
              />
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] text-t3 shrink-0">Language</span>
                <div className="flex gap-1">
                  {(
                    [
                      { value: 'zh' as ReportLanguage, label: '\u4e2d\u6587' },
                      { value: 'en' as ReportLanguage, label: 'English' },
                      { value: 'auto' as ReportLanguage, label: 'Auto' },
                    ] as const
                  ).map((opt) => (
                    <button
                      key={opt.value}
                      className={`px-2 py-0.5 text-[10px] rounded-md border cursor-pointer transition-colors ${
                        lang === opt.value
                          ? 'bg-acc text-white border-acc'
                          : 'bg-bg text-t2 border-brd hover:bg-hov'
                      }`}
                      onClick={() => setLang(opt.value)}
                      disabled={isAnalyzing}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
              {error && !isAnalyzing && (
                <div className="text-[10px] text-red-500 leading-tight">
                  {error}
                </div>
              )}
              <div className="flex gap-1.5">
                <button
                  className="flex-1 py-1.5 text-xs rounded-md bg-acc text-white border-none cursor-pointer hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
                  onClick={handleStartAnalysis}
                  disabled={isAnalyzing || !url.trim()}
                >
                  Analyze
                </button>
                <button
                  className="px-3 py-1.5 text-xs rounded-md bg-bg text-t2 border border-brd cursor-pointer hover:bg-hov transition-colors"
                  onClick={() => {
                    setShowInput(false);
                    setUrl('');
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* Progress spinner */}
          {isAnalyzing && analysisProgress && (
            <AnalysisProgress message={analysisProgress} />
          )}
        </div>
      )}

      {/* Error display when not in input mode */}
      {!showInput && !isAnalyzing && error && (
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
            No analysis reports yet. Click the + button to start.
          </div>
        )}
        {isLoading && (
          <div className="p-4 text-center text-xs text-t3">Loading...</div>
        )}
      </div>

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
              Confirm Delete
            </div>
            <div className="text-[13px] text-t2 leading-relaxed mb-4">
              Are you sure you want to delete report{' '}
              <strong>
                {deleteConfirm.name.replace(/^\d{4}-\d{2}-\d{2}-/, '').replace(/\.html$/, '')}
              </strong>
              ?
            </div>
            <div className="flex justify-end gap-2">
              <button
                className="py-1.5 px-4 rounded-md text-[13px] cursor-pointer border border-brd font-ui transition-all duration-[140ms] bg-panel text-t2 hover:bg-hov"
                onClick={() => setDeleteConfirm(null)}
              >
                Cancel
              </button>
              <button
                className="py-1.5 px-4 rounded-md text-[13px] cursor-pointer border border-[#e74c3c] font-ui transition-all duration-[140ms] bg-[#e74c3c] text-white hover:bg-[#c0392b] hover:border-[#c0392b]"
                onClick={confirmDelete}
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
