import { useMemo, useState, useCallback } from 'react';
import { DiffView, DiffModeEnum, type DiffFile, SplitSide } from '@git-diff-view/react';
import { generateDiffFile } from '@git-diff-view/file';
import { diffLines, type Change } from 'diff';
import { useTranslation } from 'react-i18next';
import { useDiffReviewStore } from '@/store/diffReviewStore';
import { useEditorStore } from '@/store/editorStore';
import { useAppearanceStore } from '@/store/appearanceStore';
import type { FileTab } from '@/store/editorStore';
import { DiffToolbar } from './DiffToolbar';
import { resolveLang, type DiffLang } from './diffLang';

interface DiffReviewPanelProps {
  activeTab: FileTab;
}

interface HunkGroup {
  index: number;
  changes: Change[];
  oldStartLine: number;
  oldEndLine: number;
  newStartLine: number;
  newEndLine: number;
}

// ponytail: group consecutive added/removed Change parts into hunks and
// track old/new line ranges so widget lineNumber can be matched to a hunk
// index. The final content for an "accepted" hunk uses its added parts, a
// "rejected" hunk uses its removed parts.
function buildHunkGroups(parts: Change[]): HunkGroup[] {
  const groups: HunkGroup[] = [];
  let current: HunkGroup | null = null;
  let oldLine = 1;
  let newLine = 1;
  let hunkIndex = 0;
  for (const part of parts) {
    const lines = part.value.split('\n');
    // ponytail: diff's parts include trailing newline → split yields a trailing
    // empty string that doesn't represent a real line. Count only non-empty
    // segments for line-number math.
    const lineCount = part.value.endsWith('\n') ? lines.length - 1 : lines.length;
    if (part.added || part.removed) {
      if (!current) {
        current = {
          index: hunkIndex++,
          changes: [],
          oldStartLine: oldLine,
          oldEndLine: oldLine,
          newStartLine: newLine,
          newEndLine: newLine,
        };
        groups.push(current);
      }
      current.changes.push(part);
      if (part.added) {
        current.newEndLine = newLine + Math.max(0, lineCount - 1);
      } else {
        current.oldEndLine = oldLine + Math.max(0, lineCount - 1);
      }
    } else {
      current = null;
    }
    if (part.added) {
      newLine += lineCount;
    } else if (part.removed) {
      oldLine += lineCount;
    } else {
      oldLine += lineCount;
      newLine += lineCount;
    }
  }
  return groups;
}

function assembleFinalContent(parts: Change[], groups: HunkGroup[], accepted: Set<number>): string {
  let out = '';
  let groupIdx = 0;
  for (const part of parts) {
    if (part.added || part.removed) {
      const group = groups[groupIdx];
      const isAccepted = group ? accepted.has(group.index) : false;
      if (part.added && isAccepted) out += part.value;
      if (part.removed && !isAccepted) out += part.value;
      if (group && part === group.changes[group.changes.length - 1]) {
        groupIdx++;
      }
    } else {
      out += part.value;
    }
  }
  return out;
}

function findHunkByLine(groups: HunkGroup[], lineNumber: number, side: 'old' | 'new'): number {
  for (const g of groups) {
    const start = side === 'old' ? g.oldStartLine : g.newStartLine;
    const end = side === 'old' ? g.oldEndLine : g.newEndLine;
    if (lineNumber >= start && lineNumber <= end) return g.index;
  }
  return -1;
}

