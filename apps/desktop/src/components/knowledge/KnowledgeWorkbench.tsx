/**
 * 知识库主工作区视图（阅读工作台布局，notes「 folyn-knowledge-ui-notes.md」）。
 *
 * WorkArea 在 `activePanel === 'knowledge'` 且无 knowledge 标签页时挂载本组件
 * （SessionDetailView 同款门控）。四页：知识 / 提问 / 资料 / 审阅；来源依据按需
 * 在知识页旁侧展开。未配置（无 manifest 或空 goal）时主区渲染「设置知识库」引导。
 */

import { useEffect } from 'react';
import { BookOpen, FileText, ListChecks, MessageCircleQuestion } from 'lucide-react';
import { useVaultStore } from '@/store/vaultStore';
import { useKnowledgeStore, type KbPage } from '@/store/knowledgeStore';
import { SetupView } from './SetupView';
import { TopicReader } from './TopicReader';
import { AskView } from './AskView';
import { SourcesView } from './SourcesView';
import { ReviewsView } from './ReviewsView';

const PAGES: { id: KbPage; label: string; icon: typeof BookOpen }[] = [
  { id: 'knowledge', label: '知识', icon: BookOpen },
  { id: 'ask', label: '提问', icon: MessageCircleQuestion },
  { id: 'sources', label: '资料', icon: FileText },
  { id: 'reviews', label: '审阅', icon: ListChecks },
];

export function KnowledgeWorkbench(): React.JSX.Element {
  const currentVault = useVaultStore((s) => s.currentVault);
  const loaded = useKnowledgeStore((s) => s.loaded);
  const goal = useKnowledgeStore((s) => s.goal);
  const page = useKnowledgeStore((s) => s.page);
  const setPage = useKnowledgeStore((s) => s.setPage);
  const reviews = useKnowledgeStore((s) => s.reviews);

  // 侧栏面板挂载时也会水合；这里兜底（侧栏可能在其它面板激活时未挂载）。
  useEffect(() => {
    if (currentVault) void useKnowledgeStore.getState().loadFromManifest();
  }, [currentVault]);

  if (!loaded) {
    return <div className="flex-1 flex items-center justify-center text-t3 text-[13px] select-none">读取知识库配置…</div>;
  }

  // 首次使用：未配置（无 manifest 或空 goal）→ 设置引导。
  if (goal.trim() === '') {
    return <SetupView />;
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-bg">
      {/* 四页切换：蓝色=当前选择；审阅有待处理项时用低饱和琥珀标记数量。 */}
      <div className="flex items-center gap-0.5 px-2 h-[30px] shrink-0 border-b border-brd">
        {PAGES.map(({ id, label, icon: Icon }) => {
          const active = page === id;
          return (
            <button
              key={id}
              className={`flex items-center gap-1.5 px-2.5 h-[22px] rounded text-[12px] border-none cursor-pointer transition-colors duration-[120ms] ${
                active ? 'bg-accdim text-acc' : 'bg-transparent text-t2 hover:bg-hov hover:text-t1'
              }`}
              onClick={() => setPage(id)}
            >
              <Icon size={13} />
              {label}
              {id === 'reviews' && reviews.length > 0 && (
                <span
                  className="ml-0.5 min-w-[16px] px-1 rounded-full text-[10px] leading-[14px] text-center bg-[#b48a3f]/20 text-[#b48a3f]"
                  title={`${reviews.length} 项待审阅`}
                >
                  {reviews.length}
                </span>
              )}
            </button>
          );
        })}
      </div>

      <div className="flex-1 overflow-hidden">
        {page === 'knowledge' && <TopicReader />}
        {page === 'ask' && <AskView />}
        {page === 'sources' && <SourcesView />}
        {page === 'reviews' && <ReviewsView />}
      </div>
    </div>
  );
}
