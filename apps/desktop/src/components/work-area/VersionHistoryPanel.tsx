import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPatch } from 'diff';
import { useTranslation } from 'react-i18next';
import { useEditorStore } from '@/store/editorStore';
import { useEditorViewStateStore } from '@/store/editorViewState';
import { useDiffReviewStore } from '@/store/diffReviewStore';
import { useVaultStore } from '@/store/vaultStore';
import { getHandlerById } from '@/components/file-types/registry';
import { isExternalPath } from '@/utils/isExternalPath';
import { WIKI_PREFIX } from '@/types/wiki';
import { resolveBasePath } from '@/utils/pathResolver';
import { readRawContent } from '@/services/editorIoService';
import {
  listSnapshots,
  readBlob,
  restore as restoreSnapshot,
} from '@/services/versionHistory';
import type { SnapshotEntry } from '@/services/versionHistoryService';
import type { FileTab } from '@/store/editorStore';

// ponytail: the versionable predicate mirrors `editorIoService.maybeSnapshotVersion`
// (PR2). Same gate, same scope per PRD §7 — single source of truth so the UI
// button visibility cannot drift from the snapshot trigger.
export function isVersionableTab(tab: FileTab | undefined): tab is FileTab {
  if (!tab) return false;
  if (tab.fileType === 'web') return false;
  if (isExternalPath(tab.path)) return false;
  if (tab.path.startsWith(WIKI_PREFIX)) return false;
  const handler = getHandlerById(tab.fileType);
  return !!handler?.needsFileContent;
}

function getExt(filePath: string): string {
  const base = filePath.split('/').pop() ?? filePath;
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : '';
}

