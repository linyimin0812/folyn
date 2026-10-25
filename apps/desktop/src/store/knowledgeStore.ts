/**
 * 知识库运行时状态（Zustand，无持久化 —— 真源在 `<vault>/__kb__/` 文件，
 * ADR-0009；面板挂载/切 Vault /构建与审阅操作后从 manifest 水合）。
 *
 * 页面/选中主题是跨区域共享 UI 状态（侧栏导航 ↔ 主工作区四页），仿
 * sessionsUiStore 的协调方式放在这里；磁盘读写全部走 services/knowledge/*。
 */

import { create } from 'zustand';
import {
  vaultKbFs,
  readManifest,
  writeManifest,
  readReviews,
  readNavigation,
} from '@/services/knowledge/kbFs';
import { buildKnowledge, type BuildItemProgress } from '@/services/knowledge/knowledgeBuild';
import { errText } from '@/utils/errText';
import { askKnowledge, invalidateKbIndexCache } from '@/services/knowledge/kbAsk';
import { applyReview, discardReview } from '@/services/knowledge/kbReviewActions';
import type { KbEvidence, KbReviewItem } from '@/services/knowledge/kbTypes';
import { useVaultStore } from '@/store/vaultStore';

export type KbPage = 'knowledge' | 'ask' | 'sources' | 'reviews';

interface KnowledgeState {
  /** 是否已从 manifest 水合（避免空态闪烁）。 */
  loaded: boolean;
  /** 磁盘数据版本号：manifest/reviews 变化时 +1，阅读视图据此重读文件。 */
  dataVersion: number;
  goal: string;
  /** 用户选定的收录范围（vault 相对路径）。 */
  scope: string[];
  /** manifest 中的主题页清单（点击在主区阅读 / 用现有编辑器打开）。 */
  topics: { tpId: string; title: string; path: string }[];
  /** manifest 中的资料登记（状态派生 + 引用面板查当前版本）。 */
  sources: Record<string, { path: string; currentHash: string; removed?: boolean }>;
  /** 主题导航（资料状态「已整理」派生用）。 */
  navigation: { tpId: string; title: string; sourceIds: string[] }[];
  /** 待审阅修订（reviews.json）。 */
  reviews: KbReviewItem[];
  /** 最近一次审阅操作的结果提示（采用成功/需重新比较等）。 */
  reviewNotice: string;

  /** 主工作区当前页 + 阅读视图选中的主题（侧栏与主区共享）。 */
  page: KbPage;
  activeTpId: string | null;

  /** 收录进度（分项发布，ADR-0009）。 */
  buildRunning: boolean;
  buildItems: BuildItemProgress[];
  buildCurrentIndex: number;
  cancelBuild: boolean;
  /** 构建整体失败（如目录扫描失败）；单项失败在 buildItems 里。 */
  buildError: string;

  /** 问答。 */
  askRunning: boolean;
  askQuestion: string;
  askAnswer: string;
  askEvidence: KbEvidence[];
  askNote: string;
  /** 检索阶段文案（加载索引 / 第 N 轮 / 生成回答）。 */
  askPhase: string;
  cancelAsk: boolean;

  /** 从当前 Vault 的 __kb__/ 水合全部派生数据（无 manifest 保持空态）。 */
  loadFromManifest: () => Promise<void>;
  setPage: (page: KbPage) => void;
  setActiveTopic: (tpId: string | null) => void;
  setGoal: (goal: string) => void;
  setScope: (scope: string[]) => void;
  toggleScopePath: (path: string) => void;
  /** 保存 goal/scope 到 manifest（构建前调用；构建也会采纳当前值）。 */
  saveConfig: () => Promise<void>;
  build: (only?: string[]) => Promise<void>;
  cancelBuildRequested: () => void;
  /** 停止跟踪一份资料：移出收录范围 + manifest 标记 removed（保留知识与历史引用）。 */
  stopTracking: (srcId: string) => Promise<void>;
  setAskQuestion: (q: string) => void;
  ask: () => Promise<void>;
  cancelAskRequested: () => void;
  clearAsk: () => void;
  applyReviewItem: (id: string) => Promise<void>;
  discardReviewItem: (id: string) => Promise<void>;
}

function activeVaultId(): string | null {
  return useVaultStore.getState().activeVaultId;
}

