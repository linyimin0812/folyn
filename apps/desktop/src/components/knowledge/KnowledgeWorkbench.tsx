import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { BookOpen, FileText, ListChecks, Loader2, MessageCircleQuestion, Play, Plus, Settings2, Square } from 'lucide-react';
import { useVaultStore } from '@/store/vaultStore';
import { useKnowledgeStore, type KbPage } from '@/store/knowledgeStore';
import { SetupView } from './SetupView';
import { TopicReader } from './TopicReader';
import { AskView } from './AskView';
import { SourcesView } from './SourcesView';
import { ReviewsView } from './ReviewsView';
import { ThemeDialog } from './ThemeDialog';
import { BTN, BTN_PRIMARY } from './kbUi';

const PAGES: { id: KbPage; icon: typeof BookOpen }[] = [
  { id: 'knowledge', icon: BookOpen },
  { id: 'ask', icon: MessageCircleQuestion },
  { id: 'sources', icon: FileText },
  { id: 'reviews', icon: ListChecks },
];

export function KnowledgeWorkbench(): React.JSX.Element {
  const { t } = useTranslation();
  const currentVault = useVaultStore((s) => s.currentVault);
  const loaded = useKnowledgeStore((s) => s.loaded);
  const themes = useKnowledgeStore((s) => s.themes);
  const activeThemeId = useKnowledgeStore((s) => s.activeThemeId);
  const goal = useKnowledgeStore((s) => s.goal);
  const page = useKnowledgeStore((s) => s.page);
  const setPage = useKnowledgeStore((s) => s.setPage);
  const reviews = useKnowledgeStore((s) => s.reviews);
  const scope = useKnowledgeStore((s) => s.scope);
  const buildRunning = useKnowledgeStore((s) => s.buildRunning);
  const buildItems = useKnowledgeStore((s) => s.buildItems);
  const cancelBuild = useKnowledgeStore((s) => s.cancelBuild);
  const build = useKnowledgeStore((s) => s.build);
  const cancelBuildRequested = useKnowledgeStore((s) => s.cancelBuildRequested);
  const openSourceSettings = useKnowledgeStore((s) => s.openSourceSettings);
  const sourceEntry = useKnowledgeStore((s) => s.sourceEntry);
  const theme = themes.find((item) => item.id === activeThemeId);
  const completed = buildItems.filter((item) => ['done', 'skipped', 'error'].includes(item.status)).length;

  useEffect(() => {
    if (currentVault) void useKnowledgeStore.getState().loadFromManifest();
  }, [currentVault]);

  return <div className="kb-workbench flex-1 min-h-0 min-w-0 flex flex-col overflow-hidden">
    <ThemeDialog />
    {!loaded ? <div role="status" className="kb-workspace-loading"><Loader2 size={17} className="animate-spin" />{t('knowledge:workbench.loading')}</div> : !theme ? <SetupView /> : <>
      <header className="kb-workspace-header">
        <div className="kb-workspace-context"><div className="kb-eyebrow">{t('knowledge:workbench.eyebrow')}<span aria-hidden="true"> / </span>{t('knowledge:workbench.eyebrowCurrent')}</div><div className="kb-workspace-titleline"><h1 title={theme.name}>{theme.name}</h1><p title={goal}>{goal}</p></div></div>
        <div className="kb-workspace-actions">
          <button className="kb-icon-action" aria-label={t('knowledge:workbench.settingsTitle')} title={t('knowledge:workbench.settingsHint')} onClick={() => openSourceSettings('settings')}><Settings2 size={17} strokeWidth={1.5} /></button>
          {scope.length > 0 && <button className={BTN} disabled={buildRunning} onClick={() => openSourceSettings('add')}><Plus size={14} />{t('knowledge:workbench.addSources')}</button>}
          {buildRunning ? <button className={BTN_PRIMARY} disabled={cancelBuild} onClick={cancelBuildRequested}><Square size={12} />{cancelBuild ? t('knowledge:workbench.stopping') : t('knowledge:workbench.stopBuild')}</button> : <button className={BTN_PRIMARY} disabled={sourceEntry !== 'closed'} onClick={() => { if (scope.length === 0) openSourceSettings('add'); else void build(); }}>{scope.length === 0 ? <Plus size={14} /> : <Play size={13} />}{scope.length === 0 ? t('knowledge:workbench.addSources') : t('knowledge:workbench.organize')}</button>}
        </div>
      </header>
      {buildRunning && <div role="status" className="kb-workspace-progress"><Loader2 size={12} className="animate-spin" /><span>{cancelBuild ? t('knowledge:workbench.progressStopping') : t('knowledge:workbench.progressRunning', { done: completed, total: buildItems.length })}</span><button onClick={() => setPage('sources')}>{t('knowledge:workbench.viewProgress')}</button></div>}
      <nav className="kb-workspace-tabs" aria-label={t('knowledge:workbench.tabsLabel')}>{PAGES.map(({ id, icon: Icon }) => <button key={id} aria-current={page === id ? 'page' : undefined} onClick={() => setPage(id)}><Icon size={14} strokeWidth={1.5} />{t(`knowledge:workbench.tabs.${id}`)}{id === 'reviews' && reviews.length > 0 && <span className="kb-tab-count">{reviews.length}</span>}</button>)}</nav>
      <div key={activeThemeId} className="kb-workspace-content">
        <div className="kb-page-slot" hidden={page !== 'knowledge'}><TopicReader /></div>
        <div className="kb-page-slot" hidden={page !== 'ask'}><AskView /></div>
        <div className="kb-page-slot" hidden={page !== 'sources'}><SourcesView workspaceControls /></div>
        <div className="kb-page-slot" hidden={page !== 'reviews'}><ReviewsView /></div>
      </div>
    </>}
  </div>;
}
