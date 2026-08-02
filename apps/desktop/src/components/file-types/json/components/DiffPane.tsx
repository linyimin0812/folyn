/**
 * DiffPane — git-diff-view variant of the JSON viewer's Diff tab.
 *
 * Layout:
 *   ┌────────────────────────────────────────────────────┐
 *   │ [☑ 排序后再比较]     [并排 | 合并]                 │
 *   │ ─────────────────────────────────────────────────  │
 *   │ <DiffView> (read-only, file-comparison mode)       │
 *   │   - old = formatted `left` (sorted if `sortBoth`)  │
 *   │   - new = user's raw `rightInput`                  │
 *   └────────────────────────────────────────────────────┘
 *
 * `@git-diff-view/react`'s `DiffView` is read-only, so the inline editing
 * the old CodeMirror-based DiffPane allowed is gone — users edit on the
 * Raw tab. `rightInput` / `onRightInputChange` are kept in props for
 * interface compatibility (the parent still owns the value), they just
 * no longer fire from this tab.
 *
 * Mirrors `apps/desktop/src/components/editor/DiffReviewPanel.tsx` for the
 * `generateDiffFile` + `DiffView` + theme pattern.
 */
import { useMemo, useState } from 'react';
import { DiffView, DiffModeEnum, type DiffFile } from '@git-diff-view/react';
import { generateDiffFile } from '@git-diff-view/file';
import { useTranslation } from 'react-i18next';
import { useAppearanceStore } from '@/store/appearanceStore';
import { sortKeysDeep } from '../lib/sortKeysDeep';

export interface DiffPaneProps {
  left: unknown;
  rightInput: string;
  right: unknown;
  sortBoth: boolean;
  onRightInputChange: (text: string) => void;
  onRightValueChange: (value: unknown) => void;
  onToggleSortBoth: () => void;
  onCopyValue: (value: string) => void;
}

const BASELINE_NAME = 'baseline.json';
const RIGHT_NAME = 'right.json';

export function DiffPane({
  left,
  rightInput,
  sortBoth,
  onToggleSortBoth,
}: DiffPaneProps) {
  const { t } = useTranslation();
  const theme = useAppearanceStore((s) => s.theme);
  const [mode, setMode] = useState<DiffModeEnum>(DiffModeEnum.Split);

  // ponytail: resolvedTheme duplicates DiffReviewPanel — only 2 callers,
  // extract useResolvedDiffTheme() when a 3rd surfaces.
  const resolvedTheme = theme === 'system'
    ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
    : theme;

  const baselineText = useMemo(() => {
    const base = sortBoth ? sortKeysDeep(left) : left;
    return JSON.stringify(base, null, 2);
  }, [left, sortBoth]);

  // ponytail: hardcoded 'json' lang — this viewer only renders JSON values
  // (no file path available, unlike DiffReviewPanel which calls resolveLang).
  // Reuse resolveLang only if a non-JSON surface ever appears here.
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
    // buildSplit/Unified block. Not extracted — only 2 callers, DiffReviewPanel
    // adds diffLines hunk grouping + per-hunk widgets that don't apply here.
    // Add a useDiffFile hook when a 3rd caller surfaces.
    file.initTheme(resolvedTheme);
    file.init();
    file.buildSplitDiffLines();
    file.buildUnifiedDiffLines();
    return file as unknown as DiffFile;
  }, [baselineText, rightInput, resolvedTheme]);

  const isSplit = mode === DiffModeEnum.Split
    || mode === DiffModeEnum.SplitGitHub
    || mode === DiffModeEnum.SplitGitLab;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Toolbar */}
      <div className="flex h-[28px] shrink-0 items-center justify-between gap-3 border-b border-brd bg-surf px-2 text-[11px]">
        <label className="flex items-center gap-1 text-t2">
          <input
            type="checkbox"
            checked={sortBoth}
            onChange={onToggleSortBoth}
            className="h-3 w-3 accent-acc"
          />
          <span>排序后再比较</span>
        </label>
        {/* ponytail: inline Split/Unified toggle instead of reusing DiffToolbar
            because DiffToolbar reads diffReviewStore.diffReviewMode (returns
            null when not reviewing) and renders Accept All/Reject All — neither
            applies to the JSON viewer's Diff tab. Extract a shared toggle when a
            3rd consumer needs the bare Split/Unified switch. */}
        <div className="flex border border-brd rounded overflow-hidden">
          <button
            type="button"
            className={`py-1 px-2.5 text-xs cursor-pointer border-none ${isSplit ? 'bg-acc text-white' : 'bg-surf text-t2 hover:bg-acc/10'}`}
            onClick={() => setMode(DiffModeEnum.Split)}
            title={t('editor:diffToolbar.splitHint')}
          >
            {t('editor:diffToolbar.split')}
          </button>
          <button
            type="button"
            className={`py-1 px-2.5 text-xs cursor-pointer border-none ${!isSplit ? 'bg-acc text-white' : 'bg-surf text-t2 hover:bg-acc/10'}`}
            onClick={() => setMode(DiffModeEnum.Unified)}
            title={t('editor:diffToolbar.unifiedHint')}
          >
            {t('editor:diffToolbar.unified')}
          </button>
        </div>
      </div>

      {/* Read-only git-diff-view. */}
      <div className="min-h-0 flex-1 overflow-auto bg-surf">
        <DiffView
          diffFile={diffFile}
          diffViewMode={mode}
          diffViewTheme={resolvedTheme}
          diffViewHighlight
          diffViewWrap={false}
        />
      </div>
    </div>
  );
}
