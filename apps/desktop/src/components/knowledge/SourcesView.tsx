/** Routine ingestion, saved configuration, and real per-source processing outcomes. */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { KbLanguage } from '@/services/knowledge/kbTypes';
import { ExternalLink, Loader2, Pencil, Play, Plus, RotateCcw, Square, StopCircle } from 'lucide-react';
import { useVaultStore } from '@/store/vaultStore';
import { useAiConfigStore } from '@/store/aiConfigStore';
import { useEditorStore } from '@/store/editorStore';
import { useKnowledgeStore, type KbBuildDetail } from '@/store/knowledgeStore';
import { KnowledgeModelSelector } from './KnowledgeModelSelector';
import { Toggle } from '@/components/settings/primitives';
import { openFile } from '@/services/editorIoService';
import { expandScope } from '@/services/knowledge/knowledgeBuild';
import { deriveSourceStatuses, sourceStatusLabel } from '@/services/knowledge/sourceStatus';
import { BTN, BTN_PRIMARY, INPUT, buildRows, buildStatusLabel } from './kbUi';
import { ScopePicker } from './ScopePicker';

type SourceDraft = { name: string; goal: string; scope: string[]; language: KbLanguage; pair: ReturnType<typeof useAiConfigStore.getState>['kbPair']; auto: boolean; showScope: boolean };
const sourceDrafts = new Map<string, SourceDraft>();

