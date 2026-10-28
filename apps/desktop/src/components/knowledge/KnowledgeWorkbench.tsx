import { useEffect } from 'react';
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

const PAGES: { id: KbPage; label: string; icon: typeof BookOpen }[] = [
  { id: 'knowledge', label: '知识页', icon: BookOpen },
  { id: 'ask', label: '提问', icon: MessageCircleQuestion },
  { id: 'sources', label: '资料', icon: FileText },
  { id: 'reviews', label: '审阅', icon: ListChecks },
];

export function KnowledgeWorkbench(): React.JSX.Element {
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
    {!loaded ? <div role="status" className="kb-workspace-loading"><Loader2 size={17} className="animate-spin" />正在打开知识库…</div> : !theme ? <SetupView /> : <>
      <header className="kb-workspace-header">
        <div className="kb-workspace-context"><div className="kb-eyebrow">知识库<span aria-hidden="true"> / </span>当前主题</div><div className="kb-workspace-titleline"><h1 title={theme.name}>{theme.name}</h1><p title={goal}>{goal}</p></div></div>
        <div className="kb-workspace-actions">
          <button className="kb-icon-action" aria-label="主题设置" title="编辑主题名称、目标与资料范围" onClick={() => openSourceSettings('settings')}><Settings2 size={17} strokeWidth={1.5} /></button>
          {scope.length > 0 && <button className={BTN} disabled={buildRunning} onClick={() => openSourceSettings('add')}><Plus size={14} />添加资料</button>}
          {buildRunning ? <button className={BTN_PRIMARY} disabled={cancelBuild} onClick={cancelBuildRequested}><Square size={12} />{cancelBuild ? '正在停止…' : '停止整理'}</button> : <button className={BTN_PRIMARY} disabled={sourceEntry !== 'closed'} onClick={() => { if (scope.length === 0) openSourceSettings('add'); else void build(); }}>{scope.length === 0 ? <Plus size={14} /> : <Play size={13} />}{scope.length === 0 ? '添加资料' : '整理 / 更新'}</button>}
        </div>
      </header>
      {buildRunning && <div role="status" className="kb-workspace-progress"><Loader2 size={12} className="animate-spin" /><span>{cancelBuild ? '当前资料处理结束后停止，已完成结果会保留。' : `正在整理资料 · ${completed} / ${buildItems.length}`}</span><button onClick={() => setPage('sources')}>查看过程</button></div>}
      <nav className="kb-workspace-tabs" aria-label="当前主题工作区">{PAGES.map(({ id, label, icon: Icon }) => <button key={id} aria-current={page === id ? 'page' : undefined} onClick={() => setPage(id)}><Icon size={14} strokeWidth={1.5} />{label}{id === 'reviews' && reviews.length > 0 && <span className="kb-tab-count">{reviews.length}</span>}</button>)}</nav>
      <div key={activeThemeId} className="kb-workspace-content">
        <div className="kb-page-slot" hidden={page !== 'knowledge'}><TopicReader /></div>
        <div className="kb-page-slot" hidden={page !== 'ask'}><AskView /></div>
        <div className="kb-page-slot" hidden={page !== 'sources'}><SourcesView workspaceControls /></div>
        <div className="kb-page-slot" hidden={page !== 'reviews'}><ReviewsView /></div>
      </div>
    </>}
  </div>;
}
