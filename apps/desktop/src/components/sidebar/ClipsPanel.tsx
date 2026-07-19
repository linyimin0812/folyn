import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useClipStore, type ClipFile, type BatchItemStatus } from '@/store/clipStore';
import type { ClipMetadata, ClipLanguage } from '@/services/clipService';
import type { StreamEvent } from '@/services/aiStreamUtils';
import { useEditorStore } from '@/store/editorStore';
import * as editorIoService from '@/services/editorIoService';
import { useVaultStore } from '@/store/vaultStore';
import { ThemeIcon } from '@/components/icons/ThemeIcon';

interface ClipMeta {
  title: string;
  url: string;
}

function parseFrontmatter(content: string): ClipMeta {
  const fm: Record<string, string> = {};
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return { title: '', url: '' };

  for (const line of match[1].split('\n')) {
    const idx = line.indexOf(':');
    if (idx < 0) continue;
    const key = line.slice(0, idx).trim();
    let value = line.slice(idx + 1).trim();
    if (value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1);
    }
    fm[key] = value;
  }

  return {
    title: fm['title'] || '',
    url: fm['url'] || '',
  };
}

function getHostname(url: string): string {
  try { return new URL(url).hostname; } catch { return url; }
}

function ClipCard({ clip, onDelete }: { clip: ClipFile; onDelete: () => void }) {
  const { t } = useTranslation();
  const openFile = editorIoService.openFile;
  const openWebFromClip = useEditorStore((s) => s.openWebFromClip);
  const readFile = useVaultStore((s) => s.readFile);
  const [meta, setMeta] = useState<ClipMeta | null>(null);

  useEffect(() => {
    let cancelled = false;
    readFile(clip.path).then((content) => {
      if (!cancelled) setMeta(parseFrontmatter(content));
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [clip.path, readFile]);

  const handleOpen = useCallback(() => {
    openFile(clip.path, clip.name);
  }, [clip.path, clip.name, openFile]);

  const handleOpenUrl = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!meta?.url) return;
    // First open the clip file to create a tab
    await openFile(clip.path, clip.name);
    // Then convert that tab to web view with clipPath set
    const tabId = useEditorStore.getState().activeTabId;
    if (tabId) {
      openWebFromClip(tabId, meta.url, clip.path, meta.title);
    }
  }, [meta?.url, meta?.title, clip.path, clip.name, openFile, openWebFromClip]);

  const handleDeleteClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    onDelete();
  }, [onDelete]);

  const displayTitle = meta?.title || clip.name.replace('.md', '');
  const hostname = meta?.url ? getHostname(meta.url) : '';

  return (
    <div
      className="clip-card flex flex-col gap-1.5 p-2.5 mx-1.5 mb-1.5 rounded-lg border border-brd bg-surf cursor-pointer transition-all duration-150 hover:border-acc hover:shadow-[0_1px_4px_rgba(0,0,0,.08)]"
      onClick={handleOpen}
    >
      {/* Header: title + delete */}
      <div className="flex items-start gap-2 min-w-0">
        <div className="flex-1 min-w-0">
          <div className="text-[calc(var(--ui-font-size)-2px)] text-t1 font-medium break-words leading-snug">{displayTitle}</div>
          {hostname && (
            <button
              className="text-[10px] text-acc bg-transparent border-none cursor-pointer p-0 hover:underline truncate block max-w-full text-left leading-relaxed"
              onClick={handleOpenUrl}
              title={meta?.url}
            >
              {hostname}
            </button>
          )}
        </div>
        <button
          className="shrink-0 w-5 h-5 rounded flex items-center justify-center bg-transparent border-none cursor-pointer text-t3 hover:bg-red-500/10 hover:text-red-500 transition-colors"
          onClick={handleDeleteClick}
          title={t('sidebar:clips.delete')}
        >
          <ThemeIcon name="delete" size={12} />
        </button>
      </div>

    </div>
  );
}

