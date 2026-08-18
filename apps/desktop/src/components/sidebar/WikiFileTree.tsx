import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useWikiStore } from '@/store/wikiStore';
import { useVaultStore } from '@/store/vaultStore';
import * as editorIoService from '@/services/editorIoService';
import type { ReviewItem, WikiEntry } from '@/types/wiki';
import { WIKI_PREFIX } from '@/types/wiki';
import { FileIcon } from '@/components/icons/FileIcon';
import { Plus, FileText, AlertCircle, Share2, Library } from 'lucide-react';

function WikiEntryItem({ entry, depth }: { entry: WikiEntry; depth: number }) {
  const openFile = editorIoService.openFile;

  if (entry.type === 'dir') {
    return (
      <div>
        <div
          className="flex items-center gap-1.5 py-1 px-2 font-medium cursor-default text-[calc(var(--ui-font-size)-2px)] text-t2 rounded mx-1 transition-colors duration-100 hover:bg-hov hover:text-t1"
          style={{ paddingLeft: `${depth * 14 + 8}px` }}
        >
          <span className="shrink-0 text-xs"><FileIcon filename={entry.name} isDir /></span>
          <span className="overflow-hidden text-ellipsis whitespace-nowrap min-w-0 flex-1">{entry.name}</span>
          {entry.children && (
            <span className="shrink-0 text-[10px] text-t3 bg-hov px-[5px] rounded-lg">{entry.children.filter((c) => c.type === 'file').length}</span>
          )}
        </div>
        {entry.children?.map((child) => (
          <WikiEntryItem key={child.path} entry={child} depth={depth + 1} />
        ))}
      </div>
    );
  }

  return (
    <div
      className="flex items-center gap-1.5 py-1 px-2 cursor-pointer text-[calc(var(--ui-font-size)-2px)] text-t2 rounded mx-1 transition-colors duration-100 hover:bg-hov hover:text-t1"
      style={{ paddingLeft: `${depth * 14 + 8}px` }}
      onClick={() => openFile(`${WIKI_PREFIX}${entry.path}`, entry.name)}
      title={entry.path}
    >
      <span className="shrink-0 text-xs"><FileIcon filename={entry.name} /></span>
      <span className="overflow-hidden text-ellipsis whitespace-nowrap min-w-0 flex-1">{entry.name.replace('.md', '')}</span>
    </div>
  );
}

