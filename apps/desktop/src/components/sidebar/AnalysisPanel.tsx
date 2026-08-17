import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useAnalysisStore, type ReportMeta } from '@/store/analysisStore';
import * as editorIoService from '@/services/editorIoService';
import type { ReportLanguage } from '@/services/githubAnalysisService';
import { parseGitHubUrl } from '@/services/githubAnalysisService';
import type { StreamEvent } from '@/services/aiStreamUtils';
import { ThemeIcon } from '@/components/icons/ThemeIcon';
import { AnalyzeIcon } from '@/components/icons/AnalyzeIcon';

// ── Stream Event List (structured AI output with labels) ──

function StreamEventList({ events }: { events: StreamEvent[] }) {
  return (
    <>
      {events.map((event, i) => {
        if (event.kind === 'thinking') {
          return (
            <details key={`t-${i}`} open className="text-[10px] text-purple-400/80 italic leading-relaxed">
              <summary className="cursor-pointer text-[9px] font-semibold uppercase tracking-wider text-purple-400/60 not-italic select-none hover:text-purple-400/80 py-0.5">
                Thinking
              </summary>
              <div className="whitespace-pre-wrap break-words pl-1.5 border-l border-purple-400/20 mt-0.5 max-h-[120px] overflow-y-auto">
                {event.content}
              </div>
            </details>
          );
        }
        if (event.kind === 'tool') {
          return (
            <div key={`tool-${i}`} className="py-0.5">
              <div className="flex items-center gap-1.5">
                <span className="text-[9px] font-semibold uppercase tracking-wider text-blue-400 shrink-0">
                  {event.output ? '✓' : '▸'} Tool
                </span>
                <span className="text-[10px] text-blue-400/80 font-mono truncate">{event.content}</span>
              </div>
              {event.detail && (
                <div className="text-[9px] text-t3 font-mono pl-4 py-0.5 truncate" title={event.detail}>
                  {event.detail}
                </div>
              )}
              {event.output && (
                <div className="text-[9px] text-green-500/70 font-mono pl-4 py-0.5 truncate" title={event.output}>
                  → {event.output}
                </div>
              )}
            </div>
          );
        }
        return (
          <div key={`text-${i}`} className="text-[11px] text-t3 leading-relaxed whitespace-pre-wrap break-words">
            {event.content}
          </div>
        );
      })}
    </>
  );
}

function StreamDisplay({ events }: { events: StreamEvent[] }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (ref.current) {
      ref.current.scrollTop = ref.current.scrollHeight;
    }
  }, [events]);

  return (
    <div
      ref={ref}
      className="flex flex-col gap-1 max-h-[200px] overflow-y-auto bg-bg/50 rounded-md p-2 border border-brd/50"
    >
      <StreamEventList events={events} />
    </div>
  );
}

// ── Report Card ──

interface ReportCardProps {
  report: ReportMeta;
  onDelete: () => void;
}