function formatTimestamp(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function formatSize(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

interface ResolvedTab {
  vaultId: string;
  absFilePath: string;
  ext: string;
}

async function resolveTabContext(tab: FileTab): Promise<ResolvedTab | null> {
  const vaultId = useVaultStore.getState().activeVaultId;
  const vault = useVaultStore.getState().currentVault;
  if (!vaultId || !vault) return null;
  const root = await resolveBasePath(vault.basePath);
  const { join } = await import('@tauri-apps/api/path');
  const absFilePath = await join(root, tab.path);
  return { vaultId, absFilePath, ext: getExt(tab.path) };
}

interface DiffLine {
  text: string;
  kind: 'context' | 'add' | 'del' | 'hunk' | 'meta';
}

// ponytail: parse the unified-diff patch string into a flat list of lines with
// kind tags. Cheaper than tokenising via the `diff` package's structuredPatch
// (we render line-level only — per-character diff is Out of Scope per PRD).
// Ceiling: this won't surface intra-line edits; upgrade to structuredPatch if
// per-character granularity becomes a real need. Exported for unit testing.
export function parsePatchLines(patch: string): DiffLine[] {
  const lines = patch.split('\n');
  return lines.map((line) => {
    if (line.startsWith('@@')) return { text: line, kind: 'hunk' as const };
    if (line.startsWith('+++') || line.startsWith('---')) return { text: line, kind: 'meta' as const };
    if (line.startsWith('+')) return { text: line.slice(1), kind: 'add' as const };
    if (line.startsWith('-')) return { text: line.slice(1), kind: 'del' as const };
    if (line.startsWith(' ')) return { text: line.slice(1), kind: 'context' as const };
    if (line.startsWith('\\')) return { text: line, kind: 'meta' as const };
    return { text: line, kind: 'context' as const };
  });
}

interface VersionHistoryPanelProps {
  activeTab: FileTab | undefined;
}

export function VersionHistoryPanel({ activeTab }: VersionHistoryPanelProps) {
  const { t } = useTranslation();
  const versionHistoryVisible = useEditorViewStateStore((s) => s.versionHistoryVisible);
  const setVersionHistoryVisible = useEditorViewStateStore((s) => s.setVersionHistoryVisible);

  const [snapshots, setSnapshots] = useState<SnapshotEntry[]>([]);
  const [selectedHash, setSelectedHash] = useState<string | null>(null);
  const [diffLines, setDiffLines] = useState<DiffLine[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Stable identity for `activeTab?.path` so effect deps behave.
  const tabPath = activeTab?.path;

  // ponytail: refetch snapshot list whenever the active file changes or the
  // panel re-opens. We also refetch after a restore so the new "restored"
  // entry appears. Disabled when the panel is hidden — no wasted IPC.
  const refreshList = useCallback(async () => {
    if (!activeTab || !versionHistoryVisible) return;
    setError(null);
    setLoading(true);
    setDiffLines(null);
    setSelectedHash(null);
    try {
      const ctx = await resolveTabContext(activeTab);
      if (!ctx) {
        setSnapshots([]);
        return;
      }
      const list = await listSnapshots(ctx.vaultId, ctx.absFilePath);
      setSnapshots(list);
    } catch (err) {
      console.warn('[VersionHistory] listSnapshots failed:', err);
      setError(String(err));
      setSnapshots([]);
    } finally {
      setLoading(false);
    }
  }, [activeTab, versionHistoryVisible]);

  useEffect(() => {
    if (!versionHistoryVisible) return;
    void refreshList();
  }, [versionHistoryVisible, tabPath, refreshList]);

  // ponytail: ESC closes the panel — matches the secondary-window Esc-dismiss
  // convention elsewhere in the app. Keydown listener on the panel root so
  // it doesn't compete with CodeMirror's keymap when focus is in the editor.
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      setVersionHistoryVisible(false);
    }
  }, [setVersionHistoryVisible]);

  const handleClose = useCallback(() => {
    setVersionHistoryVisible(false);
  }, [setVersionHistoryVisible]);

  // Selecting a snapshot: compute a unified diff (snapshot → current on-disk).
  // Both reads are async on the Tauri fs; cache the parsed patch in state.
  const handleSelect = useCallback(async (entry: SnapshotEntry) => {
    if (!activeTab) return;
    setError(null);
    setSelectedHash(entry.hash);
    setDiffLines(null);
    try {
      const ctx = await resolveTabContext(activeTab);
      if (!ctx) return;
      const [oldContent, newContent] = await Promise.all([
        readBlob(ctx.vaultId, entry.hash, ctx.ext),
        readRawContent(activeTab.path),
      ]);
      const patch = createPatch(activeTab.path, oldContent, newContent, '', '', { context: 3 });
      setDiffLines(parsePatchLines(patch));
    } catch (err) {
      console.warn('[VersionHistory] diff failed:', err);
      setError(String(err));
    }
  }, [activeTab]);

  // Restore flow per PRD §5:
  //   (a) `restore()` snapshots current on-disk first (never loses state).
  //   (b) overwrites on-disk file with the blob.
  //   (c) snapshots the just-restored content → new index entry.
  // After the service resolves, refresh the editor buffer:
  //   - re-read on-disk content via the file-type's deserialize (mirrors
  //     `editorIoService.checkDiskChanges` for non-active tabs).
  //   - set tab.content + isDirty:false + bump externalContentVersion so
  //     CodeMirror `replaceContent` fires AND custom-editor WorkArea remounts
  //     on the new key.
  // We do NOT use `setContentExternal` because it sets isDirty:true and
  // schedules an auto-save (wasteful — disk already matches).
  const handleRestore = useCallback(async (entry: SnapshotEntry) => {
    if (!activeTab) return;
    setRestoring(true);
    setError(null);
    try {
      const ctx = await resolveTabContext(activeTab);
      if (!ctx) return;
      await restoreSnapshot(ctx.vaultId, ctx.absFilePath, entry.hash, ctx.ext);

      // Refresh editor buffer from disk.
      const handler = getHandlerById(activeTab.fileType);
      const raw = await readRawContent(activeTab.path);
      const content = handler?.deserialize ? handler.deserialize(raw) : raw;
      useEditorStore.setState((state) => ({
        tabs: state.tabs.map((t) =>
          t.id === activeTab.id ? { ...t, content, isDirty: false } : t,
        ),
      }));
      useDiffReviewStore.setState((s) => ({ externalContentVersion: s.externalContentVersion + 1 }));

      // Refetch the list so the new "preserved-current" + "restored" entries appear.
      // Avoid recursing through the effect — we directly call listSnapshots here.
      const list = await listSnapshots(ctx.vaultId, ctx.absFilePath);
      setSnapshots(list);
      // Re-render the diff against the freshly-restored on-disk content.
      // The "current" is now identical to the chosen blob → diff should be empty.
      const patch = createPatch(activeTab.path, raw, raw, '', '', { context: 3 });
      setDiffLines(parsePatchLines(patch));
    } catch (err) {
      console.warn('[VersionHistory] restore failed:', err);
      setError(String(err));
    } finally {
      setRestoring(false);
    }
  }, [activeTab]);

  const diffRender = useMemo(() => {
    if (!diffLines) return null;
    if (diffLines.length === 0) {
      return <div className="text-t3 text-[12px] px-3 py-2">{t('editor:versionHistory.diff.identical')}</div>;
    }
    return (
      <pre className="text-[12px] font-mono leading-[1.5] overflow-x-auto px-3 py-2 m-0">
        {diffLines.map((line, i) => {
          const cls =
            line.kind === 'add' ? 'text-green-600 dark:text-green-400 bg-green-500/5'
            : line.kind === 'del' ? 'text-red-600 dark:text-red-400 bg-red-500/5'
            : line.kind === 'hunk' ? 'text-t3'
            : line.kind === 'meta' ? 'text-t3'
            : 'text-t2';
          const prefix =
            line.kind === 'add' ? '+ '
            : line.kind === 'del' ? '- '
            : line.kind === 'hunk' ? ''
            : line.kind === 'meta' ? ''
            : '  ';
          return (
            <div key={i} className={`whitespace-pre ${cls}`}>
              <span>{prefix}{line.text}</span>
            </div>
          );
        })}
      </pre>
    );
  }, [diffLines, t]);

  if (!versionHistoryVisible) return null;
  if (!isVersionableTab(activeTab)) return null;

  return (
    <div
      className="absolute top-0 right-0 bottom-0 z-30 flex flex-col w-[420px] bg-panel border-l border-brd shadow-lg"
      onKeyDown={handleKeyDown}
    >
      <div className="flex items-center justify-between h-[34px] px-3 border-b border-brd shrink-0">
        <span className="text-[13px] font-semibold text-t1">{t('editor:versionHistory.title')}</span>
        <button
          className="w-[24px] h-[24px] flex items-center justify-center rounded text-t3 hover:bg-hov hover:text-t1 transition-colors"
          onClick={handleClose}
          title={t('editor:versionHistory.close')}
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
            <line x1="3" y1="3" x2="13" y2="13" />
            <line x1="13" y1="3" x2="3" y2="13" />
          </svg>
        </button>
      </div>

      <div className="flex-1 flex flex-col overflow-hidden min-h-0">
        {/* Snapshot list */}
        <div className="flex-1 overflow-y-auto min-h-0">
          {loading && (
            <div className="text-t3 text-[12px] px-3 py-2">{t('editor:versionHistory.loading')}</div>
          )}
          {!loading && snapshots.length === 0 && (
            <div className="text-t3 text-[12px] px-3 py-2">{t('editor:versionHistory.empty')}</div>
          )}
          {snapshots.map((entry, idx) => {
            const isSelected = entry.hash === selectedHash;
            const label = snapshots.length > 1
              ? t('editor:versionHistory.snapshotN', { index: snapshots.length - idx })
              : t('editor:versionHistory.snapshot');
            return (
              <div
                key={`${entry.hash}-${entry.ts}`}
                className={`flex flex-col gap-[2px] px-3 py-2 cursor-pointer border-b border-brd2 transition-colors ${
                  isSelected ? 'bg-accdim' : 'hover:bg-hov'
                }`}
                onClick={() => handleSelect(entry)}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[12px] text-t1 truncate">{label}</span>
                  <span className="text-[11px] text-t3 shrink-0">{formatSize(entry.size)}</span>
                </div>
                <div className="text-[11px] text-t3">{formatTimestamp(entry.ts)}</div>
                <div className="flex justify-end mt-1">
                  <button
                    className="text-[11px] px-2 py-[2px] rounded border border-brd text-t2 hover:bg-acc hover:text-white hover:border-acc disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    onClick={(e) => {
                      e.stopPropagation();
                      void handleRestore(entry);
                    }}
                    disabled={restoring}
                    title={t('editor:versionHistory.restore')}
                  >
                    {restoring ? t('editor:versionHistory.restoring') : t('editor:versionHistory.restore')}
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {/* Diff view */}
        {error && (
          <div className="px-3 py-2 text-[11px] text-red-500 border-t border-brd2">{error}</div>
        )}
        {diffRender && (
          <div className="h-[45%] border-t border-brd overflow-auto bg-surf shrink-0">
            {diffRender}
          </div>
        )}
      </div>
    </div>
  );
}