export function SourcesView({ workspaceControls = false }: { workspaceControls?: boolean }): React.JSX.Element {
  const { t } = useTranslation();
  const fileTree = useVaultStore((s) => s.fileTree);
  const vaultId = useVaultStore((s) => s.activeVaultId);
  const kbPair = useAiConfigStore((s) => s.kbPair);
  const setKbPair = useAiConfigStore((s) => s.setKbPair);
  const autoBuild = useAiConfigStore((s) => s.kbAutoBuild);
  const setAutoBuild = useAiConfigStore((s) => s.setKbAutoBuild);
  const themeId = useKnowledgeStore((s) => s.activeThemeId);
  const themes = useKnowledgeStore((s) => s.themes);
  const themeName = themes.find((theme) => theme.id === themeId)?.name ?? '';
  const draftKey = `${vaultId}:${themeId}`;
  const cachedDraft = sourceDrafts.get(draftKey);
  const goal = useKnowledgeStore((s) => s.goal);
  const language = useKnowledgeStore((s) => s.language);
  const scope = useKnowledgeStore((s) => s.scope);
  const sources = useKnowledgeStore((s) => s.sources);
  const navigation = useKnowledgeStore((s) => s.navigation);
  const topics = useKnowledgeStore((s) => s.topics);
  const reviews = useKnowledgeStore((s) => s.reviews);
  const buildRunning = useKnowledgeStore((s) => s.buildRunning);
  const buildItems = useKnowledgeStore((s) => s.buildItems);
  const buildDetails = useKnowledgeStore((s) => s.buildDetails);
  const buildError = useKnowledgeStore((s) => s.buildError);
  const cancelBuild = useKnowledgeStore((s) => s.cancelBuild);
  const sourceEntry = useKnowledgeStore((s) => s.sourceEntry);
  const openSourceSettings = useKnowledgeStore((s) => s.openSourceSettings);
  const closeSourceSettings = useKnowledgeStore((s) => s.closeSourceSettings);
  const saveConfig = useKnowledgeStore((s) => s.saveConfig);
  const build = useKnowledgeStore((s) => s.build);
  const stopTracking = useKnowledgeStore((s) => s.stopTracking);
  const cancelBuildRequested = useKnowledgeStore((s) => s.cancelBuildRequested);
  const setActiveTopic = useKnowledgeStore((s) => s.setActiveTopic);
  const setPage = useKnowledgeStore((s) => s.setPage);
  const [nameDraft, setNameDraft] = useState(cachedDraft?.name ?? themeName);
  const [goalDraft, setGoalDraft] = useState(cachedDraft?.goal ?? goal);
  const [languageDraft, setLanguageDraft] = useState<KbLanguage>(cachedDraft?.language ?? language);
  const [scopeDraft, setScopeDraft] = useState(cachedDraft?.scope ?? scope);
  const [pairDraft, setPairDraft] = useState(cachedDraft?.pair ?? kbPair);
  const [autoDraft, setAutoDraft] = useState(cachedDraft?.auto ?? autoBuild);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [notice, setNotice] = useState('');
  const [stoppingId, setStoppingId] = useState<string | null>(null);
  const [showScope, setShowScope] = useState(cachedDraft?.showScope ?? false);
  const previousEntry = useRef(cachedDraft ? sourceEntry : 'closed');

  // Keep unfinished edits per Vault/theme; page switches keep this component mounted.
  useEffect(() => {
    const previous = previousEntry.current;
    previousEntry.current = sourceEntry;
    if (sourceEntry === 'closed' || previous !== 'closed') return;
    setNameDraft(themeName);
    setGoalDraft(useKnowledgeStore.getState().goal);
    setLanguageDraft(useKnowledgeStore.getState().language);
    setScopeDraft([...useKnowledgeStore.getState().scope]);
    setPairDraft(useAiConfigStore.getState().kbPair);
    setAutoDraft(useAiConfigStore.getState().kbAutoBuild);
    setFormError(''); setShowScope(sourceEntry === 'add');
  }, [sourceEntry, themeName]);
  useEffect(() => {
    if (sourceEntry === 'closed') sourceDrafts.delete(draftKey);
    else sourceDrafts.set(draftKey, {name: nameDraft, goal: goalDraft, scope: scopeDraft, language: languageDraft, pair: pairDraft, auto: autoDraft, showScope});
  }, [draftKey, sourceEntry, nameDraft, goalDraft, languageDraft, scopeDraft, pairDraft, autoDraft, showScope]);

  const rows = useMemo(() => buildRows(fileTree), [fileTree]);
  const scopeFiles = useMemo(() => expandScope(scope, rows), [scope, rows]);
  const draftFiles = useMemo(() => expandScope(scopeDraft, rows), [scopeDraft, rows]);
  const removedPaths = new Set(Object.values(sources).filter((source) => source.removed).map((source) => source.path));
  const eligibleFiles = scopeFiles.filter((path) => !removedPaths.has(path) || scope.includes(path));
  const draftEligible = draftFiles.filter((path) => !removedPaths.has(path) || scopeDraft.includes(path));
  const excludedCount = draftFiles.length - draftEligible.length;
  const addedCount = draftFiles.filter((path) => !scopeFiles.includes(path)).length;
  const statuses = useMemo(() => deriveSourceStatuses({ manifest: { scope, sources }, scopeFiles, navigation, reviews, buildItems }), [scope, sources, scopeFiles, navigation, reviews, buildItems]);
  const done = buildItems.filter((i) => i.status === 'done').length;
  const skipped = buildItems.filter((i) => i.status === 'skipped').length;
  const failed = buildItems.filter((i) => i.status === 'error').length;
  const unfinished = buildItems.length - done - skipped - failed;
  const processedSourceIds = new Set(Object.entries(sources).filter(([, source]) => buildItems.some((item) => item.path === source.path && item.status === 'done')).map(([id]) => id));
  const relatedTopics = topics.filter((topic) => navigation.some((n) => n.tpId === topic.tpId && n.sourceIds.some((id) => processedSourceIds.has(id))));

  const save = async (organize: boolean) => {
    if (saving) return;
    if (!nameDraft.trim()) { setFormError(t('knowledge:sources.nameRequired')); return; }
    if (!goalDraft.trim()) { setFormError(t('knowledge:sources.goalRequired')); return; }
    if (organize && draftEligible.length === 0) { setFormError(t('knowledge:sources.needOne')); return; }
    setSaving(true); setFormError(''); setNotice('');
    const result = await saveConfig({ name: nameDraft.trim(), goal: goalDraft.trim(), scope: scopeDraft, language: languageDraft });
    if (useKnowledgeStore.getState().activeThemeId !== themeId || useVaultStore.getState().activeVaultId !== vaultId) { setSaving(false); return; }
    if (!result.ok) { setFormError(result.error); setSaving(false); return; }
    setKbPair(pairDraft); setAutoBuild(autoDraft);
    closeSourceSettings(); setSaving(false);
    setNotice(organize ? t('knowledge:sources.noticeSavedOrganize') : t('knowledge:sources.noticeSavedOnly'));
    if (organize) {
      await build();
      const error = useKnowledgeStore.getState().buildError;
      setNotice(error ? t('knowledge:sources.noticeOrganizeError') : t('knowledge:sources.noticeDone'));
    }
  };

  return <div className="kb-page flex-1 min-h-0 min-w-0 overflow-y-auto [scrollbar-width:thin]">
    <div className="kb-page-inner flex flex-col gap-3">
      <header className="flex flex-wrap justify-between items-start gap-4">
        <div><h1 className="kb-page-title">{t('knowledge:sources.title')}</h1><p className="kb-page-description">{t('knowledge:sources.description', { count: scopeFiles.length })}</p></div>
        {!workspaceControls && <button className={BTN_PRIMARY} disabled={saving || buildRunning} onClick={() => openSourceSettings('add')}><Plus size={14} />{t('knowledge:sources.addSources')}</button>}
      </header>
      {!workspaceControls && <div className="flex flex-wrap items-center gap-3 text-[12px] text-t3">
        <button className={BTN} disabled={saving} onClick={() => openSourceSettings('settings')}><Pencil size={12} />{t('knowledge:sources.settings')}</button>
      </div>}
      {sourceEntry !== 'closed' && <section aria-label={sourceEntry === 'add' ? t('knowledge:sources.sectionAdd') : t('knowledge:sources.sectionSettings')} className="border border-brd rounded-lg p-3"><fieldset disabled={saving} className="min-w-0 flex flex-col gap-3">
        <h2 className="text-[15px] font-medium text-t1">{sourceEntry === 'add' ? t('knowledge:sources.addHeading') : t('knowledge:sources.settingsHeading')}</h2>
        {sourceEntry === 'settings' && <>
          <label className="text-[12px] text-t2 flex flex-col gap-2">{t('knowledge:sources.nameLabel')}<input className={INPUT} value={nameDraft} onChange={(event) => setNameDraft(event.target.value)} maxLength={100} /></label>
          <label className="text-[12px] text-t2 flex flex-col gap-2">{t('knowledge:sources.goalLabel')}<textarea className={`${INPUT} resize-none min-h-[64px]`} disabled={saving} value={goalDraft} onChange={(e) => setGoalDraft(e.target.value)} /></label>
          <label className="text-[12px] text-t2 flex flex-col gap-2">{t('knowledge:language.label')}<select className={INPUT} disabled={saving} value={languageDraft} onChange={(e) => setLanguageDraft(e.target.value as KbLanguage)}>
            <option value="auto">{t('knowledge:language.auto')}</option>
            <option value="zh">{t('knowledge:language.zh')}</option>
            <option value="en">{t('knowledge:language.en')}</option>
          </select><span className="text-t3 text-[11px]">{t('knowledge:language.hint')}</span></label>
          <div className="flex gap-2 items-center text-[12px] text-t2"><Toggle value={autoDraft} onChange={(value) => { if (!saving) setAutoDraft(value); }} /><span>{t('knowledge:sources.autoToggle')}</span></div>
        </>}
        <KnowledgeModelSelector value={pairDraft} disabled={saving || buildRunning} panelAlign="left" onChange={(value) => { if (!saving && !buildRunning) setPairDraft(value); }} />
        <div className="flex flex-wrap gap-3 items-center justify-between"><span className="text-[12px] text-t2">{t('knowledge:sources.scopeLabel')}</span><button className={BTN} disabled={saving} aria-expanded={showScope} onClick={() => setShowScope((v) => !v)}>{showScope ? t('knowledge:sources.collapseFiles') : t('knowledge:sources.pickFiles')}</button></div>
        <p className="text-[12px] text-t3">{t('knowledge:sources.scopeHint')}</p>
        {showScope && <ScopePicker rows={rows} scope={scopeDraft} onChange={setScopeDraft} disabled={saving} />}
        <div className="flex flex-wrap gap-2">{scopeDraft.map((path) => <button key={path} className={BTN} disabled={saving} aria-label={t('knowledge:sources.removeScopeAria', { path })} onClick={() => setScopeDraft((s) => s.filter((p) => p !== path))}><span className="break-all">{path}</span><span aria-hidden>×</span></button>)}</div>
        <p role="status" className="text-[12px] text-t2">{t('knowledge:sources.previewTotal', { total: draftFiles.length })}{addedCount > 0 ? t('knowledge:sources.previewAdded', { count: addedCount }) : ''}{t('knowledge:sources.previewDot')}{excludedCount > 0 ? t('knowledge:sources.previewExcluded', { count: excludedCount, eligible: draftEligible.length }) : ''}{t('knowledge:sources.previewSkip')}</p>
        {formError && <p role="alert" className="text-[12px] text-[var(--red)]">{formError}</p>}
        <div className="flex flex-wrap gap-2"><button className={BTN_PRIMARY} disabled={saving || buildRunning || draftEligible.length === 0} onClick={() => void save(true)}>{saving ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />}{t('knowledge:sources.saveOrganize')}</button><button className={BTN} disabled={saving || buildRunning} onClick={() => void save(false)}>{t('knowledge:sources.saveOnly')}</button><button className={BTN} disabled={saving} onClick={() => { closeSourceSettings(); setFormError(''); }}>{t('knowledge:sources.cancel')}</button></div>
      </fieldset></section>}
      {notice && <div role="status" className="text-[12px] text-t2">{notice}</div>}
      <div className="flex flex-wrap gap-3 items-center">
        {!workspaceControls && (!buildRunning ? <button className={BTN_PRIMARY} disabled={eligibleFiles.length === 0 || sourceEntry !== 'closed'} onClick={() => { setNotice(''); void build(); }}><Play size={13} />{t('knowledge:workbench.organize')}</button> : <button className={BTN} disabled={cancelBuild} onClick={cancelBuildRequested}><Square size={12} />{cancelBuild ? t('knowledge:sources.stopping') : t('knowledge:sources.stopBuild')}</button>)}
        {buildRunning && <span role="status" className="flex items-center gap-2 text-[12px] text-t3"><Loader2 size={13} className="animate-spin" />{cancelBuild ? t('knowledge:sources.pendingStop') : t('knowledge:sources.processed', { done: done + skipped + failed, total: buildItems.length })}</span>}
      </div>
      {buildError && <p role="alert" className="text-[12px] text-[var(--red)]">{buildError}</p>}
      {!buildRunning && buildItems.length > 0 && <section aria-label={t('knowledge:sources.resultTitle')} className="border border-brd rounded-lg p-3 flex flex-col gap-3">
        <h2 className="text-[14px] font-medium text-t1">{t('knowledge:sources.resultTitle')}</h2><p className="text-[12px] text-t2">{t('knowledge:sources.resultCounts', { done, skipped, failed })}{unfinished > 0 ? t('knowledge:sources.resultUnfinished', { count: unfinished }) : ''}</p>
        {relatedTopics.length > 0 && <div><p className="text-[12px] text-t3 mb-2">{t('knowledge:sources.relatedTitle')}</p><div className="flex flex-wrap gap-2">{relatedTopics.map((topic) => <button key={topic.tpId} className={BTN} onClick={() => setActiveTopic(topic.tpId)}>{topic.title} →</button>)}</div></div>}
        {reviews.length > 0 && <button className={`${BTN} self-start`} onClick={() => setPage('reviews')}>{t('knowledge:sources.viewReviews', { count: reviews.length })}</button>}
        {done > 0 && relatedTopics.length === 0 && <p className="text-[12px] text-t3">{t('knowledge:sources.noRelated')}</p>}
      </section>}
      {buildItems.length > 0 && <details open={buildRunning || failed > 0} className="border border-brd rounded-md p-3"><summary className="text-[12px] text-t2 cursor-pointer">{t('knowledge:sources.detailSummary', { count: buildItems.length })}</summary><div className="mt-3 flex flex-col gap-3">{buildItems.map((item) => { const detail = buildDetails[item.path]; const hasDetail = !!detail && (detail.lines.length > 0 || detail.stream !== ''); return <div key={item.path} className="flex flex-col gap-2"><div className="flex gap-3 items-start"><div className="min-w-0 flex-1"><p className="text-[12px] text-t2 break-all">{item.path}</p><p className={`text-[12px] ${item.status === 'error' ? 'text-[var(--red)]' : 'text-t3'}`}>{buildStatusLabel(item.status)}{item.message ? ` · ${item.message}` : ''}</p></div>{item.status === 'error' && <button className={BTN} disabled={buildRunning} onClick={() => void build([item.path])}><RotateCcw size={12} />{t('knowledge:sources.retry')}</button>}</div>{hasDetail && detail && <BuildItemDetail detail={detail} />}</div>; })}</div></details>}
      <section className="flex flex-col gap-2"><h2 className="text-[13px] font-medium text-t2">{t('knowledge:sources.allSourcesTitle', { count: statuses.length })}</h2>
        {statuses.length === 0 && <p className="text-[13px] text-t3 py-6">{t('knowledge:sources.emptySources')}</p>}
        {statuses.map((item) => { const related = navigation.filter((n) => item.srcId && n.sourceIds.includes(item.srcId)); const sourceReviews = reviews.filter((review) => item.srcId && review.refs?.some((ref) => ref.srcId === item.srcId)); return <div key={`${item.srcId ?? 'new'}:${item.path}`} className="border border-brd rounded-md px-3 py-2 flex flex-wrap gap-2">
          <div className="flex-1 min-w-[min(100%,240px)]"><p className="text-[13px] text-t1 break-all">{item.path}</p><p className="text-[12px] text-t3 mt-1">{sourceStatusLabel(item.status)}{item.message ? ` · ${item.message}` : ''}</p>{related.length > 0 && <div className="flex flex-wrap gap-2 mt-2">{related.map((n) => <button key={n.tpId} className="text-[12px] text-acc underline underline-offset-2" onClick={() => setActiveTopic(n.tpId)}>{n.title}</button>)}</div>}{sourceReviews.length > 0 && <button className="mt-2 text-[12px] text-acc underline underline-offset-2" onClick={() => setPage('reviews')}>{t('knowledge:sources.goReviews', { count: sourceReviews.length })}</button>}</div>
          <div className="flex flex-wrap gap-2 items-start">{item.srcId && item.status !== 'removed' && <button className={BTN} disabled={buildRunning || stoppingId !== null} onClick={() => { if (!item.srcId) return; const id = item.srcId; setStoppingId(id); void stopTracking(id).then(() => { setNotice(useKnowledgeStore.getState().reviewNotice || t('knowledge:sources.stoppedNotice')); }).finally(() => setStoppingId(null)); }} title={t('knowledge:sources.stopTrackingTitle')}><StopCircle size={12} />{t('knowledge:sources.stopTracking')}</button>}{item.srcId && !sources[item.srcId]?.removed && <button className={BTN} aria-label={t('knowledge:sources.openSourceAria', { path: item.path })} onClick={() => { void openFile(item.path, item.path.split('/').pop() ?? item.path); useEditorStore.getState().setActivePanel('files'); }}><ExternalLink size={12} /></button>}</div>
        </div>; })}
      </section>
    </div>
  </div>;
}

