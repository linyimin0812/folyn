/**
 * DiffPane — git-diff-view variant of the JSON viewer's Diff tab.
 *
 * Layout (full-row when active — JsonFileViewerPreview hides the editor
 * pane while Diff tab is selected so this DiffPane gets the whole width):
 *   ┌────────────────────────────────────────────────────────────┐
 *   │ [☑ 排序后再比较]  +N -M  [并排 | 合并]                      │
 *   │ ─────────────────────────────────────────────────────────── │
 *   │ <Json5CodeMirror>  ║  <DiffView>                            │
 *   │  candidate input  ║  baseline vs candidate (read-only)      │
 *   └────────────────────────────────────────────────────────────┘
 *
 * Horizontal split is drag-to-resize (mirrors JsonFileViewerPreview's
 * vertical split pattern, copied ~15 lines — only 2 callers, ponytail:
 * don't extract useSplitPane hook until a 3rd surfaces).
 *
 * Input area uses Json5CodeMirror (already in repo) for syntax highlight
 * + built-in json5 linter (300ms debounce) + errorInlineWidgetExtension.
 * Zero new code for error highlighting — covers the "input parse error"
 * requirement via the editor's own linter.
 *
 * `+N -M` stats computed from `diff` package's `diffLines` over baseline
 * vs candidate text (avoids reaching into @git-diff-view's private
 * _diffLines field).
 *
 * Mirrors `apps/desktop/src/components/editor/DiffReviewPanel.tsx` for the
 * `generateDiffFile` + `DiffView` + theme pattern.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { diffLines } from 'diff';
import { DiffView, DiffModeEnum, type DiffFile } from '@git-diff-view/react';
import { generateDiffFile } from '@git-diff-view/file';
import { useTranslation } from 'react-i18next';
import { useAppearanceStore } from '@/store/appearanceStore';
import { sortKeysDeep } from '../lib/sortKeysDeep';
import { Json5CodeMirror } from '../editor/Json5CodeMirror';

export interface DiffPaneProps {
  left: unknown;
  rightInput: string;
  sortBoth: boolean;
  onRightInputChange: (text: string) => void;
  onToggleSortBoth: () => void;
}

const BASELINE_NAME = 'baseline.json';
const RIGHT_NAME = 'right.json';
// ponytail: fixed 50/50 split with drag-resize clamped to [0.3, 0.7] —
// narrower range than the editor/tree split (0.2/0.8) because horizontal
// diff needs both sides legible; one side <30% truncates diff lines.
const INPUT_MIN = 0.3;
const INPUT_MAX = 0.7;
const INPUT_FLEX_DEFAULT = 0.5;

export function DiffPane({
  left,
  rightInput,
  sortBoth,
  onRightInputChange,
  onToggleSortBoth,
}: DiffPaneProps) {
  const { t } = useTranslation();
  const theme = useAppearanceStore((s) => s.theme);
  const [mode, setMode] = useState<DiffModeEnum>(DiffModeEnum.Split);

  // ponytail: duplicates DiffReviewPanel — only 2 callers, extract
  // useResolvedDiffTheme() when a 3rd surfaces.
  const resolvedTheme = theme === 'system'
    ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
    : theme;

  const baselineText = useMemo(() => {
    const base = sortBoth ? sortKeysDeep(left) : left;
    return JSON.stringify(base, null, 2);
  }, [left, sortBoth]);

  // ponytail: compute +N/-M stats from `diff` package's diffLines over the
  // raw baseline vs candidate text, instead of reaching into @git-diff-view's
  // private _diffLines WeakMap. The diff is already computed for the view;
  // recomputing here is O(n) text diff, negligible for JSON-sized inputs.
  // Replace with DiffFile.getBundle() counting if a public add/del array
  // ever surfaces and this becomes a hotspot.
  const { adds, dels } = useMemo(() => {
    const parts = diffLines(baselineText, rightInput ?? '');
    let a = 0;
    let d = 0;
    for (const part of parts) {
      if (part.added) a += part.count;
      else if (part.removed) d += part.count;
    }
    return { adds: a, dels: d };
  }, [baselineText, rightInput]);

  const diffFile = useMemo(() => {
    const file = generateDiffFile(
      BASELINE_NAME,
      baselineText,
      RIGHT_NAME,
      rightInput ?? '',
      'json',
      'json',
    );
    // ponytail: duplicates DiffReviewPanel's generateDiffFile+initTheme+init+
    // buildSplit/Unified block. Not extracted — only 2 callers,
    // DiffReviewPanel adds diffLines hunk grouping + per-hunk widgets that
    // don't apply here. Add a useDiffFile hook when a 3rd caller surfaces.
    file.initTheme(resolvedTheme);
    file.init();
    file.buildSplitDiffLines();
    file.buildUnifiedDiffLines();
    return file as unknown as DiffFile;
  }, [baselineText, rightInput, resolvedTheme]);

  const isSplit = mode === DiffModeEnum.Split
    || mode === DiffModeEnum.SplitGitHub
    || mode === DiffModeEnum.SplitGitLab;

  // Horizontal split-pane drag-to-resize — mirrors JsonFileViewerPreview's
  // vertical splitDragging pattern, copied for the horizontal axis.
  const [inputFlex, setInputFlex] = useState(INPUT_FLEX_DEFAULT);
  const splitDragging = useRef(false);
  const splitContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!splitDragging.current || !splitContainerRef.current) return;
      const rect = splitContainerRef.current.getBoundingClientRect();
      if (rect.width === 0) return;
      const ratio = (e.clientX - rect.left) / rect.width;
      const clamped = Math.max(INPUT_MIN, Math.min(INPUT_MAX, ratio));
      setInputFlex(clamped);
    };
    const handleMouseUp = () => {
      if (splitDragging.current) {
        splitDragging.current = false;
        document.body.style.cursor = '';
        document.documentElement.classList.remove('is-resizing');
      }
    };
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, []);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Toolbar */}
      <div className="flex h-[28px] shrink-0 items-center justify-between gap-3 border-b border-brd bg-surf px-2 text-[11px]">
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-1 text-t2">
            <input
              type="checkbox"
              checked={sortBoth}
              onChange={onToggleSortBoth}
              className="h-3 w-3 accent-acc"
            />
            <span>排序后再比较</span>
          </label>
          {/* diff stats — +N adds (green) / -M dels (red). */}
          <span className="flex items-center gap-2 font-mono">
            <span className="text-[#22c55e]">+{adds}</span>
            <span className="text-[#ef4444]">-{dels}</span>
          </span>
        </div>
        {/* ponytail: inline Split/Unified toggle instead of reusing DiffToolbar
            because DiffToolbar reads diffReviewStore.diffReviewMode (returns
            null when not reviewing) and renders Accept All/Reject All — neither
            applies to the JSON viewer's Diff tab. Extract a shared toggle when
            a 3rd consumer needs the bare Split/Unified switch. */}
        <div className="flex overflow-hidden rounded border border-brd">
          <button
            type="button"
            className={`cursor-pointer border-none px-2.5 py-1 text-xs ${isSplit ? 'bg-acc text-white' : 'bg-surf text-t2 hover:bg-acc/10'}`}
            onClick={() => setMode(DiffModeEnum.Split)}
            title={t('editor:diffToolbar.splitHint')}
          >
            {t('editor:diffToolbar.split')}
          </button>
          <button
            type="button"
            className={`cursor-pointer border-none px-2.5 py-1 text-xs ${!isSplit ? 'bg-acc text-white' : 'bg-surf text-t2 hover:bg-acc/10'}`}
            onClick={() => setMode(DiffModeEnum.Unified)}
            title={t('editor:diffToolbar.unifiedHint')}
          >
            {t('editor:diffToolbar.unified')}
          </button>
        </div>
      </div>

      {/* Horizontal split: [input | diff]. Drag the divider to resize. */}
      <div className="flex min-h-0 flex-1" ref={splitContainerRef}>
        <div
          className="flex min-h-0 flex-col"
          style={{ flex: inputFlex }}
        >
          <Json5CodeMirror
            // ponytail: constant key — Json5CodeMirror's external-value-sync
            // effect dispatches doc updates; no remount on input change.
            key="diff-input"
            value={rightInput ?? ''}
            onChange={onRightInputChange}
          />
        </div>
        <div
          className="w-[2px] shrink-0 cursor-col-resize bg-brd transition-[background] duration-[140ms] hover:bg-acc hover:opacity-30"
          onMouseDown={() => {
            splitDragging.current = true;
            document.body.style.cursor = 'col-resize';
            document.documentElement.classList.add('is-resizing');
          }}
        />
        <div
          className="min-h-0 overflow-auto bg-surf"
          style={{ flex: 1 - inputFlex }}
        >
          <DiffView
            diffFile={diffFile}
            diffViewMode={mode}
            diffViewTheme={resolvedTheme}
            diffViewHighlight
            diffViewWrap={false}
          />
        </div>
      </div>
    </div>
  );
}
