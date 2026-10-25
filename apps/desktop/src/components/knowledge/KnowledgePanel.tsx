/**
 * 知识库侧栏（builtin panel `knowledge`）：阅读工作台布局的导航区。
 *
 * 聚焦主题导航 + 待处理入口 + 设置摘要；阅读、提问、资料管理与审阅在主工作区
 * （KnowledgeWorkbench，WorkArea 按 activePanel === 'knowledge' 挂载）。
 * 目标/收录范围的完整编辑在主区「资料」页，这里只留摘要与构建入口。
 */

import { useEffect } from 'react';
import { Loader2, Play, Settings, Square } from 'lucide-react';
import { useVaultStore } from '@/store/vaultStore';
import { useAiConfigStore } from '@/store/aiConfigStore';
import { useKnowledgeStore } from '@/store/knowledgeStore';
import { KB_DIR } from '@/services/knowledge/kbPaths';
import { BTN } from './kbUi';

const SECTION_TITLE = 'text-[10px] font-semibold uppercase tracking-wide text-t3 mt-3 mb-1 px-0.5';

export function KnowledgePanel(): React.JSX.Element {
  const currentVault = useVaultStore((state) => state.currentVault);
  const kbPair = useAiConfigStore((s) => s.kbPair);

  const loaded = useKnowledgeStore((s) => s.loaded);
  const goal = useKnowledgeStore((s) => s.goal);
  const scope = useKnowledgeStore((s) => s.scope);
  const topics = useKnowledgeStore((s) => s.topics);
  const activeTpId = useKnowledgeStore((s) => s.activeTpId);
  const reviews = useKnowledgeStore((s) => s.reviews);
  const buildRunning = useKnowledgeStore((s) => s.buildRunning);
  const buildItems = useKnowledgeStore((s) => s.buildItems);
  const buildError = useKnowledgeStore((s) => s.buildError);

  const setActiveTopic = useKnowledgeStore((s) => s.setActiveTopic);
  const setPage = useKnowledgeStore((s) => s.setPage);
  const build = useKnowledgeStore((s) => s.build);
  const cancelBuildRequested = useKnowledgeStore((s) => s.cancelBuildRequested);

  // 挂载 / 切 Vault 时从 manifest 水合（主区 KnowledgeWorkbench 也兜底一次）。
  useEffect(() => {
    if (!currentVault) return;
    void useKnowledgeStore.getState().loadFromManifest();
  }, [currentVault]);

  const failedCount = buildItems.filter((i) => i.status === 'error').length;

  return (
    <div className="flex-1 overflow-y-auto px-2.5 pb-4 [scrollbar-width:thin]">
      {/* 主题导航 */}
      <div className={SECTION_TITLE}>主题</div>
      {!loaded ? (
        <div className="px-0.5 text-t3 text-[10px]">…</div>
      ) : topics.length === 0 ? (
        <div className="px-0.5 text-t3 text-[10px]">
          （暂无，构建后生成；页面存于 {KB_DIR}/topics/）
        </div>
      ) : (
        <div className="flex flex-col gap-[1px]">
          {topics.map((t) => (
            <button
              key={t.tpId}
              className={`text-left px-1.5 py-[3px] rounded text-[calc(var(--ui-font-size)-3px)] border-none bg-transparent cursor-pointer truncate ${
                t.tpId === activeTpId ? 'bg-accdim text-acc' : 'text-t2 hover:bg-hov hover:text-t1'
              }`}
              title={t.path}
              onClick={() => setActiveTopic(t.tpId === activeTpId ? null : t.tpId)}
            >
              {t.title}
            </button>
          ))}
        </div>
      )}

      {/* 待处理入口（低饱和琥珀 + 文字） */}
      <div className={SECTION_TITLE}>待处理</div>
      <button
        className="flex items-center justify-between w-full px-1.5 py-[3px] rounded text-[calc(var(--ui-font-size)-3px)] border-none bg-transparent text-t2 cursor-pointer hover:bg-hov hover:text-t1"
        onClick={() => setPage('reviews')}
        disabled={reviews.length === 0}
        title={reviews.length === 0 ? '无待审阅修订' : `${reviews.length} 项修订待审阅`}
      >
        <span>待审阅修订</span>
        <span className={reviews.length > 0 ? 'text-[#b48a3f]' : 'text-t3'}>{reviews.length}</span>
      </button>
      {failedCount > 0 && (
        <button
          className="flex items-center justify-between w-full px-1.5 py-[3px] rounded text-[calc(var(--ui-font-size)-3px)] border-none bg-transparent text-t2 cursor-pointer hover:bg-hov hover:text-t1"
          onClick={() => setPage('sources')}
          title="处理失败的资料（可单项重试）"
        >
          <span>处理失败</span>
          <span className="text-[#e05252]">{failedCount}</span>
        </button>
      )}

      {/* 设置摘要（低频配置；完整编辑在主区「资料」页） */}
      <div className={SECTION_TITLE}>设置</div>
      <div className="px-0.5 mb-1 flex flex-col gap-[2px] text-[10px] text-t3">
        <span className="truncate" title={goal}>目标：{goal || '（未设置）'}</span>
        <span>收录：{scope.length} 项</span>
        <span className="truncate" title={kbPair ? `${kbPair.provider} / ${kbPair.model}` : '跟随全局聊天模型'}>
          模型：{kbPair ? `${kbPair.provider} / ${kbPair.model}` : '跟随全局'}
        </span>
      </div>
      <div className="flex items-center gap-1 flex-wrap">
        <button className={BTN} onClick={() => setPage('sources')}>
          <Settings size={12} />
          设置知识库
        </button>
        {!buildRunning ? (
          <button className={BTN} disabled={scope.length === 0} onClick={() => void build()}>
            <Play size={12} />
            {topics.length > 0 ? '更新' : '构建'}
          </button>
        ) : (
          <button className={BTN} onClick={cancelBuildRequested}>
            {buildRunning ? <Loader2 size={12} className="animate-spin" /> : <Square size={12} />}
            停止
          </button>
        )}
      </div>
      {buildError && <div className="mt-1 text-[10px] text-[#e05252]">{buildError}</div>}
    </div>
  );
}