interface BuildItemDetailProps {
  detail: KbBuildDetail;
}

/** 单项「详细过程」：上半为阶段事实行，下半为模型正文流尾部（默认收起，按需展开）。 */
function BuildItemDetail({ detail }: BuildItemDetailProps): React.JSX.Element {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const streamRef = useRef<HTMLPreElement>(null);
  useEffect(() => {
    const el = streamRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [detail.stream, detail.lines.length, open]);
  return <div className="min-w-0 flex flex-col gap-2">
    <button className="self-start text-[12px] text-acc underline underline-offset-2" aria-expanded={open} onClick={() => setOpen((v) => !v)}>{open ? t('knowledge:sources.detailClose') : t('knowledge:sources.detailOpen')}</button>
    {open && <div className="min-w-0 flex flex-col gap-2 border border-brd2 rounded-md p-2">
      {detail.lines.length > 0 && <ul className="min-w-0 flex flex-col gap-1" aria-label={t('knowledge:sources.detailPhaseLabel')}>{detail.lines.map((line, i) => <li key={i} className="text-[12px] text-t3 break-all">{line}</li>)}</ul>}
      {detail.stream !== '' && <pre ref={streamRef} aria-label={t('knowledge:sources.streamLabel')} className="min-w-0 max-h-[160px] overflow-y-auto whitespace-pre-wrap break-all rounded-[5px] bg-inp p-2 font-mono text-[11px] text-t3">{detail.stream}</pre>}
    </div>}
  </div>;
}
