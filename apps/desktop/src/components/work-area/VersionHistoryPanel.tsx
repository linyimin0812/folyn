import { useCallback, useEffect, useState } from 'react';
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

// Re-export the pure diff helpers so the existing test import path keeps
// working after the move to versionHistoryDiff.ts.
export { parsePatchLines } from './versionHistoryDiff';
export type { DiffLine } from './versionHistoryDiff';
import { parsePatchLines } from './versionHistoryDiff';

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

interface VersionHistoryPanelProps {
  activeTab: FileTab | undefined;
}

export function VersionHistoryPanel({ activeTab }: VersionHistoryPanelProps) {
  const { t } = useTranslation();
  const versionHistoryVisible = useEditorViewStateStore((s) => s.versionHistoryVisible);
  const setVersionHistoryVisible = useEditorViewStateStore((s) => s.setVersionHistoryVisible);
  const setVersionHistorySelection = useEditorViewStateStore((s) => s.setVersionHistorySelection);
  const selectedKey = useEditorViewStateStore((s) => s.versionHistorySelection.selectedKey);

  const [snapshots, setSnapshots] = useState<SnapshotEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Stable identity for `activeTab?.path` so effect deps behave.
  const tabPath = activeTab?.path;

  // ponytail: clear selection helper — used on panel close, restore success,
  // and tab switch so the editor area swaps back to the active editor. Single
  // exit so lifecycle edges cannot drift.
  const clearSelection = useCallback(() => {
    setVersionHistorySelection({ selectedKey: null, diffLines: null, diffError: null });
  }, [setVersionHistorySelection]);

  // ponytail: refetch snapshot list whenever the active file changes or the
  // panel re-opens. We also refetch after a restore so the new "restored"
  // entry appears. Disabled when the panel is hidden — no wasted IPC.
  // Also clears any selected snapshot + diff so the editor area returns to
  // the live editor when the file context changes.
  //
  // Deps use `tabPath` (the stable path string), NOT `activeTab` — the tab
  // object reference changes on every keystroke (store updates tab.content),
  // which would recreate this callback and re-fire the effect, flashing
  // "loading" while the user types. `resolveTabContext` only reads
  // `tab.path`, so a stale-closure `activeTab` snapshot is fine; the live
  // tab is read from the store inside the callback when needed.
  const refreshList = useCallback(async () => {
    const liveTab = useEditorStore.getState().tabs.find((t) => t.path === tabPath);
    if (!liveTab || !versionHistoryVisible) return;
    setError(null);
    setLoading(true);
    clearSelection();
    try {
      const ctx = await resolveTabContext(liveTab);
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
  }, [tabPath, versionHistoryVisible, clearSelection]);

  useEffect(() => {
    if (!versionHistoryVisible) return;
    void refreshList();
  }, [versionHistoryVisible, tabPath, refreshList]);

  // ponytail: clear the selection when the panel is hidden (ESC / X / tab
  // switch / toggle). The editor area reads selection from the store, so this
  // is the single exit that returns the editor to view.
  useEffect(() => {
    if (!versionHistoryVisible) clearSelection();
  }, [versionHistoryVisible, clearSelection]);

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
  // Both reads are async on the Tauri fs; lift the parsed patch to the store
  // so WorkArea's editor-area diff view re-renders.
  const handleSelect = useCallback(async (entry: SnapshotEntry) => {
    const liveTab = useEditorStore.getState().tabs.find((t) => t.path === tabPath);
    if (!liveTab) return;
    setError(null);
    // Mark loading: key set, lines cleared. WorkArea shows the loading hint.
    const key = `${entry.hash}-${entry.ts}`;
    setVersionHistorySelection({ selectedKey: key, diffLines: null, diffError: null });
    try {
      const ctx = await resolveTabContext(liveTab);
      if (!ctx) return;
      const [oldContent, newContent] = await Promise.all([
        readBlob(ctx.vaultId, entry.hash, ctx.ext),
        readRawContent(liveTab.path),
      ]);
      const patch = createPatch(liveTab.path, oldContent, newContent, '', '', { context: 3 });
      setVersionHistorySelection({ selectedKey: key, diffLines: parsePatchLines(patch), diffError: null });
    } catch (err) {
      console.warn('[VersionHistory] diff failed:', err);
      setVersionHistorySelection({ selectedKey: key, diffLines: null, diffError: String(err) });
    }
  }, [tabPath, setVersionHistorySelection]);

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
  // Clear the selection so the editor area swaps back to the live editor,
  // now showing the restored content.
  const handleRestore = useCallback(async (entry: SnapshotEntry) => {
    const liveTab = useEditorStore.getState().tabs.find((t) => t.path === tabPath);
    if (!liveTab) return;
    setRestoring(true);
    setError(null);
    try {
      const ctx = await resolveTabContext(liveTab);
      if (!ctx) return;
      await restoreSnapshot(ctx.vaultId, ctx.absFilePath, entry.hash, ctx.ext);

      // Refresh editor buffer from disk.
      const handler = getHandlerById(liveTab.fileType);
      const raw = await readRawContent(liveTab.path);
      const content = handler?.deserialize ? handler.deserialize(raw) : raw;
      useEditorStore.setState((state) => ({
        tabs: state.tabs.map((t) =>
          t.id === liveTab.id ? { ...t, content, isDirty: false } : t,
        ),
      }));
      useDiffReviewStore.setState((s) => ({ externalContentVersion: s.externalContentVersion + 1 }));

      // Refetch the list so the new "preserved-current" + "restored" entries appear.
      const list = await listSnapshots(ctx.vaultId, ctx.absFilePath);
      setSnapshots(list);
      // Clear selection — editor area returns to the live editor, which now
      // shows the restored content (externalContentVersion bumped above).
      clearSelection();
    } catch (err) {
      console.warn('[VersionHistory] restore failed:', err);
      setError(String(err));
    } finally {
      setRestoring(false);
    }
  }, [tabPath, clearSelection]);

  if (!versionHistoryVisible) return null;
  if (!isVersionableTab(activeTab)) return null;

  return (
    <div
      className="absolute top-0 right-0 bottom-0 z-30 flex flex-col w-[340px] bg-panel border-l border-brd shadow-lg"
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
        {/* Snapshot list — fills the panel now that the diff renders in the editor area. */}
        <div className="flex-1 overflow-y-auto min-h-0">
          {loading && (
            <div className="text-t3 text-[12px] px-3 py-2">{t('editor:versionHistory.loading')}</div>
          )}
          {!loading && snapshots.length === 0 && (
            <div className="text-t3 text-[12px] px-3 py-2">{t('editor:versionHistory.empty')}</div>
          )}
          {snapshots.map((entry, idx) => {
            const key = `${entry.hash}-${entry.ts}`;
            const isSelected = key === selectedKey;
            // ponytail: snapshots is in insertion order (oldest first), so
            // idx 0 is v1 and the last idx is vN. Time gets later as version
            // number grows — matches user expectation.
            const label = snapshots.length > 1
              ? t('editor:versionHistory.snapshotN', { index: idx + 1 })
              : t('editor:versionHistory.snapshot');
            return (
              <div
                key={key}
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

        {error && (
          <div className="px-3 py-2 text-[11px] text-red-500 border-t border-brd2 shrink-0">{error}</div>
        )}
      </div>
    </div>
  );
}
