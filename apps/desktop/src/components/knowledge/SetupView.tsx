/**
 * 首次使用引导：知识库目标 + 收录范围选择 + 模型对。
 *
 * 保存后立即开始构建，进度在「资料」页逐项展示（分项发布：首份资料完整
 * 发布即可提问，ADR-0009）。模型选择是低频设置，配置完成后只在设置区
 * 显示摘要，不占阅读空间。
 */

import { useEffect, useMemo, useState } from 'react';
import { Play } from 'lucide-react';
import { useVaultStore } from '@/store/vaultStore';
import { useAiConfigStore } from '@/store/aiConfigStore';
import { PairSelector } from '@/components/ai/PairSelector';
import { useKnowledgeStore } from '@/store/knowledgeStore';
import { KB_DIR } from '@/services/knowledge/kbPaths';
import { BTN, BTN_PRIMARY, INPUT, buildRows, isRowInScope } from './kbUi';
import { isSupportedSourcePath } from '@/services/knowledge/knowledgeBuild';

export function SetupView(): React.JSX.Element {
  const fileTree = useVaultStore((s) => s.fileTree);
  const kbPair = useAiConfigStore((s) => s.kbPair);
  const setKbPair = useAiConfigStore((s) => s.setKbPair);
  const setGoal = useKnowledgeStore((s) => s.setGoal);
  const toggleScopePath = useKnowledgeStore((s) => s.toggleScopePath);
  const scope = useKnowledgeStore((s) => s.scope);
  const saveConfig = useKnowledgeStore((s) => s.saveConfig);
  const build = useKnowledgeStore((s) => s.build);
  const setPage = useKnowledgeStore((s) => s.setPage);
  const buildError = useKnowledgeStore((s) => s.buildError);

  const [goalDraft, setGoalDraft] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);

  // goal 草稿只在本视图初始化（保存后视图即被四页布局替换）。
  useEffect(() => {
    setGoalDraft((d) => (d === '' ? useKnowledgeStore.getState().goal : d));
  }, []);

  const rows = useMemo(() => buildRows(fileTree), [fileTree]);

  const handleStart = async () => {
    setGoal(goalDraft);
    await saveConfig();
    // 构建进度在资料页逐项展示；保存后 goal 已写入，工作台切换到四页布局。
    setPage('sources');
    await build();
  };

  return (
    <div className="flex-1 overflow-y-auto flex justify-center px-4 py-6 [scrollbar-width:thin]">
      <div className="w-full max-w-[560px] flex flex-col gap-4">
        <div>
          <h2 className="text-[15px] font-semibold text-t1">设置知识库</h2>
          <p className="mt-1 text-[12px] text-t3">
            声明知识库目标并选择原始资料。支持 Markdown 与纯文本；生成的知识页存放于{' '}
            <code className="text-t2">{KB_DIR}/</code>，不会作为原始资料循环收录。
          </p>
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-[12px] font-medium text-t2" htmlFor="kb-goal">知识库目标</label>
          <textarea
            id="kb-goal"
            className={`${INPUT} resize-y min-h-[64px]`}
            placeholder="这个知识库要积累什么？（例如：整理 Tauri 桌面开发经验）"
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
            {scope.length > 0 ? `已选 ${scope.length} 项；范围内的新增、修改会自动处理` : '尚未选择资料'}
          </div>
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
                    title={
                      clickable
                        ? row.type === 'dir'
                          ? '收录整个目录'
                          : '收录此文件'
                        : '第一版仅支持 Markdown 与纯文本'
                    }
                    onClick={() => toggleScopePath(row.path)}
                  >
                    <span
                      className={`shrink-0 w-3 h-3 rounded-[3px] border ${
                        inScope ? 'bg-acc border-acc' : 'border-brd'
                      }`}
                    />
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

        {buildError && <div className="text-[11px] text-[#e05252]">{buildError}</div>}

        <div>
          <button className={BTN_PRIMARY} disabled={goalDraft.trim() === '' || scope.length === 0} onClick={() => void handleStart()}>
            <Play size={13} />
            保存并开始处理
          </button>
        </div>
      </div>
    </div>
  );
}