function ReportCard({ report, onDelete }: ReportCardProps) {
  const { t } = useTranslation();
  const openFile = editorIoService.openFile;

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
        <div className="shrink-0 flex items-center gap-0.5">
          <button
            className="w-5 h-5 rounded flex items-center justify-center bg-transparent border-none cursor-pointer text-t3 hover:bg-red-500/10 hover:text-red-500 transition-colors"
            onClick={handleDeleteClick}
            title={t('sidebar:analysis.delete')}
          >
            <ThemeIcon name="delete" size={12} />
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Tag Section ──

interface TagSectionProps {
  tag: string;
  reports: ReportMeta[];
  collapsed: boolean;
  onToggle: () => void;
  onDeleteReport: (report: ReportMeta, tag: string) => void;
}

function TagSection({ tag, reports, collapsed, onToggle, onDeleteReport }: TagSectionProps) {
  return (
    <div className="mb-0.5">
      <button
        className="w-full flex items-center gap-2 px-3 py-2 bg-bg border-t border-brd cursor-pointer text-left hover:bg-hov transition-colors group"
        onClick={onToggle}
      >
        <ThemeIcon name="folder" size={14} className="shrink-0 text-t3" />
        <span className="text-[12px] text-t1 font-semibold truncate">{tag}</span>
        <span className="text-[10px] text-t3 ml-auto shrink-0">{reports.length}</span>
      </button>
      {!collapsed && (
        <div className="mt-1.5 ml-2.5 pl-2 border-l-2 border-acc/20">
          {reports.map((report) => (
            <ReportCard
              key={report.path}
              report={report}
              onDelete={() => onDeleteReport(report, tag)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Delete Confirmation Dialog ──

interface DeleteConfirmProps {
  report: ReportMeta;
  tag: string;
  tagCount: number;
  onConfirm: () => void;
  onCancel: () => void;
}

function DeleteConfirm({ report, tag, tagCount, onConfirm, onCancel }: DeleteConfirmProps) {
  const { t } = useTranslation();
  const repoName = report.name.replace(/^\d{4}-\d{2}-\d{2}-/, '').replace(/\.html$/, '');
  const isLastTag = tagCount <= 1;

  return (
    <div
      className="fixed inset-0 z-[9999] bg-black/35 flex items-center justify-center"
      onClick={onCancel}
    >
      <div
        className="bg-panel rounded-[10px] py-5 px-6 min-w-[300px] max-w-[400px] shadow-[0_8px_32px_rgba(0,0,0,0.18)] border border-brd"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="text-[15px] font-semibold text-t1 mb-2">
          {isLastTag ? t('sidebar:analysis.deleteConfirm.titleDelete') : t('sidebar:analysis.deleteConfirm.titleRemoveTag')}
        </div>
        <div className="text-[13px] text-t2 leading-relaxed mb-4">
          {isLastTag ? (
            <>{t('sidebar:analysis.deleteConfirm.deletePrefix')}<strong>{repoName}</strong>{t('sidebar:analysis.deleteConfirm.deleteSuffix')}</>
          ) : (
            <>{t('sidebar:analysis.deleteConfirm.removeTagPrefix')}<strong>{repoName}</strong>{t('sidebar:analysis.deleteConfirm.removeTagMiddle')}<strong>{tag}</strong>{t('sidebar:analysis.deleteConfirm.removeTagSuffix')}<br />
            <span className="text-[11px] text-t3">{t('sidebar:analysis.deleteConfirm.removeTagHint', { count: tagCount - 1 })}</span></>
          )}
        </div>
        <div className="flex justify-end gap-2">
          <button
            className="py-1.5 px-4 rounded-md text-[13px] cursor-pointer border border-brd font-ui transition-all duration-[140ms] bg-panel text-t2 hover:bg-hov"
            onClick={onCancel}
          >
            {t('sidebar:clips.cancel')}
          </button>
          <button
            className="py-1.5 px-4 rounded-md text-[13px] cursor-pointer border border-[#e74c3c] font-ui transition-all duration-[140ms] bg-[#e74c3c] text-white hover:bg-[#c0392b] hover:border-[#c0392b]"
            onClick={onConfirm}
          >
            {isLastTag ? t('sidebar:clips.delete') : t('sidebar:analysis.deleteConfirm.titleRemoveTag')}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Dedup Warning Dialog ──

interface DedupWarningProps {
  existingReport: ReportMeta;
  onRegenerate: () => void;
  onCancel: () => void;
}

function DedupWarning({ existingReport, onRegenerate, onCancel }: DedupWarningProps) {
  const { t } = useTranslation();
  const dateMatch = existingReport.name.match(/^(\d{4}-\d{2}-\d{2})/);
  const dateStr = dateMatch ? dateMatch[1] : '';
  const repoName = existingReport.name
    .replace(/^\d{4}-\d{2}-\d{2}-/, '')
    .replace(/\.html$/, '');

  return (
    <div className="flex flex-col gap-3 mt-2">
      <div className="flex items-start gap-2 p-2.5 rounded-md bg-amber-500/8 border border-amber-500/20">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-amber-500 shrink-0 mt-0.5">
          <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
          <line x1="12" y1="9" x2="12" y2="13" />
          <line x1="12" y1="17" x2="12.01" y2="17" />
        </svg>
        <div className="flex-1 min-w-0">
          <div className="text-[12px] text-t1 font-medium mb-0.5">
            {t('sidebar:analysis.dedup.title')}
          </div>
          <div className="text-[11px] text-t2">
            {repoName}（{dateStr}）
          </div>
        </div>
      </div>
      <div className="flex gap-2">
        <button
          className="flex-1 py-2 text-[13px] rounded-md bg-acc text-white border-none cursor-pointer hover:opacity-90 transition-opacity font-medium"
          onClick={onRegenerate}
        >
          {t('sidebar:analysis.dedup.regenerate')}
        </button>
        <button
          className="px-4 py-2 text-[13px] rounded-md bg-bg text-t2 border border-brd cursor-pointer hover:bg-hov transition-colors"
          onClick={onCancel}
        >
          {t('sidebar:clips.cancel')}
        </button>
      </div>
    </div>
  );
}

// ── Editable Tag Chips ──

interface EditableTagChipsProps {
  tags: string[];
  onChange: (tags: string[]) => void;
}

function EditableTagChips({ tags, onChange }: EditableTagChipsProps) {
  const { t } = useTranslation();
  const [inputValue, setInputValue] = useState('');

  const handleRemove = useCallback(
    (tagToRemove: string) => {
      onChange(tags.filter((t) => t !== tagToRemove));
    },
    [tags, onChange],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const newTag = inputValue.toLowerCase().trim();
        if (newTag && !tags.includes(newTag)) {
          onChange([...tags, newTag]);
        }
        setInputValue('');
      }
    },
    [inputValue, tags, onChange],
  );

  return (
    <div className="flex flex-wrap items-center gap-1.5 p-2 rounded-md border border-brd bg-bg min-h-[36px]">
      {tags.map((tag) => (
        <span
          key={tag}
          className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[11px] font-medium bg-acc/10 text-acc leading-none"
        >
          {tag}
          <button
            className="w-3.5 h-3.5 rounded flex items-center justify-center bg-transparent border-none cursor-pointer text-acc/60 hover:text-acc hover:bg-acc/15 transition-colors p-0"
            onClick={() => handleRemove(tag)}
          >
            <svg width="8" height="8" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M4 4l8 8M12 4l-8 8" strokeLinecap="round" />
            </svg>
          </button>
        </span>
      ))}
      <input
        type="text"
        className="flex-1 min-w-[80px] bg-transparent border-none outline-none text-[11px] text-t1 placeholder:text-t3 py-0.5"
        placeholder={tags.length === 0 ? t('sidebar:analysis.tagPlaceholderEmpty') : t('sidebar:analysis.tagPlaceholderMore')}
        value={inputValue}
        onChange={(e) => setInputValue(e.target.value)}
        onKeyDown={handleKeyDown}
      />
    </div>
  );
}

// ── Confirmation Mode ──

interface ConfirmationModeProps {
  pendingReport: { tags: string[]; html: string; repo: string; url: string };
  isSaving: boolean;
  onConfirm: (tags: string[]) => void;
  onCancel: () => void;
}

function ConfirmationMode({ pendingReport, isSaving, onConfirm, onCancel }: ConfirmationModeProps) {
  const { t } = useTranslation();
  const [editedTags, setEditedTags] = useState<string[]>(pendingReport.tags);
  const htmlSizeKB = Math.round(pendingReport.html.length / 1024);

  const handleConfirm = useCallback(() => {
    onConfirm(editedTags);
  }, [editedTags, onConfirm]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape' && !isSaving) {
        onCancel();
      }
    },
    [isSaving, onCancel],
  );

  return (
    <div className="flex flex-col gap-3" onKeyDown={handleKeyDown}>
      {/* Success header */}
      <div className="flex items-center gap-2 p-2.5 rounded-md bg-green-500/8 border border-green-500/20">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-green-500 shrink-0">
          <path d="M20 6L9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <div className="flex-1 min-w-0">
          <div className="text-[12px] text-t1 font-medium">
            {t('sidebar:analysis.confirmation.success', { repo: pendingReport.repo })}
          </div>
          <div className="text-[10px] text-t3 truncate mt-0.5">
            {pendingReport.url}
          </div>
        </div>
      </div>

      {/* HTML Preview */}
      <div className="flex flex-col gap-1.5">
        <label className="text-[11px] text-t3 font-medium">
          {t('sidebar:analysis.confirmation.previewLabel')}
        </label>
        <div className="rounded-md border border-brd overflow-hidden bg-white">
          <iframe
            srcDoc={pendingReport.html}
            title="Report Preview"
            sandbox=""
            className="w-full h-[180px] border-none"
          />
        </div>
        <div className="text-[10px] text-t3 flex items-center gap-1.5">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
            <path d="M14 2v6h6" />
          </svg>
          {t('sidebar:analysis.confirmation.htmlSize', { kb: htmlSizeKB, count: pendingReport.tags.length })}
        </div>
      </div>

      {/* Tags editor */}
      <div className="flex flex-col gap-1.5">
        <label className="text-[11px] text-t3 font-medium">
          {t('sidebar:analysis.confirmation.tagsLabel')}
        </label>
        <EditableTagChips tags={editedTags} onChange={setEditedTags} />
      </div>

      {/* Actions */}
      <div className="flex gap-2 mt-1">
        <button
          className="flex-1 py-2 text-[13px] rounded-md bg-acc text-white border-none cursor-pointer hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed font-medium"
          onClick={handleConfirm}
          disabled={isSaving}
        >
          {isSaving ? t('sidebar:clips.saving') : t('sidebar:clips.save')}
        </button>
        <button
          className="px-4 py-2 text-[13px] rounded-md bg-bg text-t2 border border-brd cursor-pointer hover:bg-hov transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          onClick={onCancel}
          disabled={isSaving}
        >
          {t('sidebar:clips.cancel')}
        </button>
      </div>
    </div>
  );
}

// ── Analysis Dialog ──

function AnalysisDialog({
  onClose,
}: {
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const isAnalyzing = useAnalysisStore((s) => s.isAnalyzing);
  const analysisProgress = useAnalysisStore((s) => s.analysisProgress);
  const error = useAnalysisStore((s) => s.error);
  const pendingReport = useAnalysisStore((s) => s.pendingReport);
  const aiStreamEvents = useAnalysisStore((s) => s.aiStreamEvents);
  const generateAnalysis = useAnalysisStore((s) => s.generateAnalysis);
  const confirmAnalysis = useAnalysisStore((s) => s.confirmAnalysis);
  const cancelAnalysis = useAnalysisStore((s) => s.cancelAnalysis);
  const setPendingOverwritePath = useAnalysisStore((s) => s.setPendingOverwritePath);
  const findExistingReport = useAnalysisStore((s) => s.findExistingReport);

  const [url, setUrl] = useState('');
  const [lang, setLang] = useState<ReportLanguage>('auto');
  const [existingReport, setExistingReport] = useState<ReportMeta | null>(null);

  const handleStart = useCallback(async () => {
    if (!url.trim() || isAnalyzing) return;

    // Check for existing report
    try {
      const { repo } = parseGitHubUrl(url.trim());
      const existing = findExistingReport(repo);
      if (existing) {
        setExistingReport(existing);
        return;
      }
    } catch {
      // Invalid URL — let generateAnalysis handle the error
    }

    try {
      await generateAnalysis(url.trim(), lang);
    } catch {
      // error is shown below from store
    }
  }, [url, isAnalyzing, generateAnalysis, lang, findExistingReport]);

  const handleRegenerate = useCallback(async () => {
    if (!existingReport || !url.trim() || isAnalyzing) return;

    // Set the old report path so it gets deleted after saving
    setPendingOverwritePath(existingReport.path);
    setExistingReport(null);

    try {
      await generateAnalysis(url.trim(), lang);
    } catch {
      // error is shown below from store
    }
  }, [existingReport, url, isAnalyzing, generateAnalysis, lang, setPendingOverwritePath]);

  const handleCancelDedup = useCallback(() => {
    setExistingReport(null);
  }, []);

  const handleConfirm = useCallback(
    async (tags: string[]) => {
      try {
        await confirmAnalysis(tags);
        onClose();
      } catch {
        // error is shown below from store
      }
    },
    [confirmAnalysis, onClose],
  );

  const handleCancelPending = useCallback(() => {
    cancelAnalysis();
    onClose();
  }, [cancelAnalysis, onClose]);

  const handleClose = useCallback(() => {
    if (pendingReport) {
      cancelAnalysis();
    }
    onClose();
  }, [pendingReport, cancelAnalysis, onClose]);
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey && !pendingReport && !isAnalyzing) {
        e.preventDefault();
        handleStart();
      } else if (e.key === 'Escape') {
        if (pendingReport) {
          cancelAnalysis();
          onClose();
        } else if (existingReport) {
          setExistingReport(null);
        } else {
          onClose();
        }
      }
    },
    [handleStart, isAnalyzing, onClose, existingReport, pendingReport, cancelAnalysis],
  );

  return (
    <div
      className="fixed inset-0 z-[9999] bg-black/35 flex items-center justify-center"
      onClick={() => handleClose()}
    >
      <div
        className="bg-panel rounded-[10px] py-5 px-6 w-[420px] max-h-[75vh] shadow-[0_8px_32px_rgba(0,0,0,0.18)] border border-brd flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Title */}
        <div className="flex items-center gap-2 mb-4">
          <AnalyzeIcon size={16} />
          <span className="text-[15px] font-semibold text-t1">{t('sidebar:analysis.dialog.title')}</span>
        </div>

        {/* Scrollable content area */}
        <div className="flex-1 overflow-y-auto min-h-0">

        {/* Input mode */}
        {!isAnalyzing && !existingReport && !pendingReport && (
          <div className="flex flex-col gap-3">
            {/* URL input */}
            <div className="flex flex-col gap-1.5">
              <label className="text-[11px] text-t3 font-medium">{t('sidebar:analysis.dialog.urlLabel')}</label>
              <input
                type="text"
                className="w-full px-3 py-2 text-[13px] rounded-md border border-brd bg-bg text-t1 outline-none focus:border-acc transition-colors"
                placeholder={t('sidebar:analysis.dialog.urlPlaceholder')}
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                onKeyDown={handleKeyDown}
                autoFocus
              />
            </div>

            {/* Language selector */}
            <div className="flex flex-col gap-1.5">
              <label className="text-[11px] text-t3 font-medium">{t('sidebar:analysis.dialog.langLabel')}</label>
              <div className="flex gap-1.5">
                {(
                  [
                    { value: 'zh' as ReportLanguage, label: t('sidebar:analysis.dialog.langZh') },
                    { value: 'en' as ReportLanguage, label: t('sidebar:analysis.dialog.langEn') },
                    { value: 'auto' as ReportLanguage, label: t('sidebar:analysis.dialog.langAuto') },
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
                {t('sidebar:analysis.dialog.start')}
              </button>
              <button
                className="px-4 py-2 text-[13px] rounded-md bg-bg text-t2 border border-brd cursor-pointer hover:bg-hov transition-colors"
                onClick={onClose}
              >
                {t('sidebar:clips.cancel')}
              </button>
            </div>
          </div>
        )}

        {/* Dedup warning */}
        {!isAnalyzing && existingReport && !pendingReport && (
          <DedupWarning
            existingReport={existingReport}
            onRegenerate={handleRegenerate}
            onCancel={handleCancelDedup}
          />
        )}

        {/* Progress mode */}
        {isAnalyzing && !pendingReport && (
          <div className="flex flex-col gap-3 py-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <span className="inline-block w-5 h-5 rounded-full border-[2px] border-brd border-t-acc animate-spin" />
                <span className="text-[13px] text-t2">{analysisProgress || t('sidebar:analysis.dialog.progressDefault')}</span>
              </div>
              <button
                className="py-1 px-3 text-[12px] rounded-md bg-bg text-t2 border border-brd cursor-pointer hover:bg-hov transition-colors"
                onClick={onClose}
              >
                {t('sidebar:analysis.dialog.hide')}
              </button>
            </div>
            {aiStreamEvents.length > 0 && <StreamDisplay events={aiStreamEvents} />}
            <div className="text-[11px] text-t3 text-center">{t('sidebar:analysis.dialog.patience')}</div>
          </div>
        )}

        {/* Confirmation mode */}
        {!isAnalyzing && pendingReport && (
          <ConfirmationMode
            pendingReport={pendingReport}
            isSaving={false}
            onConfirm={handleConfirm}
            onCancel={handleCancelPending}
          />
        )}

        </div> {/* end scrollable content */}
      </div>
    </div>
  );
}

// ── Main Panel ──

export function AnalysisPanel() {
  const { t } = useTranslation();
  const reports = useAnalysisStore((s) => s.reports);
  const isLoading = useAnalysisStore((s) => s.isLoading);
  const error = useAnalysisStore((s) => s.error);
  const loadReports = useAnalysisStore((s) => s.loadReports);
  const deleteReport = useAnalysisStore((s) => s.deleteReport);
  const removeTag = useAnalysisStore((s) => s.removeTag);
  const isAnalyzing = useAnalysisStore((s) => s.isAnalyzing);
  const pendingReport = useAnalysisStore((s) => s.pendingReport);

  const [showDialog, setShowDialog] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<{ report: ReportMeta; tag: string; tagCount: number } | null>(null);
  const [collapsedTags, setCollapsedTags] = useState<Set<string>>(new Set());

  useEffect(() => {
    loadReports();
  }, [loadReports]);

  // Auto-open dialog when analysis is complete and report is ready for confirmation
  useEffect(() => {
    if (pendingReport) {
      setShowDialog(true);
    }
  }, [pendingReport]);

  // Group reports by tags
  const { tagGroups, uncategorized } = useMemo(() => {
    const tagMap = new Map<string, ReportMeta[]>();
    const noTags: ReportMeta[] = [];

    for (const report of reports) {
      if (report.tags.length === 0) {
        noTags.push(report);
      } else {
        for (const tag of report.tags) {
          const list = tagMap.get(tag) || [];
          list.push(report);
          tagMap.set(tag, list);
        }
      }
    }

    const sortedTags = Array.from(tagMap.keys()).sort();
    const groups = sortedTags.map((tag) => ({
      tag,
      reports: tagMap.get(tag)!,
    }));

    return { tagGroups: groups, uncategorized: noTags };
  }, [reports]);

  const handleDeleteClick = useCallback((report: ReportMeta, tag: string) => {
    setDeleteConfirm({ report, tag, tagCount: report.tags.length });
  }, []);

  const confirmDelete = useCallback(async () => {
    if (!deleteConfirm) return;
    const { report, tag, tagCount } = deleteConfirm;
    setDeleteConfirm(null);
    try {
      if (tagCount <= 1) {
        // Last tag — delete the entire report
        await deleteReport(report.path);
      } else {
        // Remove just this tag, keep the report
        await removeTag(report.path, tag);
      }
    } catch (err) {
      console.error('[AnalysisPanel] Failed to delete:', err);
    }
  }, [deleteConfirm, deleteReport, removeTag]);

  const handleToggleTag = useCallback((tag: string) => {
    setCollapsedTags((prev) => {
      const next = new Set(prev);
      if (next.has(tag)) {
        next.delete(tag);
      } else {
        next.add(tag);
      }
      return next;
    });
  }, []);

  const hasAnyReports = reports.length > 0;

  return (
    <div className="flex-1 overflow-y-auto flex flex-col">
      {/* Header */}
      <div className="py-2 px-3 text-[11px] font-semibold text-t3 uppercase tracking-[0.5px] flex items-center gap-1.5">
        <AnalyzeIcon size={12} />
        <span>{t('sidebar:analysis.title')}</span>
        {hasAnyReports && (
          <span className="text-t3 font-normal">({reports.length})</span>
        )}
        {isAnalyzing && !showDialog && (
          <span
            className="ml-1 flex items-center gap-1 text-acc text-[10px] cursor-pointer hover:opacity-80"
            onClick={() => setShowDialog(true)}
            title={t('sidebar:analysis.viewDetails')}
          >
            <span className="w-1.5 h-1.5 rounded-full bg-acc animate-pulse" />
            {t('sidebar:analysis.analyzing')}
          </span>
        )}
        <button
          className="ml-auto w-5 h-5 rounded flex items-center justify-center bg-transparent border-none cursor-pointer text-t2 hover:bg-hov hover:text-t1 transition-colors"
          onClick={() => setShowDialog(true)}
          title={t('sidebar:analysis.newAnalysis')}
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
        {/* Tag sections */}
        {tagGroups.map(({ tag, reports: tagReports }) => (
          <TagSection
            key={tag}
            tag={tag}
            reports={tagReports}
            collapsed={collapsedTags.has(tag)}
            onToggle={() => handleToggleTag(tag)}
            onDeleteReport={handleDeleteClick}
          />
        ))}

        {/* Uncategorized section */}
        {uncategorized.length > 0 && (
          <div className="mb-0.5">
            {tagGroups.length > 0 && (
              <button
                className="w-full flex items-center gap-2 px-3 py-2 bg-bg border-t border-brd cursor-pointer text-left hover:bg-hov transition-colors group"
                onClick={() => handleToggleTag('__uncategorized__')}
              >
                <ThemeIcon name="folder" size={14} className="shrink-0 text-t3" />
                <span className="text-[12px] text-t1 font-semibold truncate">{t('sidebar:analysis.uncategorized')}</span>
                <span className="text-[10px] text-t3 ml-auto shrink-0">{uncategorized.length}</span>
              </button>
            )}
            {!collapsedTags.has('__uncategorized__') && (
              <div className={tagGroups.length > 0 ? 'mt-1.5 ml-2.5 pl-2 border-l-2 border-acc/20' : ''}>
                {uncategorized.map((report) => (
                  <ReportCard
                    key={report.path}
                    report={report}
                    onDelete={() => handleDeleteClick(report, '')}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        {/* Empty state */}
        {!hasAnyReports && !isLoading && (
          <div className="p-4 text-center text-xs text-t3 leading-relaxed">
            {t('sidebar:analysis.empty')}
          </div>
        )}
        {isLoading && (
          <div className="p-4 text-center text-xs text-t3">{t('sidebar:analysis.loading')}</div>
        )}
      </div>

      {/* Analysis dialog */}
      {(showDialog || pendingReport) && (
        <AnalysisDialog onClose={() => setShowDialog(false)} />
      )}

      {/* Delete confirmation dialog */}
      {deleteConfirm && (
        <DeleteConfirm
          report={deleteConfirm.report}
          tag={deleteConfirm.tag}
          tagCount={deleteConfirm.tagCount}
          onConfirm={confirmDelete}
          onCancel={() => setDeleteConfirm(null)}
        />
      )}
    </div>
  );
}
