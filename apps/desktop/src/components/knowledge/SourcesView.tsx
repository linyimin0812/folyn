/**
 * 「资料」页：收录范围管理 + 单项状态列表（从 manifest/navigation/reviews 派生，
 * 处理失败来自当前构建会话的 buildItems——跨会话丢失可接受，给重试入口）。
 *
 * 真实操作：编辑收录范围、保存设置、构建/更新、单项重试、停止跟踪
 * （manifest 标记 removed，保留知识与历史引用，ADR-0007）、打开原文。
 * 设置是低频配置：默认收起，摘要常显。
 */

import { useEffect, useMemo, useState } from 'react';
import { Loader2, Pencil, Play, RotateCcw, Square, StopCircle, ExternalLink } from 'lucide-react';
import { useVaultStore } from '@/store/vaultStore';
import { useAiConfigStore } from '@/store/aiConfigStore';
import { PairSelector } from '@/components/ai/PairSelector';
import { useEditorStore } from '@/store/editorStore';
import { useKnowledgeStore } from '@/store/knowledgeStore';
import { openFile } from '@/services/editorIoService';
import { expandScope, isSupportedSourcePath } from '@/services/knowledge/knowledgeBuild';
import {
  deriveSourceStatuses,
  sourceStatusLabel,
  type KbSourceStatus,
} from '@/services/knowledge/sourceStatus';
import { BTN, BTN_PRIMARY, INPUT, buildRows, buildStatusLabel, isRowInScope } from './kbUi';

const STATUS_COLOR: Record<KbSourceStatus, string> = {
  pending: 'text-t3',
  processing: 'text-acc',
  error: 'text-[#e05252]',
  removed: 'text-t3',
  review: 'text-[#b48a3f]',
  organized: 'text-acc',
  indexed: 'text-t2',
};