function ReviewItemRow({
  item,
  selected,
  onToggleSelected,
}: {
  item: ReviewItem;
  selected: boolean;
  onToggleSelected: (id: string) => void;
}) {
  const executeReviewAction = useWikiStore((s) => s.executeReviewAction);
  const [busy, setBusy] = useState(false);

  const run = async (actionType: 'accept' | 'reject' | 'merge' | 'research') => {
    setBusy(true);
    try {
      await executeReviewAction(item.id, actionType);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-1 my-1 p-2 rounded border border-brd2 bg-surf2 text-[12px]">
      <div className="flex items-center gap-1.5 mb-1">
        <input
          type="checkbox"
          className="shrink-0"
          checked={selected}
          onChange={() => onToggleSelected(item.id)}
          aria-label={item.title}
        />
        <AlertCircle size={11} className="shrink-0 text-[#f0a840]" />
        <span className="font-semibold text-t1 truncate">{item.title}</span>
      </div>
      <div className="text-t3 leading-relaxed mb-1.5">{item.description}</div>
      {item.affectedPages.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-1.5">
          {item.affectedPages.slice(0, 3).map((p) => (
            <span key={p} className="inline-block px-1 py-0.5 text-[10px] rounded bg-hov text-t3 font-mono">{p}</span>
          ))}
          {item.affectedPages.length > 3 && (
            <span className="text-[10px] text-t3">+{item.affectedPages.length - 3}</span>
          )}
        </div>
      )}
      <div className="flex flex-wrap gap-1">
        {item.suggestedActions.map((a) => (
          <button
            key={a.type}
            className="px-1.5 py-0.5 text-[10px] rounded border border-brd bg-surf text-t2 hover:border-acc hover:text-acc disabled:opacity-50"
            disabled={busy}
            onClick={() => run(a.type as 'accept' | 'reject' | 'merge' | 'research')}
          >
            {a.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function WikiFileTree() {
  const { t } = useTranslation();
  const wikiFiles = useWikiStore((s) => s.wikiFiles);
  const reviewItems = useWikiStore((s) => s.reviewItems);
  const isInitialized = useWikiStore((s) => s.isInitialized);
  const initWiki = useWikiStore((s) => s.initWiki);
  const subTab = useWikiStore((s) => s.wikiSubTab);
  const setSubTab = useWikiStore((s) => s.setWikiSubTab);
  const executeReviewAction = useWikiStore((s) => s.executeReviewAction);
  const dismissReviewItem = useWikiStore((s) => s.dismissReviewItem);

  // Batch selection + filter state — local to WikiFileTree; cleared when the
  // pending set changes shape (filter change doesn't clear, so user can toggle
  // filters without losing selection).
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [filterCheckId, setFilterCheckId] = useState<string>('all');

  useEffect(() => {
    if (!isInitialized) {
      initWiki();
    }
  }, [isInitialized, initWiki]);

  const topFiles = wikiFiles.filter((e) => e.type === 'file');
  const dirs = wikiFiles.filter((e) => e.type === 'dir');
  const pendingReviews = reviewItems.filter((r) => r.status === 'pending');
  const uniqueCheckIds = useMemo(
    () => Array.from(new Set(pendingReviews.map((r) => r.checkId).filter((v): v is string => Boolean(v)))),
    [pendingReviews],
  );
  const filteredReviews = filterCheckId === 'all'
    ? pendingReviews
    : pendingReviews.filter((r) => r.checkId === filterCheckId);

  const toggleSelected = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const allFilteredSelected = filteredReviews.length > 0 && filteredReviews.every((r) => selectedIds.has(r.id));
  const toggleSelectAll = useCallback(() => {
    setSelectedIds((prev) => {
      if (allFilteredSelected) {
        const remove = new Set(filteredReviews.map((r) => r.id));
        const next = new Set<string>();
        for (const id of prev) if (!remove.has(id)) next.add(id);
        return next;
      }
      const next = new Set(prev);
      for (const r of filteredReviews) next.add(r.id);
      return next;
    });
  }, [allFilteredSelected, filteredReviews]);

  const runLint = useCallback(async () => {
    try {
      const { runStructuralLintService } = await import('@/services/wikiLintService');
      await runStructuralLintService();
    } catch (err) {
      console.error('[WikiFileTree] run lint failed', err);
    }
  }, []);

  const handleBatchAccept = useCallback(async () => {
    if (selectedIds.size === 0) return;
    for (const id of selectedIds) {
      await executeReviewAction(id, 'accept');
    }
    setSelectedIds(new Set());
  }, [selectedIds, executeReviewAction]);

  const handleBatchDismiss = useCallback(async () => {
    if (selectedIds.size === 0) return;
    for (const id of selectedIds) {
      dismissReviewItem(id);
    }
    setSelectedIds(new Set());
  }, [selectedIds, dismissReviewItem]);

  const handlePickIngest = async () => {
    const vault = useVaultStore.getState().currentVault;
    if (!vault) return;
    const { open } = await import('@tauri-apps/plugin-dialog');
    const base = vault.basePath;
    const picked = await open({
      multiple: true,
      directory: false,
      defaultPath: base,
      filters: [{ name: 'Markdown', extensions: ['md'] }],
    });
    if (!picked) return;
    const paths = Array.isArray(picked) ? picked : [picked];
    const rel = paths
      .map((p) => p.replace(base, '').replace(/^[/\\]+/, ''))
      .filter((p) => p && !p.startsWith('__wiki__'));
    if (rel.length === 0) return;
    const { runIngest } = await import('@/services/wikiIngestService');
    runIngest(rel).catch(console.error);
  };

  // ponytail: walk vault dir once via readDir, collect .md excluding __wiki__.
  // No mtime cache; runIngest already does hash-based skip for unchanged files.
  const handleIngestAll = useCallback(async () => {
    const vault = useVaultStore.getState().currentVault;
    if (!vault) return;
    const { resolveBasePath } = await import('@/utils/pathResolver');
    const { readDir } = await import('@tauri-apps/plugin-fs');
    const base = await resolveBasePath(vault.basePath);
    const out: string[] = [];
    const walk = async (dirAbs: string, relPrefix: string) => {
      let entries: { name?: string; isDirectory?: boolean }[];
      try {
        entries = await readDir(dirAbs);
      } catch {
        return;
      }
      for (const entry of entries) {
        if (!entry.name || entry.name.startsWith('.')) continue;
        const rel = relPrefix ? `${relPrefix}/${entry.name}` : entry.name;
        if (entry.isDirectory) {
          // ponytail: skip __wiki__ + common non-source dirs at the root
          if (!relPrefix && entry.name === '__wiki__') continue;
          await walk(`${dirAbs}/${entry.name}`, rel);
        } else if (entry.name.endsWith('.md')) {
          out.push(rel);
        }
      }
    };
    await walk(base, '');
    if (out.length === 0) {
      console.warn('[WikiFileTree] ingestAll: no .md files found outside __wiki__');
      return;
    }
    const { runIngest } = await import('@/services/wikiIngestService');
    runIngest(out).catch(console.error);
  }, []);

  return (
    <div className="flex-1 overflow-y-auto flex flex-col">
      <div className="py-2 px-3 text-[11px] font-semibold text-t3 uppercase tracking-[0.5px] flex items-center justify-between">
        <div className="flex items-center gap-1">
          <span>Wiki</span>
          <button
            className="text-t3 hover:text-acc transition-colors"
            onClick={() => editorIoService.openFile('wiki-graph', 'Wiki Graph')}
            title={t('wiki:query.openGraph')}
          >
            <Share2 size={13} />
          </button>
        </div>
        {subTab === 'files' && (
          <div className="flex items-center gap-1">
            <button
              className="text-t3 hover:text-acc transition-colors"
              onClick={handleIngestAll}
              title={t('sidebar:wikiTree.ingestAll')}
            >
              <Library size={13} />
            </button>
            <button
              className="text-t3 hover:text-acc transition-colors"
              onClick={handlePickIngest}
              title={t('sidebar:wikiTree.addSourceFiles')}
            >
              <Plus size={13} />
            </button>
          </div>
        )}
      </div>
      {/* Sub-tab toggle: Files | Reviews (with count badge) */}
      <div className="flex items-center gap-1 px-2 pb-2 border-b border-brd">
        <button
          className={`flex items-center gap-1 px-1.5 py-0.5 text-[10px] rounded ${subTab === 'files' ? 'bg-accdim text-acc' : 'text-t3 hover:bg-hov'}`}
          onClick={() => setSubTab('files')}
        >
          <FileText size={10} /> {t('sidebar:wikiTree.subTab.files')}
        </button>
        <button
          className={`flex items-center gap-1 px-1.5 py-0.5 text-[10px] rounded ${subTab === 'reviews' ? 'bg-accdim text-acc' : 'text-t3 hover:bg-hov'}`}
          onClick={() => setSubTab('reviews')}
        >
          <AlertCircle size={10} /> {t('sidebar:wikiTree.subTab.reviews')}
          {pendingReviews.length > 0 && (
            <span className="text-[9px] px-1 rounded-full bg-acc text-white">{pendingReviews.length}</span>
          )}
        </button>
      </div>

      {subTab === 'files' ? (
        <div className="flex-1 overflow-y-auto">
          {topFiles.map((entry) => (
            <WikiEntryItem key={entry.path} entry={entry} depth={0} />
          ))}
          {dirs.map((entry) => (
            <WikiEntryItem key={entry.path} entry={entry} depth={0} />
          ))}
          {wikiFiles.length === 0 && (
            <div className="p-4 text-center text-xs text-t3 leading-relaxed">
              {t('sidebar:wikiTree.empty')}
            </div>
          )}
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto">
          {pendingReviews.length === 0 ? (
            <div className="p-4 text-center text-xs text-t3 leading-relaxed flex flex-col items-center gap-2">
              <span>{t('sidebar:wikiTree.reviewsEmpty')}</span>
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => void runLint()}
              >
                {t('sidebar:wikiTree.runLint')}
              </button>
            </div>
          ) : (
            <>
              <div className="px-2 py-1.5 border-b border-brd2 flex flex-wrap items-center gap-1.5 text-[10px]">
                <label className="inline-flex items-center gap-1 text-t3">
                  <input
                    type="checkbox"
                    checked={allFilteredSelected}
                    onChange={toggleSelectAll}
                  />
                  {t('sidebar:wikiTree.selectAll')}
                </label>
                <button
                  type="button"
                  className="px-1.5 py-0.5 rounded border border-brd bg-surf text-t2 hover:border-acc hover:text-acc disabled:opacity-50"
                  disabled={selectedIds.size === 0}
                  onClick={() => void handleBatchAccept()}
                >
                  {t('sidebar:wikiTree.acceptSelected')}
                </button>
                <button
                  type="button"
                  className="px-1.5 py-0.5 rounded border border-brd bg-surf text-t2 hover:border-acc hover:text-acc disabled:opacity-50"
                  disabled={selectedIds.size === 0}
                  onClick={() => void handleBatchDismiss()}
                >
                  {t('sidebar:wikiTree.dismissSelected')}
                </button>
                {uniqueCheckIds.length > 0 && (
                  <select
                    className="ml-auto bg-inp border border-brd rounded px-1 py-0.5 text-t2"
                    value={filterCheckId}
                    onChange={(e) => setFilterCheckId(e.target.value)}
                    aria-label={t('sidebar:wikiTree.filterByCheck')}
                  >
                    <option value="all">{t('sidebar:wikiTree.filterAll')}</option>
                    {uniqueCheckIds.map((cid) => (
                      <option key={cid} value={cid}>{cid}</option>
                    ))}
                  </select>
                )}
              </div>
              {filteredReviews.map((item) => (
                <ReviewItemRow
                  key={item.id}
                  item={item}
                  selected={selectedIds.has(item.id)}
                  onToggleSelected={toggleSelected}
                />
              ))}
            </>
          )}
        </div>
      )}

      <WikiIngestProgressStrip />
    </div>
  );
}

// ponytail: ingest progress strip. Visible while isIngesting; lingers 2s after
// ingest completes so the final success activity entry is readable. Reuses
// activityLog slice + ingestProgress from wikiStore — no new state.
function WikiIngestProgressStrip() {
  const isIngesting = useWikiStore((s) => s.isIngesting);
  const currentIngestStep = useWikiStore((s) => s.currentIngestStep);
  const ingestProgress = useWikiStore((s) => s.ingestProgress);
  // ponytail: select the stable activityLog ref, slice in render. A selector
  // returning `.slice(-5)` mints a new array each call → useSyncExternalStore
  // sees a new ref every render → Maximum update depth exceeded loop.
  const activityLog = useWikiStore((s) => s.activityLog);
  const lastActivities = activityLog.slice(-5);
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (isIngesting) {
      if (!show) setShow(true);
      return;
    }
    if (!show) return;
    const t = setTimeout(() => setShow(false), 2000);
    return () => clearTimeout(t);
  }, [isIngesting, show]);

  if (!show) return null;

  return (
    <div className="shrink-0 border-t border-brd bg-panel px-2 py-1.5 text-[10px] text-t3 transition-opacity duration-200 opacity-100">
      <div className="flex items-center gap-1.5 font-mono">
        <span className="text-acc">Step {currentIngestStep ?? '?'}/3</span>
        {ingestProgress && <span className="truncate">{ingestProgress}</span>}
      </div>
      {lastActivities.length > 0 && (
        <div className="mt-1 space-y-0.5">
          {lastActivities.map((a) => (
            <div key={a.id} className="truncate overflow-hidden text-ellipsis whitespace-nowrap">
              {a.message}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