export function DiffReviewPanel({ activeTab }: DiffReviewPanelProps) {
  const { t } = useTranslation();
  const diffOldContent = useDiffReviewStore((s) => s.diffOldContent);
  const diffNewContent = useDiffReviewStore((s) => s.diffNewContent);
  const exitDiffReview = useDiffReviewStore((s) => s.exitDiffReview);
  const updateTabContent = useEditorStore((s) => s.updateTabContent);
  const theme = useAppearanceStore((s) => s.theme);

  const [mode, setMode] = useState<DiffModeEnum>(DiffModeEnum.Split);
  const [accepted, setAccepted] = useState<Set<number>>(new Set());
  const [rejected, setRejected] = useState<Set<number>>(new Set());

  const resolvedTheme = theme === 'system'
    ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
    : theme;

  const filePath = activeTab.path;
  const fileName = filePath.split('/').pop() || filePath;

  const { diffFile, parts, groups } = useMemo(() => {
    const oldContent = diffOldContent ?? '';
    const newContent = diffNewContent ?? '';
    const lang = resolveLang(filePath) as DiffLang;
    const file = generateDiffFile(fileName, oldContent, fileName, newContent, lang, lang);
    file.initTheme(resolvedTheme);
    file.init();
    file.buildSplitDiffLines();
    file.buildUnifiedDiffLines();
    const changeParts = diffLines(oldContent, newContent);
    const hunkGroups = buildHunkGroups(changeParts);
    return { diffFile: file, parts: changeParts, groups: hunkGroups };
  }, [diffOldContent, diffNewContent, fileName, filePath, resolvedTheme]);

  const totalHunks = groups.length;
  const decidedCount = accepted.size + rejected.size;
  const pendingCount = totalHunks - decidedCount;

  const writeAndExit = useCallback((content: string) => {
    updateTabContent(activeTab.id, content);
    exitDiffReview();
  }, [activeTab.id, updateTabContent, exitDiffReview]);

  const handleAcceptAll = useCallback(() => {
    writeAndExit(diffNewContent ?? '');
  }, [diffNewContent, writeAndExit]);

  const handleRejectAll = useCallback(() => {
    writeAndExit(diffOldContent ?? '');
  }, [diffOldContent, writeAndExit]);

  const handleAcceptHunk = useCallback((hunkIndex: number) => {
    setAccepted((prev) => {
      const next = new Set(prev);
      next.add(hunkIndex);
      const rejectedNext = new Set(rejected);
      rejectedNext.delete(hunkIndex);
      setRejected(rejectedNext);
      return next;
    });
  }, [rejected]);

  const handleRejectHunk = useCallback((hunkIndex: number) => {
    setRejected((prev) => {
      const next = new Set(prev);
      next.add(hunkIndex);
      const acceptedNext = new Set(accepted);
      acceptedNext.delete(hunkIndex);
      setAccepted(acceptedNext);
      return next;
    });
  }, [accepted]);

  const [exiting, setExiting] = useState(false);

  // Auto-exit when all hunks are decided — parity with the old
  // setOnHunksChange(count === 0 → exit) behavior. Guard with `exiting` so
  // repeated renders don't queue multiple writeAndExit calls.
  if (totalHunks > 0 && pendingCount === 0 && !exiting) {
    setExiting(true);
    const finalContent = assembleFinalContent(parts, groups, accepted);
    queueMicrotask(() => writeAndExit(finalContent));
  }

  const finalPreviewContent = assembleFinalContent(parts, groups, accepted);

  return (
    <div className="flex-1 flex flex-col overflow-hidden border-r border-brd min-w-[200px]">
      <DiffToolbar
        hunkCount={totalHunks}
        pendingCount={pendingCount}
        mode={mode}
        onModeChange={setMode}
        onAcceptAll={handleAcceptAll}
        onRejectAll={handleRejectAll}
      />
      <div className="flex-1 overflow-auto bg-surf min-h-0">
        <DiffView
          diffFile={diffFile as unknown as DiffFile}
          diffViewMode={mode}
          diffViewTheme={resolvedTheme}
          diffViewHighlight
          diffViewAddWidget
          diffViewWrap={false}
          renderWidgetLine={({ side, lineNumber, onClose }) => {
            if (lineNumber < 0) return null;
            const sideName = side === SplitSide.old ? 'old' : 'new';
            const hunkIndex = findHunkByLine(groups, lineNumber, sideName);
            if (hunkIndex < 0) {
              return (
                <div className="flex gap-2 px-2 py-1">
                  <span className="text-xs text-t2">{t('editor:diffToolbar.noHunk')}</span>
                </div>
              );
            }
            const isAccepted = accepted.has(hunkIndex);
            const isRejected = rejected.has(hunkIndex);
            return (
              <div className="flex items-center gap-2 px-2 py-1 bg-surf">
                <button
                  className={`py-0.5 px-2 rounded text-xs cursor-pointer border-none ${isAccepted ? 'bg-[#22c55e] text-white' : 'bg-[#22c55e]/80 text-white hover:bg-[#16a34a]'}`}
                  onClick={() => { handleAcceptHunk(hunkIndex); onClose(); }}
                >
                  ✓ {t('editor:diffToolbar.accept')}
                </button>
                <button
                  className={`py-0.5 px-2 rounded text-xs cursor-pointer border-none ${isRejected ? 'bg-[#ef4444] text-white' : 'bg-[#ef4444]/80 text-white hover:bg-[#dc2626]'}`}
                  onClick={() => { handleRejectHunk(hunkIndex); onClose(); }}
                >
                  ✕ {t('editor:diffToolbar.reject')}
                </button>
              </div>
            );
          }}
        />
      </div>
      <div className="border-t border-brd px-3 py-1.5 text-[11px] text-t2 bg-surf">
        <span className="font-mono">{t('editor:diffToolbar.preview')}</span>
        <pre className="mt-1 max-h-32 overflow-auto font-mono text-[11px] whitespace-pre-wrap">{finalPreviewContent || t('editor:diffToolbar.empty')}</pre>
      </div>
    </div>
  );
}
