import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useWikiStore } from '@/store/wikiStore';
import { useVaultStore } from '@/store/vaultStore';
import * as editorIoService from '@/services/editorIoService';
import type { ReviewItem, WikiEntry } from '@/types/wiki';
import { WIKI_PREFIX } from '@/types/wiki';
import { FileIcon } from '@/components/icons/FileIcon';
import { Plus, FileText, AlertCircle } from 'lucide-react';

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

function ReviewItemRow({ item }: { item: ReviewItem }) {
  const { t } = useTranslation();
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

  useEffect(() => {
    if (!isInitialized) {
      initWiki();
    }
  }, [isInitialized, initWiki]);

  const topFiles = wikiFiles.filter((e) => e.type === 'file');
  const dirs = wikiFiles.filter((e) => e.type === 'dir');
  const pendingReviews = reviewItems.filter((r) => r.status === 'pending');

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

  return (
    <div className="flex-1 overflow-y-auto flex flex-col">
      <div className="py-2 px-3 text-[11px] font-semibold text-t3 uppercase tracking-[0.5px] flex items-center justify-between">
        <span>Wiki</span>
        {subTab === 'files' && (
          <button
            className="text-t3 hover:text-acc transition-colors"
            onClick={handlePickIngest}
            title={t('sidebar:wikiTree.addSourceFiles')}
          >
            <Plus size={13} />
          </button>
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
            <div className="p-4 text-center text-xs text-t3 leading-relaxed">
              {t('sidebar:wikiTree.reviewsEmpty')}
            </div>
          ) : (
            pendingReviews.map((item) => (
              <ReviewItemRow key={item.id} item={item} />
            ))
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
        <span className="text-acc">Step {currentIngestStep ?? '?'}/2</span>
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