/** Editable tag chips with add/remove functionality */
function TagEditor({
  tags,
  allTags,
  onChange,
}: {
  tags: string[];
  allTags: string[];
  onChange: (tags: string[]) => void;
}) {
  const { t } = useTranslation();
  const [inputValue, setInputValue] = useState('');
  const [showSuggestions, setShowSuggestions] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const suggestions = useMemo(() => {
    if (!inputValue.trim()) return [];
    const lower = inputValue.toLowerCase();
    return allTags
      .filter((t) => t.toLowerCase().includes(lower) && !tags.includes(t))
      .slice(0, 5);
  }, [inputValue, allTags, tags]);

  const handleRemove = useCallback((tag: string) => {
    onChange(tags.filter((t) => t !== tag));
  }, [tags, onChange]);

  const handleAdd = useCallback((tag: string) => {
    const trimmed = tag.trim();
    if (trimmed && !tags.includes(trimmed)) {
      onChange([...tags, trimmed]);
    }
    setInputValue('');
    setShowSuggestions(false);
  }, [tags, onChange]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && inputValue.trim()) {
      e.preventDefault();
      handleAdd(inputValue);
    } else if (e.key === 'Backspace' && !inputValue && tags.length > 0) {
      handleRemove(tags[tags.length - 1]);
    }
  }, [inputValue, tags, handleAdd, handleRemove]);

  return (
    <div className="relative">
      <div className="flex flex-wrap gap-1 p-1.5 rounded-md border border-brd bg-bg min-h-[32px] items-center">
        {tags.map((tag) => (
          <span
            key={tag}
            className="inline-flex items-center gap-0.5 text-[10px] text-t1 bg-accdim border border-acc/20 px-1.5 py-0.5 rounded leading-tight"
          >
            {tag}
            <button
              className="bg-transparent border-none cursor-pointer text-t3 hover:text-red-500 p-0 ml-0.5 leading-none transition-colors"
              onClick={() => handleRemove(tag)}
              title={t('sidebar:clips.removeTag')}
            >
              <svg width="8" height="8" viewBox="0 0 8 8" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M1 1l6 6M7 1l-6 6" strokeLinecap="round" />
              </svg>
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          type="text"
          className="flex-1 min-w-[60px] bg-transparent border-none outline-none text-[11px] text-t1 placeholder:text-t3 py-0.5"
          placeholder={tags.length === 0 ? t('sidebar:clips.tagPlaceholderEmpty') : t('sidebar:clips.tagPlaceholderAdd')}
          value={inputValue}
          onChange={(e) => { setInputValue(e.target.value); setShowSuggestions(true); }}
          onFocus={() => setShowSuggestions(true)}
          onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
          onKeyDown={handleKeyDown}
        />
      </div>
      {showSuggestions && suggestions.length > 0 && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-panel border border-brd rounded-md shadow-[0_4px_12px_rgba(0,0,0,.1)] z-50 max-h-[120px] overflow-y-auto">
          {suggestions.map((s) => (
            <button
              key={s}
              className="w-full text-left px-2.5 py-1.5 text-[11px] text-t2 bg-transparent border-none cursor-pointer hover:bg-hov hover:text-t1 transition-colors"
              onMouseDown={(e) => { e.preventDefault(); handleAdd(s); }}
            >
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Renders a list of structured stream events with visual labels */
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

/** Progress display during clipping */
function ClipProgress({ message, events }: { message: string; events?: StreamEvent[] }) {
  const { t } = useTranslation();
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [events]);

  return (
    <div className="p-3 rounded-lg border border-acc/30 bg-surf flex flex-col gap-2">
      <div className="flex items-center gap-2.5">
        <span className="inline-block w-3.5 h-3.5 rounded-full border-[1.5px] border-brd border-t-acc animate-spin shrink-0" />
        <span className="text-[12px] text-t2">{message || t('sidebar:clips.progressDefault')}</span>
      </div>
      {events && events.length > 0 && (
        <div
          ref={scrollRef}
          className="flex flex-col gap-1 max-h-[200px] overflow-y-auto bg-bg/50 rounded-md p-2 border border-brd/50"
        >
          <StreamEventList events={events} />
        </div>
      )}
    </div>
  );
}

/** Confirmation card shown after AI generation, before saving */
function ClipConfirmation({
  metadata,
  allTags,
  onConfirm,
  onCancel,
  isSaving,
}: {
  metadata: ClipMetadata;
  allTags: string[];
  onConfirm: (metadata: ClipMetadata) => void;
  onCancel: () => void;
  isSaving: boolean;
}) {
  const { t } = useTranslation();
  const [title, setTitle] = useState(metadata.title);
  const [tags, setTags] = useState<string[]>(metadata.tags);

  const handleConfirm = useCallback(() => {
    onConfirm({
      ...metadata,
      title: title.trim() || metadata.title,
      tags,
    });
  }, [metadata, title, tags, onConfirm]);

  return (
    <div className="p-3 rounded-lg border border-acc/30 bg-surf flex flex-col gap-2.5">
      <div className="text-[13px] font-medium text-acc flex items-center gap-1.5">
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M3 2v12l5-3 5 3V2H3z" />
        </svg>
        {t('sidebar:clips.preview.title')}
      </div>

      {/* Editable title */}
      <div className="flex flex-col gap-1">
        <label className="text-[11px] text-t3 font-medium">{t('sidebar:clips.preview.titleLabel')}</label>
        <input
          type="text"
          className="w-full px-2 py-2 text-[13px] rounded-md border border-brd bg-bg text-t1 outline-none focus:border-acc transition-colors font-medium"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
      </div>

      {/* Editable tags */}
      <div className="flex flex-col gap-1">
        <label className="text-[11px] text-t3 font-medium">{t('sidebar:clips.preview.tagsLabel')}</label>
        <TagEditor tags={tags} allTags={allTags} onChange={setTags} />
      </div>

      {/* Suggested tags from AI */}
      {metadata.suggestedTags && metadata.suggestedTags.length > 0 && (
        <div className="flex flex-col gap-1">
          <label className="text-[11px] text-t3 font-medium">{t('sidebar:clips.preview.suggestedLabel')}</label>
          <div className="flex flex-wrap gap-1">
            {metadata.suggestedTags
              .filter((t) => !tags.includes(t))
              .map((t) => (
                <button
                  key={t}
                  className="inline-flex items-center text-[11px] text-t2 bg-transparent border border-brd px-1.5 py-0.5 rounded leading-tight cursor-pointer hover:bg-hov hover:text-t1 hover:border-acc/30 transition-colors"
                  onClick={() => setTags((prev) => prev.includes(t) ? prev : [...prev, t])}
                >
                  + {t}
                </button>
              ))}
          </div>
        </div>
      )}

      {/* Read-only summary preview */}
      {metadata.summary && (
        <div className="flex flex-col gap-1">
          <label className="text-[11px] text-t3 font-medium">{t('sidebar:clips.preview.summaryLabel')}</label>
          <p className="text-[12px] text-t2 leading-relaxed m-0 bg-bg rounded-md p-2 border border-brd max-h-[120px] overflow-y-auto">
            {metadata.summary}
          </p>
        </div>
      )}

      {/* Source URL */}
      <div className="text-[11px] text-t3 truncate" title={metadata.url}>
        {t('sidebar:clips.preview.source', { host: getHostname(metadata.url) })}
      </div>

      {/* Actions */}
      <div className="flex gap-1.5">
        <button
          className="flex-1 py-2 text-[13px] rounded-md bg-acc text-white border-none cursor-pointer hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed font-medium"
          onClick={handleConfirm}
          disabled={isSaving}
        >
          {isSaving ? t('sidebar:clips.saving') : t('sidebar:clips.save')}
        </button>
        <button
          className="px-3 py-2 text-[13px] rounded-md bg-bg text-t2 border border-brd cursor-pointer hover:bg-hov transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          onClick={onCancel}
          disabled={isSaving}
        >
          {t('sidebar:clips.cancel')}
        </button>
      </div>
    </div>
  );
}

/** Expandable tag group section */
function TagSection({
  tag,
  clips,
  collapsed,
  onToggle,
  onDeleteClip,
}: {
  tag: string;
  clips: ClipFile[];
  collapsed: boolean;
  onToggle: () => void;
  onDeleteClip: (clip: ClipFile, tag: string) => void;
}) {
  return (
    <div className="mb-0.5">
      <button
        className="w-full flex items-center gap-2 px-3 py-2 bg-bg border-t border-brd cursor-pointer text-left hover:bg-hov transition-colors group"
        onClick={onToggle}
      >
        <ThemeIcon name="folder" size={14} className="shrink-0 text-t3" />
        <span className="text-[12px] text-t1 font-semibold truncate">{tag}</span>
        <span className="text-[10px] text-t3 ml-auto shrink-0">{clips.length}</span>
      </button>
      {!collapsed && (
        <div className="mt-1.5 ml-2.5 pl-2 border-l-2 border-acc/20">
          {clips.map((clip) => (
            <ClipCard key={clip.path} clip={clip} onDelete={() => onDeleteClip(clip, tag)} />
          ))}
        </div>
      )}
    </div>
  );
}

const BATCH_STATUS_KEYS: Record<BatchItemStatus, { labelKey: string; className: string }> = {
  pending: { labelKey: 'sidebar:clips.status.pending', className: 'text-t3' },
  running: { labelKey: 'sidebar:clips.status.running', className: 'text-acc' },
  done: { labelKey: 'sidebar:clips.status.done', className: 'text-acc' },
  skipped: { labelKey: 'sidebar:clips.status.skipped', className: 'text-amber-600 dark:text-amber-400' },
  failed: { labelKey: 'sidebar:clips.status.failed', className: 'text-red-500' },
  cancelled: { labelKey: 'sidebar:clips.status.cancelled', className: 'text-t3' },
};

/** Batch clipping mode: textarea of URLs, force/delay options, progress list. */
function BatchClipView({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const batchItems = useClipStore((s) => s.batchItems);
  const isBatchRunning = useClipStore((s) => s.isBatchRunning);
  const batchSummaryPath = useClipStore((s) => s.batchSummaryPath);
  const clipBatch = useClipStore((s) => s.clipBatch);
  const cancelBatch = useClipStore((s) => s.cancelBatch);
  const clearBatch = useClipStore((s) => s.clearBatch);
  const error = useClipStore((s) => s.error);

  const [text, setText] = useState('');
  const [force, setForce] = useState(false);
  const [delayMs, setDelayMs] = useState(0);
  const [localError, setLocalError] = useState<string | null>(null);

  const urls = useMemo(
    () => text.split('\n').map((l) => l.trim()).filter(Boolean),
    [text],
  );

  const handleStart = useCallback(async () => {
    if (urls.length === 0 || isBatchRunning) return;
    setLocalError(null);
    try {
      await clipBatch(urls, { force, delayMs });
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : String(err));
    }
  }, [urls, isBatchRunning, clipBatch, force, delayMs]);

  const handleCancel = useCallback(() => {
    cancelBatch();
  }, [cancelBatch]);

  const handleClose = useCallback(() => {
    if (isBatchRunning) return;
    clearBatch();
    onClose();
  }, [isBatchRunning, clearBatch, onClose]);

  const handleOpenPath = useCallback((path: string) => {
    const fileName = path.split('/').pop() || path;
    void editorIoService.openFile(path, fileName);
  }, []);

  const doneCount = batchItems.filter((i) => i.status === 'done').length;
  const skippedCount = batchItems.filter((i) => i.status === 'skipped').length;
  const failedCount = batchItems.filter((i) => i.status === 'failed').length;

  return (
    <div className="flex flex-col gap-2.5 p-2.5 mx-1.5 mb-1.5 rounded-lg border border-brd bg-surf">
      <div className="flex items-center gap-1.5">
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-acc shrink-0">
          <path d="M2 4h12M2 8h12M2 12h8" strokeLinecap="round" />
        </svg>
        <span className="text-[12px] font-medium text-t1">{t('sidebar:clips.batch.title')}</span>
        <button
          className="ml-auto w-5 h-5 rounded flex items-center justify-center bg-transparent border-none cursor-pointer text-t3 hover:bg-hov hover:text-t1 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          onClick={handleClose}
          disabled={isBatchRunning}
          title={t('sidebar:clips.batch.close')}
        >
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M3 3l10 10M13 3L3 13" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      {/* URL textarea */}
      <textarea
        className="w-full px-2.5 py-2 text-[12px] rounded-md border border-brd bg-bg text-t1 outline-none focus:border-acc transition-colors resize-y min-h-[80px] max-h-[200px] font-mono leading-relaxed"
        placeholder={t('sidebar:clips.batch.placeholder')}
        value={text}
        onChange={(e) => setText(e.target.value)}
        disabled={isBatchRunning}
        spellCheck={false}
      />

      {/* Options row */}
      <div className="flex items-center gap-3 flex-wrap">
        <label className="flex items-center gap-1.5 text-[11px] text-t2 cursor-pointer select-none">
          <input
            type="checkbox"
            className="accent-[var(--acc)] cursor-pointer"
            checked={force}
            onChange={(e) => setForce(e.target.checked)}
            disabled={isBatchRunning}
          />
          {t('sidebar:clips.batch.force')}
        </label>
        <label className="flex items-center gap-1.5 text-[11px] text-t2">
          {t('sidebar:clips.batch.delay')}
          <input
            type="number"
            min={0}
            step={100}
            className="w-16 px-1.5 py-1 text-[11px] rounded-md border border-brd bg-bg text-t1 outline-none focus:border-acc transition-colors"
            value={delayMs}
            onChange={(e) => setDelayMs(Math.max(0, Number(e.target.value) || 0))}
            disabled={isBatchRunning}
          />
          ms
        </label>
        <span className="text-[10px] text-t3 ml-auto">{t('sidebar:clips.batch.count', { count: urls.length })}</span>
      </div>

      {/* Action buttons */}
      <div className="flex gap-1.5">
        {!isBatchRunning ? (
          <button
            className="flex-1 py-2 text-[13px] rounded-md bg-acc text-white border-none cursor-pointer hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed font-medium"
            onClick={handleStart}
            disabled={urls.length === 0}
          >
            {t('sidebar:clips.batch.start')}
          </button>
        ) : (
          <button
            className="flex-1 py-2 text-[13px] rounded-md bg-amber-500 text-white border-none cursor-pointer hover:opacity-90 transition-opacity font-medium"
            onClick={handleCancel}
          >
            {t('sidebar:clips.batch.cancelRunning')}
          </button>
        )}
      </div>

      {/* Error display */}
      {(localError || (error && isBatchRunning)) && (
        <div className="p-2 rounded-md border border-red-500/20 bg-red-500/5">
          <div className="text-[10px] text-red-500 leading-tight">{localError || error}</div>
        </div>
      )}

      {/* Progress summary */}
      {batchItems.length > 0 && (
        <div className="flex items-center gap-2 text-[10px] text-t3">
          <span>{t('sidebar:clips.batch.summary.total', { count: batchItems.length })}</span>
          <span className="text-acc">{t('sidebar:clips.batch.summary.done', { count: doneCount })}</span>
          <span className="text-amber-600 dark:text-amber-400">{t('sidebar:clips.batch.summary.skipped', { count: skippedCount })}</span>
          <span className="text-red-500">{t('sidebar:clips.batch.summary.failed', { count: failedCount })}</span>
        </div>
      )}

      {/* Progress list */}
      {batchItems.length > 0 && (
        <div className="flex flex-col gap-0.5 max-h-[260px] overflow-y-auto rounded-md border border-brd bg-bg">
          {batchItems.map((item, idx) => {
            const style = BATCH_STATUS_KEYS[item.status];
            return (
              <div
                key={`${idx}-${item.url}`}
                className="flex items-center gap-1.5 px-2 py-1.5 border-b border-brd/50 last:border-b-0 min-w-0"
              >
                <span className={`text-[10px] font-medium shrink-0 w-12 ${style.className}`}>
                  {item.status === 'running' && (
                    <span className="inline-block w-2 h-2 rounded-full border-[1.5px] border-brd border-t-acc animate-spin mr-1 align-middle" />
                  )}
                  {t(style.labelKey)}
                </span>
                <div className="flex-1 min-w-0 flex flex-col">
                  <span className="text-[11px] text-t2 truncate" title={item.url}>
                    {item.url}
                  </span>
                  {(item.error || item.reason) && (
                    <span className="text-[9px] text-t3 truncate">
                      {item.error || item.reason}
                    </span>
                  )}
                </div>
                {item.clipPath && (
                  <button
                    className="shrink-0 text-[10px] text-acc bg-transparent border-none cursor-pointer hover:underline"
                    onClick={() => handleOpenPath(item.clipPath!)}
                    title={item.clipPath}
                  >
                    {t('sidebar:clips.batch.open')}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Open summary link */}
      {batchSummaryPath && !isBatchRunning && (
        <button
          className="self-start text-[11px] text-acc bg-transparent border-none cursor-pointer hover:underline"
          onClick={() => handleOpenPath(batchSummaryPath)}
          title={batchSummaryPath}
        >
          {t('sidebar:clips.batch.openSummary')}
        </button>
      )}
    </div>
  );
}

export function ClipsPanel() {
  const { t } = useTranslation();
  const clipGroups = useClipStore((s) => s.clipGroups);
  const clips = useClipStore((s) => s.clips);
  const isLoading = useClipStore((s) => s.isLoading);
  const loadClips = useClipStore((s) => s.loadClips);
  const startClip = useClipStore((s) => s.startClip);
  const confirmClip = useClipStore((s) => s.confirmClip);
  const cancelClip = useClipStore((s) => s.cancelClip);
  const isClipping = useClipStore((s) => s.isClipping);
  const clipProgress = useClipStore((s) => s.clipProgress);
  const pendingClip = useClipStore((s) => s.pendingClip);
  const error = useClipStore((s) => s.error);
  const allTags = useClipStore((s) => s.allTags);
  const aiStreamEvents = useClipStore((s) => s.aiStreamEvents);
  const deleteFile = useVaultStore((s) => s.deleteFile);
  const refreshFileTree = useVaultStore((s) => s.refreshFileTree);

  const [showInput, setShowInput] = useState(false);
  const [url, setUrl] = useState('');
  const [clipLang, setClipLang] = useState<ClipLanguage>('auto');
  const [deleteConfirm, setDeleteConfirm] = useState<{ clip: ClipFile; tag: string; tagCount: number } | null>(null);
  const [collapsedTags, setCollapsedTags] = useState<Set<string>>(new Set());
  const [duplicateWarning, setDuplicateWarning] = useState<{ url: string; existingPath: string } | null>(null);
  const [overwritePath, setOverwritePath] = useState<string | null>(null);
  const [batchMode, setBatchMode] = useState(false);

  useEffect(() => {
    loadClips();
  }, [loadClips]);

  const handleAdd = useCallback(() => {
    setShowInput(true);
  }, []);

  const handleStartClip = useCallback(async () => {
    if (!url.trim() || isClipping) return;

    // A fresh (non-duplicate) clip must never inherit a leftover overwrite
    // target from a previous "重新生成" flow — reset explicitly.
    setOverwritePath(null);

    // Ensure clipUrls is populated before the duplicate check.
    await loadClips();

    // Check for duplicate URL before triggering AI generation
    const existingPath = useClipStore.getState().findClipByUrl(url.trim());
    if (existingPath) {
      setDuplicateWarning({ url: url.trim(), existingPath });
      return;
    }

    try {
      await startClip(url.trim(), clipLang);
      // Don't clear URL yet — wait for confirmation or cancel
    } catch {
      // error is handled in clipStore
    }
  }, [url, isClipping, startClip, clipLang, loadClips]);

  const handleOpenExisting = useCallback(async (path: string) => {
    const fileName = path.split('/').pop() || path;
    setDuplicateWarning(null);
    setShowInput(false);
    setUrl('');
    try {
      await editorIoService.openFile(path, fileName);
    } catch {
      // openFile errors are handled in editorStore
    }
  }, []);

  const handleCloseModal = useCallback(() => {
    setShowInput(false);
    setUrl('');
    setDuplicateWarning(null);
    setOverwritePath(null);
    // Don't cancel clipping — let it continue in background
  }, []);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleStartClip();
    } else if (e.key === 'Escape') {
      handleCloseModal();
    }
  }, [handleStartClip, handleCloseModal]);

  const handleConfirmClip = useCallback(async (metadata: ClipMetadata) => {
    try {
      await confirmClip(metadata, overwritePath || undefined);
      setUrl('');
      setShowInput(false);
      setOverwritePath(null);
    } catch {
      // error is handled in clipStore
    }
  }, [confirmClip, overwritePath]);

  const handleCancelClip = useCallback(() => {
    cancelClip();
    setOverwritePath(null);
    setDuplicateWarning(null);
    setShowInput(false);
  }, [cancelClip]);

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

  const handleDeleteClick = useCallback((clip: ClipFile, tag: string) => {
    // Count how many tag groups contain this clip
    const tagCount = clipGroups.filter((g) => g.clips.some((c) => c.path === clip.path)).length;
    setDeleteConfirm({ clip, tag, tagCount: Math.max(tagCount, 1) });
  }, [clipGroups]);

  const confirmDelete = useCallback(async () => {
    if (!deleteConfirm) return;
    const { clip, tag, tagCount } = deleteConfirm;
    setDeleteConfirm(null);
    try {
      if (tagCount <= 1) {
        // Last tag — delete the file entirely
        await deleteFile(clip.path);
        await refreshFileTree();
        loadClips();
      } else {
        // Remove just this tag, keep the file
        await useClipStore.getState().removeTagFromClip(clip.path, tag);
      }
    } catch (err) {
      console.error('[ClipsPanel] Failed to delete clip:', err);
    }
  }, [deleteConfirm, deleteFile, refreshFileTree, loadClips]);

  // Determine what to show in the input area
  const showProgress = isClipping && !pendingClip;
  const showConfirmation = pendingClip && !isClipping;
  const showSaving = isClipping && pendingClip;
  const showModal = showInput || showProgress || showConfirmation || showSaving;

  // Track previous pendingClip to detect transitions
  const prevPendingClipRef = useRef(pendingClip);

  useEffect(() => {
    if (!showModal) return;
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        handleCloseModal();
      }
    };
    document.addEventListener('keydown', handleEsc);
    return () => document.removeEventListener('keydown', handleEsc);
  }, [showModal, handleCloseModal]);

  // Auto-open modal when clip is ready for confirmation
  useEffect(() => {
    if (pendingClip && !prevPendingClipRef.current) {
      setShowInput(true);
    }
    // Dismiss modal when pending clip is cleared (cancel/confirm)
    if (!pendingClip && prevPendingClipRef.current) {
      setShowInput(false);
    }
    prevPendingClipRef.current = pendingClip;
  }, [pendingClip]);

  return (
    <div className="flex-1 overflow-y-auto flex flex-col">
      <div className="py-2 px-3 text-[11px] font-semibold text-t3 uppercase tracking-[0.5px] flex items-center gap-1.5">
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M3 2v12l5-3 5 3V2H3z" />
        </svg>
        <span>Clips</span>
        {clips.length > 0 && (
          <span className="text-t3 font-normal">({clips.length})</span>
        )}
        {isClipping && !showModal && (
          <span
            className="ml-1 flex items-center gap-1 text-acc text-[10px] cursor-pointer hover:opacity-80"
            onClick={() => setShowInput(true)}
            title={t('sidebar:clips.viewDetails')}
          >
            <span className="w-1.5 h-1.5 rounded-full bg-acc animate-pulse" />
            {t('sidebar:clips.clippingInProgress')}
          </span>
        )}
        <button
          className="ml-auto w-5 h-5 rounded flex items-center justify-center bg-transparent border-none cursor-pointer text-t2 hover:bg-hov hover:text-t1 transition-colors"
          onClick={() => setBatchMode((v) => !v)}
          title={batchMode ? t('sidebar:clips.batchModeExit') : t('sidebar:clips.batchModeEnter')}
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M2 4h12M2 8h12M2 12h8" strokeLinecap="round" />
          </svg>
        </button>
        <button
          className="w-5 h-5 rounded flex items-center justify-center bg-transparent border-none cursor-pointer text-t2 hover:bg-hov hover:text-t1 transition-colors"
          onClick={handleAdd}
          title={t('sidebar:clips.addClip')}
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8">
            <path d="M8 3v10M3 8h10" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      {/* Error display when not in input mode */}
      {!showInput && error && !batchMode && (
        <div className="mx-1.5 mb-2 p-2 rounded-lg border border-red-500/20 bg-red-500/5">
          <div className="text-[10px] text-red-500 leading-tight">{error}</div>
        </div>
      )}

      {/* Batch clipping mode */}
      {batchMode && (
        <BatchClipView onClose={() => setBatchMode(false)} />
      )}

      {/* Tag-grouped clip list */}
      <div className="flex-1 overflow-y-auto pt-0.5 pb-2">
        {clipGroups.map((group) => (
          <TagSection
            key={group.tag}
            tag={group.tag}
            clips={group.clips}
            collapsed={collapsedTags.has(group.tag)}
            onToggle={() => handleToggleTag(group.tag)}
            onDeleteClip={handleDeleteClick}
          />
        ))}
        {clips.length === 0 && !isLoading && (
          <div className="p-4 text-center text-xs text-t3 leading-relaxed">
            {t('sidebar:clips.empty')}
          </div>
        )}
        {isLoading && (
          <div className="p-4 text-center text-xs text-t3">{t('sidebar:clips.loading')}</div>
        )}
      </div>

      {/* Clip modal dialog */}
      {showModal && (
        <div className="fixed inset-0 z-[9999] bg-black/35 flex items-center justify-center" onClick={handleCloseModal}>
          <div className="bg-panel rounded-[10px] py-5 px-6 min-w-[420px] max-w-[500px] max-h-[75vh] shadow-[0_8px_32px_rgba(0,0,0,0.18)] border border-brd flex flex-col gap-2.5 overflow-hidden" onClick={(e) => e.stopPropagation()}>
            {/* Modal header */}
            <div className="text-[16px] font-semibold text-t1 flex items-center gap-1.5">
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M3 2v12l5-3 5 3V2H3z" />
              </svg>
              {t('sidebar:clips.modalTitle')}
            </div>

            {/* Scrollable content area */}
            <div className="flex-1 overflow-y-auto flex flex-col gap-2.5 min-h-0">

            {/* URL input */}
            {showInput && !showConfirmation && !showSaving && !duplicateWarning && (
              <div className="flex flex-col gap-2">
                <input
                  type="text"
                  className="w-full px-2.5 py-2 text-[13px] rounded-md border border-brd bg-bg text-t1 outline-none focus:border-acc transition-colors"
                  placeholder={t('sidebar:clips.urlPlaceholder')}
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  onKeyDown={handleKeyDown}
                  disabled={isClipping}
                  autoFocus
                />
                <div className="flex items-center gap-1.5">
                  <span className="text-[11px] text-t3 shrink-0">{t('sidebar:clips.langLabel')}</span>
                  <div className="flex gap-1">
                    {([
                      { value: 'en' as ClipLanguage, label: t('sidebar:clips.langEn') },
                      { value: 'zh' as ClipLanguage, label: t('sidebar:clips.langZh') },
                      { value: 'auto' as ClipLanguage, label: t('sidebar:clips.langAuto') },
                    ]).map((opt) => (
                      <button
                        key={opt.value}
                        className={`px-2 py-1 text-[11px] rounded-md border cursor-pointer transition-colors ${
                          clipLang === opt.value
                            ? 'bg-acc text-white border-acc'
                            : 'bg-bg text-t2 border-brd hover:bg-hov'
                        }`}
                        onClick={() => setClipLang(opt.value)}
                        disabled={isClipping}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>
                {error && !isClipping && (
                  <div className="text-[11px] text-red-500 leading-tight">{error}</div>
                )}
                <div className="flex gap-1.5">
                  <button
                    className="flex-1 py-2 text-[13px] rounded-md bg-acc text-white border-none cursor-pointer hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
                    onClick={handleStartClip}
                    disabled={isClipping || !url.trim()}
                  >
                    {isClipping ? t('sidebar:clips.generating') : t('sidebar:clips.clipButton')}
                  </button>
                  <button
                    className="px-3 py-2 text-[13px] rounded-md bg-bg text-t2 border border-brd cursor-pointer hover:bg-hov transition-colors"
                    onClick={handleCloseModal}
                  >
                    {t('sidebar:clips.cancel')}
                  </button>
                </div>
              </div>
            )}

            {/* Duplicate URL warning */}
            {duplicateWarning && showInput && !showConfirmation && !showSaving && (
              <div className="p-3 rounded-lg border border-amber-500/40 bg-amber-500/8 flex flex-col gap-2.5">
                <div className="text-[12px] text-amber-600 dark:text-amber-400 font-medium">
                  {t('sidebar:clips.duplicate.title')}
                </div>
                <div className="text-[11px] text-t2 break-all bg-bg rounded-md px-2.5 py-1.5 border border-brd">
                  {duplicateWarning.url}
                </div>
                <div className="text-[12px] text-t2 leading-relaxed">
                  {t('sidebar:clips.duplicate.prompt')}
                </div>
                <div className="flex gap-1.5">
                  <button
                    className="px-3 py-2 text-[13px] rounded-md bg-bg text-t2 border border-brd cursor-pointer hover:bg-hov transition-colors"
                    onClick={() => handleOpenExisting(duplicateWarning.existingPath)}
                  >
                    {t('sidebar:clips.duplicate.openExisting')}
                  </button>
                  <button
                    className="flex-1 py-2 text-[13px] rounded-md bg-amber-500 text-white border-none cursor-pointer hover:opacity-90 transition-opacity font-medium"
                    onClick={async () => {
                      const warnUrl = duplicateWarning.url;
                      const warnPath = duplicateWarning.existingPath;
                      setDuplicateWarning(null);
                      try {
                        await startClip(warnUrl, clipLang);
                        setOverwritePath(warnPath);
                      } catch {
                        // error is handled in clipStore
                      }
                    }}
                  >
                    {t('sidebar:clips.duplicate.regenerate')}
                  </button>
                  <button
                    className="px-3 py-2 text-[13px] rounded-md bg-bg text-t2 border border-brd cursor-pointer hover:bg-hov transition-colors"
                    onClick={() => setDuplicateWarning(null)}
                  >
                    {t('sidebar:clips.cancel')}
                  </button>
                </div>
              </div>
            )}

            {/* Progress spinner with streaming events */}
            {showProgress && <ClipProgress message={clipProgress} events={aiStreamEvents} />}

            {/* Confirmation card */}
            {showConfirmation && (
              <ClipConfirmation
                metadata={pendingClip}
                allTags={allTags}
                onConfirm={handleConfirmClip}
                onCancel={handleCancelClip}
                isSaving={false}
              />
            )}

            {/* Saving state */}
            {showSaving && (
              <div className="p-3 rounded-lg border border-acc/30 bg-surf flex items-center gap-2.5">
                <span className="inline-block w-3.5 h-3.5 rounded-full border-[1.5px] border-brd border-t-acc animate-spin shrink-0" />
                <span className="text-[12px] text-t2">{t('sidebar:clips.savingFile')}</span>
              </div>
            )}

            </div> {/* end scrollable content */}
          </div>
        </div>
      )}

      {/* Delete confirmation dialog */}
      {deleteConfirm && (() => {
        const isLastTag = deleteConfirm.tagCount <= 1;
        const clipTitle = deleteConfirm.clip.name.replace('.md', '');
        return (
          <div className="fixed inset-0 z-[9999] bg-black/35 flex items-center justify-center" onClick={() => setDeleteConfirm(null)}>
            <div className="bg-panel rounded-[10px] py-5 px-6 min-w-[300px] max-w-[400px] shadow-[0_8px_32px_rgba(0,0,0,0.18)] border border-brd" onClick={(e) => e.stopPropagation()}>
              <div className="text-[15px] font-semibold text-t1 mb-2">
                {isLastTag ? t('sidebar:clips.deleteConfirm.titleDelete') : t('sidebar:clips.deleteConfirm.titleRemoveTag')}
              </div>
              <div className="text-[13px] text-t2 leading-relaxed mb-4">
                {isLastTag ? (
                  <>{t('sidebar:clips.deleteConfirm.deletePrefix')}<strong>{clipTitle}</strong>{t('sidebar:clips.deleteConfirm.deleteSuffix')}</>
                ) : (
                  <>{t('sidebar:clips.deleteConfirm.removeTagPrefix')}<strong>{clipTitle}</strong>{t('sidebar:clips.deleteConfirm.removeTagMiddle')}<strong>{deleteConfirm.tag}</strong>{t('sidebar:clips.deleteConfirm.removeTagSuffix')}<br />
                  <span className="text-[11px] text-t3">{t('sidebar:clips.deleteConfirm.removeTagHint', { count: deleteConfirm.tagCount - 1 })}</span></>
                )}
              </div>
              <div className="flex justify-end gap-2">
                <button className="py-1.5 px-4 rounded-md text-[13px] cursor-pointer border border-brd font-ui transition-all duration-[140ms] bg-panel text-t2 hover:bg-hov" onClick={() => setDeleteConfirm(null)}>{t('sidebar:clips.cancel')}</button>
                <button className="py-1.5 px-4 rounded-md text-[13px] cursor-pointer border border-[#e74c3c] font-ui transition-all duration-[140ms] bg-[#e74c3c] text-white hover:bg-[#c0392b] hover:border-[#c0392b]" onClick={confirmDelete}>
                  {isLastTag ? t('sidebar:clips.delete') : t('sidebar:clips.deleteConfirm.titleRemoveTag')}
                </button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