export function SourcesView(): React.JSX.Element {
  const fileTree = useVaultStore((s) => s.fileTree);
  const kbPair = useAiConfigStore((s) => s.kbPair);
  const setKbPair = useAiConfigStore((s) => s.setKbPair);

  const goal = useKnowledgeStore((s) => s.goal);
  const scope = useKnowledgeStore((s) => s.scope);
  const sources = useKnowledgeStore((s) => s.sources);
  const navigation = useKnowledgeStore((s) => s.navigation);
  const reviews = useKnowledgeStore((s) => s.reviews);
  const buildRunning = useKnowledgeStore((s) => s.buildRunning);
  const buildItems = useKnowledgeStore((s) => s.buildItems);
  const buildCurrentIndex = useKnowledgeStore((s) => s.buildCurrentIndex);
  const buildError = useKnowledgeStore((s) => s.buildError);

  const setGoal = useKnowledgeStore((s) => s.setGoal);
  const toggleScopePath = useKnowledgeStore((s) => s.toggleScopePath);
  const saveConfig = useKnowledgeStore((s) => s.saveConfig);
  const build = useKnowledgeStore((s) => s.build);
  const cancelBuildRequested = useKnowledgeStore((s) => s.cancelBuildRequested);
  const stopTracking = useKnowledgeStore((s) => s.stopTracking);

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [goalDraft, setGoalDraft] = useState(goal);
  const [pickerOpen, setPickerOpen] = useState(false);

  // 构建后 manifest 重读会改 goal —— 草稿跟随（用户正在输入时 goal 不会变）。
  useEffect(() => setGoalDraft(goal), [goal]);

  const rows = useMemo(() => buildRows(fileTree), [fileTree]);
  const scopeFiles = useMemo(() => expandScope(scope, rows), [scope, rows]);

  const statusItems = useMemo(
    () => deriveSourceStatuses({ manifest: { scope, sources }, scopeFiles, navigation, reviews, buildItems }),
    [scope, sources, scopeFiles, navigation, reviews, buildItems],
  );

  const doneCount = buildItems.filter((i) => i.status === 'done' || i.status === 'skipped' || i.status === 'error').length;

  const handleSave = async () => {
    setGoal(goalDraft);
    await saveConfig();
    setSettingsOpen(false);
  };

  const handleBuild = async () => {
    setGoal(goalDraft);
    await build();
  };

  return (
    <div className="flex-1 overflow-y-auto px-4 py-3 [scrollbar-width:thin]">
      <div className="max-w-[820px] mx-auto flex flex-col gap-3">
        {/* 设置摘要（低频配置不占阅读空间） */}
        <div className="px-3 py-2 border border-brd rounded-[6px] flex items-center gap-2 text-[12px]">
          <span className="text-t3 shrink-0">目标</span>
          <span className="text-t2 truncate" title={goal}>{goal || '（未设置）'}</span>
          <span className="text-t3 shrink-0">· 收录 {scope.length} 项</span>
          <span className="text-t3 shrink-0">· 模型{kbPair ? `${kbPair.provider} / ${kbPair.model}` : '跟随全局'}</span>
          <div className="flex-1" />
          <button className={BTN} onClick={() => setSettingsOpen((v) => !v)} aria-expanded={settingsOpen}>
            <Pencil size={12} />
            {settingsOpen ? '收起设置' : '设置'}
          </button>
        </div>

        {settingsOpen && (
          <div className="px-3 py-2.5 border border-brd rounded-[6px] flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <label className="text-[12px] font-medium text-t2" htmlFor="kb-goal-sources">知识库目标</label>
              <textarea
                id="kb-goal-sources"
                className={`${INPUT} resize-y min-h-[52px]`}
                value={goalDraft}
                onChange={(e) => setGoalDraft(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <label className="text-[12px] font-medium text-t2">收录范围</label>
                <button className={BTN} onClick={() => setPickerOpen((v) => !v)}>
                  {pickerOpen ? '收起选择器' : '选择文件 / 目录'}
                </button>
              </div>
              <div className="text-[11px] text-t3">
                支持 Markdown 与纯文本；<code>__kb__/</code> 知识页目录不参与收录。
              </div>
              {scope.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {scope.map((p) => (
                    <button
                      key={p}
                      className="flex items-center gap-0.5 max-w-full px-1.5 py-0.5 rounded bg-hov text-t2 text-[11px] border border-transparent hover:border-brd cursor-pointer"
                      title={`移除 ${p}（目录覆盖的单个文件请用列表中的「停止跟踪」）`}
                      onClick={() => toggleScopePath(p)}
                    >
                      <span className="truncate max-w-[180px]">{p}</span>
                      <span aria-hidden>×</span>
                    </button>
                  ))}
                </div>
              )}
              {pickerOpen && (
                <div className="max-h-[240px] overflow-y-auto border border-brd rounded-[5px] py-1 [scrollbar-width:thin]">
                  {rows.length === 0 && <div className="px-2 py-1 text-t3 text-[11px]">（Vault 中无文件）</div>}
                  {rows.map((row) => {
                    const inScope = isRowInScope(row, scope);
                    const clickable = row.type === 'dir' || isSupportedSourcePath(row.path);
                    return (
                      <button
                        key={row.path}
                        className={`flex items-center gap-1.5 w-full text-left px-1.5 py-[3px] text-[12px] cursor-pointer border-none bg-transparent hover:bg-hov ${
                          inScope ? 'text-acc' : 'text-t2'
                        } ${clickable ? '' : 'opacity-40 cursor-default'}`}
                        style={{ paddingLeft: `${6 + row.depth * 12}px` }}
                        disabled={!clickable}
                        title={clickable ? (row.type === 'dir' ? '收录整个目录' : '收录此文件') : '第一版仅支持 Markdown 与纯文本'}
                        onClick={() => toggleScopePath(row.path)}
                      >
                        <span className={`shrink-0 w-3 h-3 rounded-[3px] border ${inScope ? 'bg-acc border-acc' : 'border-brd'}`} />
                        <span className="truncate">{row.name}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-[12px] font-medium text-t2">模型</label>
              <div className="flex items-center gap-2">
                <PairSelector value={kbPair} onChange={setKbPair} />
                {!kbPair && <span className="text-[11px] text-t3">当前跟随全局聊天模型</span>}
              </div>
            </div>
            <div>
              <button className={BTN} onClick={() => void handleSave()}>保存设置</button>
            </div>
          </div>
        )}

        {/* 构建 */}
        <div className="flex items-center gap-1.5">
          {!buildRunning ? (
            <button className={BTN_PRIMARY} disabled={scope.length === 0} onClick={() => void handleBuild()}>
              <Play size={13} />
              {buildItems.length > 0 || statusItems.length > 0 ? '更新知识库' : '构建知识库'}
            </button>
          ) : (
            <button className={BTN} onClick={cancelBuildRequested}>
              <Square size={12} />
              停止（{doneCount}/{buildItems.length}）
            </button>
          )}
          {buildRunning && <Loader2 size={13} className="animate-spin text-t3" />}
          {buildRunning && (
            <span className="text-[11px] text-t3">每份资料完整发布后即可检索，无需等待整批完成。</span>
          )}
        </div>
        {buildError && <div className="text-[11px] text-[#e05252]">{buildError}</div>}
        {buildItems.length > 0 && (
          <div className="border border-brd rounded-[5px] max-h-[180px] overflow-y-auto [scrollbar-width:thin]">
            {buildItems.map((item, i) => (
              <div key={item.path} className={`px-2.5 py-1 text-[11px] ${i === buildCurrentIndex ? 'bg-hov' : ''}`}>
                <span className="text-t2 truncate block" title={item.path}>{item.path}</span>
                <span
                  className={
                    item.status === 'error' ? 'text-[#e05252]' : item.status === 'done' ? 'text-acc' : 'text-t3'
                  }
                >
                  {buildStatusLabel(item.status)}
                  {item.message ? ` · ${item.message}` : ''}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* 资料状态列表 */}
        <div className="flex flex-col gap-1">
          <div className="text-[11px] font-semibold text-t3">资料（{statusItems.length}）</div>
          {statusItems.length === 0 && (
            <div className="text-[12px] text-t3">收录范围内暂无资料，展开「设置」选择文件或目录。</div>
          )}
          {statusItems.map((item) => (
            <div
              key={`${item.srcId ?? 'new'}-${item.path}`}
              className="px-2.5 py-1.5 border border-brd rounded-[5px] flex items-start gap-2"
            >
              <div className="flex-1 min-w-0">
                <div className="text-[12px] text-t1 truncate" title={item.path}>{item.path}</div>
                <div className={`text-[11px] ${STATUS_COLOR[item.status]}`}>
                  {sourceStatusLabel(item.status)}
                  {item.message ? ` · ${item.message}` : ''}
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                {item.status === 'error' && !buildRunning && (
                  <button
                    className={BTN}
                    title="只重新处理这份资料"
                    onClick={() => void useKnowledgeStore.getState().build([item.path])}
                  >
                    <RotateCcw size={12} />
                    重试
                  </button>
                )}
                {item.status === 'removed' && item.srcId && (
                  <span className="text-[11px] text-t3" title="知识与历史引用已保留；检索证据会标记来源已移除">
                    已停止跟踪
                  </span>
                )}
                {item.status !== 'removed' && item.srcId && (
                  <button
                    className={BTN}
                    title="停止跟踪：后续修改不再处理；已有知识与历史引用保留，检索证据标记来源已移除"
                    onClick={() => {
                      if (item.srcId) void stopTracking(item.srcId);
                    }}
                  >
                    <StopCircle size={12} />
                    停止跟踪
                  </button>
                )}
                {item.srcId && !sources[item.srcId]?.removed && (
                  <button
                    className={BTN}
                    title={`在编辑器中打开：${item.path}`}
                    aria-label={`打开原文 ${item.path}`}
                    onClick={() => {
                      void openFile(item.path, item.path.split('/').pop() ?? item.path);
                      useEditorStore.getState().setActivePanel('files');
                    }}
                  >
                    <ExternalLink size={12} />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