export const useKnowledgeStore = create<KnowledgeState>((set, get) => ({
  loaded: false,
  dataVersion: 0,
  goal: '',
  scope: [],
  topics: [],
  sources: {},
  navigation: [],
  reviews: [],
  reviewNotice: '',
  page: 'knowledge',
  activeTpId: null,
  buildRunning: false,
  buildItems: [],
  buildCurrentIndex: -1,
  cancelBuild: false,
  buildError: '',
  askRunning: false,
  askQuestion: '',
  askAnswer: '',
  askEvidence: [],
  askNote: '',
  askPhase: '',
  cancelAsk: false,

  loadFromManifest: async () => {
    const fs = vaultKbFs();
    const manifest = await readManifest(fs).catch(() => null);
    const reviews = await readReviews(fs).catch(() => []);
    const nav = await readNavigation(fs).catch(() => ({ topics: [] }));
    set((s) => ({
      loaded: true,
      dataVersion: s.dataVersion + 1,
      goal: manifest?.goal ?? '',
      scope: manifest?.scope ?? [],
      topics: manifest
        ? Object.entries(manifest.topics).map(([tpId, t]) => ({ tpId, title: t.title, path: t.path }))
        : [],
      sources: manifest?.sources ?? {},
      navigation: nav.topics,
      reviews,
    }));
  },

  setPage: (page) => set({ page }),
  setActiveTopic: (tpId) => set({ activeTpId: tpId, page: tpId ? 'knowledge' : get().page }),

  setGoal: (goal) => set({ goal }),
  setScope: (scope) => set({ scope }),

  toggleScopePath: (path) => {
    const { scope } = get();
    set({ scope: scope.includes(path) ? scope.filter((p) => p !== path) : [...scope, path] });
  },

  saveConfig: async () => {
    const { goal, scope } = get();
    const fs = vaultKbFs();
    try {
      const manifest = (await readManifest(fs).catch(() => null)) ?? {
        goal: '',
        scope: [],
        sources: {},
        topics: {},
      };
      manifest.goal = goal;
      manifest.scope = scope;
      await writeManifest(fs, manifest);
    } catch (err) {
      console.error('[KnowledgeStore] saveConfig failed:', err);
      set({ buildError: `保存设置失败：${errText(err)}` });
    }
  },

  build: async (only) => {
    if (get().buildRunning) return;
    const { goal, scope } = get();
    if (scope.length === 0 && !only) {
      set({ buildItems: [], buildCurrentIndex: -1 });
      return;
    }
    set({ buildRunning: true, cancelBuild: false, buildItems: [], buildCurrentIndex: -1, buildError: '' });
    try {
      await buildKnowledge(vaultKbFs(), {
        goal,
        scope,
        ...(only ? { only } : {}),
        onProgress: (items, currentIndex) => set({ buildItems: items, buildCurrentIndex: currentIndex }),
        shouldCancel: () => get().cancelBuild,
      });
      await get().loadFromManifest();
    } catch (err) {
      // 整体失败（如目录扫描/manifest 写入）；单项收录失败在 buildItems 里逐项展示。
      console.error('[KnowledgeStore] build failed:', err);
      set({ buildError: `构建失败：${errText(err)}` });
    } finally {
      set({ buildRunning: false, buildCurrentIndex: -1 });
    }
  },

  cancelBuildRequested: () => set({ cancelBuild: true }),

  stopTracking: async (srcId) => {
    const fs = vaultKbFs();
    try {
      const manifest = await readManifest(fs);
      const entry = manifest?.sources[srcId];
      if (!manifest || !entry) return;
      entry.removed = true;
      // 显式收录的文件同时移出范围；目录覆盖的文件靠 removed 标记（构建时跳过）。
      manifest.scope = manifest.scope.filter((p) => p !== entry.path);
      await writeManifest(fs, manifest);
      invalidateKbIndexCache();
      await get().loadFromManifest();
    } catch (err) {
      console.error('[KnowledgeStore] stopTracking failed:', err);
      set({ reviewNotice: `停止跟踪失败：${errText(err)}` });
    }
  },

  setAskQuestion: (q) => set({ askQuestion: q }),

  ask: async () => {
    if (get().askRunning) return;
    const question = get().askQuestion.trim();
    const vaultId = activeVaultId();
    if (!question || !vaultId) return;
    set({ askRunning: true, askAnswer: '', askEvidence: [], askNote: '', askPhase: '', cancelAsk: false });
    try {
      const result = await askKnowledge(question, vaultKbFs(), vaultId, {
        onProgress: (phase) => set({ askPhase: phase }),
        shouldCancel: () => get().cancelAsk,
      });
      set({
        askAnswer: result.answer,
        askEvidence: result.retrieval.evidence,
        askNote: result.retrieval.note,
        askPhase: '',
      });
    } catch (err) {
      set({ askAnswer: `提问失败：${errText(err)}`, askPhase: '' });
    } finally {
      set({ askRunning: false, cancelAsk: false });
    }
  },

  cancelAskRequested: () => set({ cancelAsk: true }),

  clearAsk: () =>
    set({ askQuestion: '', askAnswer: '', askEvidence: [], askNote: '', askPhase: '', cancelAsk: false }),

  applyReviewItem: async (id) => {
    const review = get().reviews.find((r) => r.id === id);
    if (!review) return;
    set({ reviewNotice: '' });
    const outcome = await applyReview(vaultKbFs(), review);
    if (outcome.ok) {
      invalidateKbIndexCache();
      set({ reviewNotice: '已采用修订并写入主题页。' });
      await get().loadFromManifest();
    } else {
      // stale / missing-page / error：不写入正文，把原因如实呈现。
      set({ reviewNotice: outcome.message });
    }
  },

  discardReviewItem: async (id) => {
    const review = get().reviews.find((r) => r.id === id);
    if (!review) return;
    try {
      await discardReview(vaultKbFs(), review);
      set({ reviewNotice: '已保留当前正文，丢弃该修订。' });
      await get().loadFromManifest();
    } catch (err) {
      set({ reviewNotice: `操作失败：${errText(err)}` });
    }
  },
}));
