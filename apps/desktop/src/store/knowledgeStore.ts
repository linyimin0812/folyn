/**
 * 知识库运行时状态（Zustand，无持久化 —— 真源在 `~/.folyn/vaults/<vaultId>/__kb__/`
 * 文件，ADR-0009/0011；面板挂载/切 Vault /构建与审阅操作后从 manifest 水合）。
 *
 * 页面/选中主题是跨区域共享 UI 状态（侧栏导航 ↔ 主工作区四页），仿
 * sessionsUiStore 的协调方式放在这里；磁盘读写全部走 services/knowledge/*。
 */

import { generateShortId } from '@/utils/idGenerator';
import { readThemeRegistry, updateThemeRegistry, themeKbFs, type KbTheme } from '@/services/knowledge/kbThemes';
import { create } from 'zustand';
import {
  vaultKbFs,
  type KbFs,
  readManifest,
  writeManifest,
  readReviews,
  readNavigation,
  readTopicRefs,
  kbWriteAtomic,
} from '@/services/knowledge/kbFs';
import { suppressWatcherFor } from '@/utils/fileWatcher';
import { buildKnowledge, type BuildItemProgress } from '@/services/knowledge/knowledgeBuild';
import { errText } from '@/utils/errText';
import { askKnowledge, invalidateKbIndexCache, type KbAskTurn } from '@/services/knowledge/kbAsk';
import { applyReview, discardReview } from '@/services/knowledge/kbReviewActions';
import { verifyTopicRef } from '@/services/knowledge/kbVerify';
import type { KbLanguage, KbReviewItem } from '@/services/knowledge/kbTypes';
import { useVaultStore } from '@/store/vaultStore';
import i18n from '@/i18n';

export type KbPage = 'knowledge' | 'ask' | 'sources' | 'reviews';

/** 单份资料的构建详细过程（阶段事实行 + 模型正文流尾部，内存态、不持久化）。 */
export interface KbBuildDetail {
  lines: string[];
  stream: string;
}

/** 流式正文尾部 buffer：只保留最近 max 字符。 */
export function streamTailBuffer(prev: string, chunk: string, max = 2000): string {
  const next = prev + chunk;
  return next.length > max ? next.slice(next.length - max) : next;
}

interface KnowledgeState {
  themes: KbTheme[];
  activeThemeId: string | null;
  contextVaultId: string | null;
  createTheme: (config: { name: string; goal: string; scope: string[]; language?: KbLanguage }) => Promise<{ ok: true } | { ok: false; error: string }>;
  selectTheme: (id: string) => Promise<void>;
  reconcileTopicEdits: (paths: string[]) => Promise<void>;
  /** 是否已从 manifest 水合（避免空态闪烁）。 */
  loaded: boolean;
  /** 磁盘数据版本号：manifest/reviews 变化时 +1，阅读视图据此重读文件。 */
  dataVersion: number;
  goal: string;
  /** 用户选定的收录范围（vault 相对路径）。 */
  scope: string[];
  /** 内容语言偏好（manifest.language；缺省 auto = 跟随资料原文语言）。 */
  language: KbLanguage;
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
  /** 最近一次引用核验的结果提示（核验通过/不支持/无法核验原因）。 */
  refNotice: string;
  /** 正在核验的引用 id（面板按钮禁用用）。 */
  verifyingRefId: string | null;

  /** 主工作区当前页 + 阅读视图选中的主题（侧栏与主区共享）。 */
  page: KbPage;
  activeTpId: string | null;
  sourceEntry: 'closed' | 'settings' | 'add';
  openSourceSettings: (entry: 'settings' | 'add') => void;
  closeSourceSettings: () => void;

  /** 收录进度（分项发布，ADR-0009）。 */
  buildRunning: boolean;
  mutationRunning: boolean;
  buildItems: BuildItemProgress[];
  /** 并行构建模型：已完成数（done/skipped/error）—— 没有单一「当前项」，
   *  UI 进度条/文案由 buildItems 状态派生（如「已处理 N / M 份资料」）。 */
  buildCurrentIndex: number;
  cancelBuild: boolean;
  /** 构建整体失败（如目录扫描失败）；单项失败在 buildItems 里。 */
  buildError: string;
  /** 逐份资料的详细过程（构建开始清空；结束后内存态保留供回看，不持久化）。 */
  buildDetails: Record<string, KbBuildDetail>;

  /** 问答：会话轮次（运行时态，不落盘；切主题/切 Vault 重置）。
   *  askQuestion 是输入框草稿；askPhase/askNote 只反映进行中的当前轮。 */
  askRunning: boolean;
  askQuestion: string;
  askTurns: KbAskTurn[];
  /** 检索阶段文案（加载索引 / 第 N 轮 / 生成回答）。 */
  askPhase: string;
  cancelAsk: boolean;

  /** 从当前 Vault 的 __kb__/ 水合全部派生数据（无 manifest 保持空态）。 */
  loadFromManifest: () => Promise<void>;
  setPage: (page: KbPage) => void;
  setActiveTopic: (tpId: string | null) => void;
  /** 保存 goal/scope/language 到 manifest（构建前调用；构建也会采纳当前值）。 */
  saveConfig: (config: { goal: string; scope: string[]; name?: string; language?: KbLanguage }) => Promise<{ ok: true } | { ok: false; error: string }>;
  build: (only?: string[]) => Promise<void>;
  cancelBuildRequested: () => void;
  /** 停止跟踪一份资料：移出收录范围 + manifest 标记 removed（保留知识与历史引用）。 */
  stopTracking: (srcId: string) => Promise<void>;
  setAskQuestion: (q: string) => void;
  ask: () => Promise<void>;
  cancelAskRequested: () => void;
  clearAsk: () => void;
  /** 「编辑后采用」：editedBody 为用户在审阅界面改过的建议文本（缺省用原提议）。 */
  applyReviewItem: (id: string, editedBody?: string) => Promise<void>;
  discardReviewItem: (id: string) => Promise<void>;
  /** 引用核验（ADR-0007）：unverified 引用 → 模型判原文是否支持现说法。 */
  verifyTopicRefItem: (tpId: string, refId: string) => Promise<void>;
  /** 页内编辑保存（10-28 任务）：用户编辑，不更新 lastProgramHash（ADR-0006）。 */
  saveTopicPage: (tpId: string, content: string) => Promise<{ ok: true } | { ok: false; error: string }>;
}

function activeVaultId(): string | null {
  return useVaultStore.getState().activeVaultId;
}

export function activeThemeFs(): KbFs {
  const state = useKnowledgeStore.getState();
  const vaultId = activeVaultId();
  if (!vaultId || state.contextVaultId !== vaultId || !state.activeThemeId) throw new Error(i18n.t('knowledge:store.selectThemeFirst'));
  return themeKbFs(vaultId, state.activeThemeId);
}

interface OperationContext { vaultId: string; themeId: string; key: string; fs: KbFs }
const initialSession: Partial<KnowledgeState> = {
  loaded: false,
  dataVersion: 0,
  goal: '',
  scope: [],
  language: 'auto' as KbLanguage,
  topics: [],
  sources: {},
  navigation: [],
  reviews: [],
  reviewNotice: '',
  refNotice: '',
  verifyingRefId: null,
  page: 'knowledge',
  activeTpId: null,
  sourceEntry: 'closed',
  buildRunning: false,
  mutationRunning: false,
  buildItems: [],
  buildCurrentIndex: -1,
  cancelBuild: false,
  buildError: '',
  buildDetails: {},
  askRunning: false,
  askQuestion: '',
  askTurns: [],
  askPhase: '',
  cancelAsk: false
};

export const useKnowledgeStore = create<KnowledgeState>((set, get) => {
  const sessions = new Map<string, Partial<KnowledgeState>>();
  let selectionRequest = 0;
  let registryVersion = 0;
  const mutations = new Set<string>();
  const hydrationVersions = new Map<string, number>();
  const isCurrent = (ctx: OperationContext) => activeVaultId() === ctx.vaultId && get().contextVaultId === ctx.vaultId && get().activeThemeId === ctx.themeId;
  const capture = (): OperationContext => {
    const vaultId = activeVaultId();
    const themeId = get().activeThemeId;
    if (!vaultId || get().contextVaultId !== vaultId || !themeId) throw new Error(i18n.t('knowledge:store.selectThemeRequired'));
    return { vaultId, themeId, key: JSON.stringify([vaultId, themeId]), fs: themeKbFs(vaultId, themeId) };
  };
  const snapshot = (): Partial<KnowledgeState> => Object.fromEntries(Object.keys(initialSession).map((key) => [key, get()[key as keyof KnowledgeState]]));
  const getFor = (ctx: OperationContext): KnowledgeState => isCurrent(ctx) ? get() : { ...get(), ...initialSession, ...sessions.get(ctx.key) };
  const commit = (ctx: OperationContext, update: Partial<KnowledgeState> | ((state: KnowledgeState) => Partial<KnowledgeState>)) => {
    const patch = typeof update === 'function' ? update(getFor(ctx)) : update;
    if (isCurrent(ctx)) set(patch);
    else sessions.set(ctx.key, { ...initialSession, ...sessions.get(ctx.key), ...patch });
  };
  const beginMutation = (ctx: OperationContext): boolean => {
    if (getFor(ctx).buildRunning || mutations.has(ctx.key)) return false;
    mutations.add(ctx.key); commit(ctx, { mutationRunning: true }); return true;
  };
  const endMutation = (ctx: OperationContext) => { mutations.delete(ctx.key); commit(ctx, { mutationRunning: false }); };
  const hydrate = async (ctx: OperationContext) => {
    const version = (hydrationVersions.get(ctx.key) ?? 0) + 1;
    hydrationVersions.set(ctx.key, version);
    const result = await Promise.all([readManifest(ctx.fs), readReviews(ctx.fs), readNavigation(ctx.fs)]).catch((error: unknown) => {
      if (hydrationVersions.get(ctx.key) !== version) return null;
      throw error;
    });
    if (!result) return;
    const [manifest, reviews, nav] = result;
    if (hydrationVersions.get(ctx.key) !== version) return;
    if (!manifest) throw new Error(i18n.t('knowledge:store.manifestUnreadable'));
    commit(ctx, (state) => ({ loaded: true, dataVersion: state.dataVersion + 1,
      goal: manifest?.goal ?? '', scope: manifest?.scope ?? [], language: manifest?.language ?? 'auto',
      topics: manifest ? Object.entries(manifest.topics).map(([tpId, topic]) => ({ tpId, title: topic.title, path: topic.path })) : [],
      sources: manifest?.sources ?? {}, navigation: nav.topics, reviews,
    }));
  };
  return {
    ...initialSession as KnowledgeState,
    themes: [], activeThemeId: null, contextVaultId: null,
    openSourceSettings: (sourceEntry) => set({ sourceEntry, page: 'sources' }),
    closeSourceSettings: () => set({ sourceEntry: 'closed' }),
    createTheme: async ({ name, goal, scope, language }) => {
      const vaultId = activeVaultId();
      if (!vaultId) return { ok: false, error: i18n.t('knowledge:store.openVaultFirst') };
      if (!name.trim() || !goal.trim()) return { ok: false, error: i18n.t('knowledge:store.nameAndGoalRequired') };
      const id = `theme-${generateShortId()}`;
      try {
        await writeManifest(themeKbFs(vaultId, id), { goal: goal.trim(), scope: [...scope], language: language ?? 'auto', sources: {}, topics: {} });
        const registry = await updateThemeRegistry(vaultId, (value) => { value.themes.push({ id, name: name.trim() }); value.activeThemeId = id; });
        if (activeVaultId() !== vaultId) return { ok: false, error: i18n.t('knowledge:store.vaultSwitched') };
        registryVersion += 1;
        if (get().contextVaultId !== vaultId) {
          if (get().activeThemeId && get().contextVaultId) sessions.set(JSON.stringify([get().contextVaultId, get().activeThemeId]), snapshot());
          set({ ...initialSession, activeThemeId: null, contextVaultId: vaultId });
        }
        set({ themes: registry.themes });
        await get().selectTheme(id);
        return { ok: true };
      } catch (error) { return { ok: false, error: i18n.t('knowledge:store.createThemeFailed', { error: errText(error) }) }; }
    },
    selectTheme: async (id) => {
      const vaultId = activeVaultId();
      if (!vaultId || !get().themes.some((theme) => theme.id === id)) return;
      const request = ++selectionRequest;
      if (get().activeThemeId && get().contextVaultId) sessions.set(JSON.stringify([get().contextVaultId, get().activeThemeId]), snapshot());
      const key = JSON.stringify([vaultId, id]);
      set({ ...initialSession, ...sessions.get(key), activeThemeId: id, contextVaultId: vaultId, loaded: false });
      const ctx = capture();
      try {
        await hydrate(ctx);
        if (request !== selectionRequest || !isCurrent(ctx)) return;
        await updateThemeRegistry(vaultId, (registry) => { registry.activeThemeId = id; });
      } catch (error) { commit(ctx, { loaded: true, buildError: i18n.t('knowledge:store.readThemeFailed', { error: errText(error) }) }); }
    },
    loadFromManifest: async () => {
      const vaultId = activeVaultId();
      if (!vaultId) { set({ ...initialSession, themes: [], activeThemeId: null, contextVaultId: null, loaded: true }); return; }
      if (get().contextVaultId !== vaultId) {
        if (get().activeThemeId && get().contextVaultId) sessions.set(JSON.stringify([get().contextVaultId, get().activeThemeId]), snapshot());
        set({ ...initialSession, themes: [], activeThemeId: null, contextVaultId: vaultId });
      }
      const version = ++registryVersion;
      try {
        const registry = await readThemeRegistry(vaultKbFs(vaultId));
        if (activeVaultId() !== vaultId || get().contextVaultId !== vaultId || version !== registryVersion) return;
        set({ themes: registry.themes });
        if (get().activeThemeId) await hydrate(capture());
        else if (registry.activeThemeId ?? registry.themes[0]?.id) await get().selectTheme(registry.activeThemeId ?? registry.themes[0]!.id);
        else set({ loaded: true, buildError: '' });
      } catch (error) { if (activeVaultId() === vaultId && version === registryVersion) set({ loaded: true, buildError: i18n.t('knowledge:store.readThemesFailed', { error: errText(error) }) }); }
    },
  reconcileTopicEdits: async (paths) => {
    let ctx: OperationContext;
    try { ctx = capture(); } catch { return; }
    if (!beginMutation(ctx)) return;
    try {
      const { reconcileTopicEdit } = await import('@/services/knowledge/kbIntentWatch');
      let changed = false;
      for (const path of paths) {
        if (!path.startsWith(`${ctx.fs.root}/topics/`)) continue;
        const result = await reconcileTopicEdit(ctx.fs, path);
        changed = result.changed || changed;
      }
      if (changed) { invalidateKbIndexCache(); await hydrate(ctx); }
    } catch (error) { commit(ctx, { refNotice: i18n.t('knowledge:store.reconcileFailed', { error: errText(error) }) }); }
    finally { endMutation(ctx); }
  },
  setPage: (page) => set({ page }),
  setActiveTopic: (tpId) => set({ activeTpId: tpId, page: tpId ? 'knowledge' : get().page }),

  saveConfig: async ({ goal, scope, name, language }) => {
    let ctx: OperationContext;
    try { ctx = capture(); } catch (error) { return { ok: false, error: errText(error) }; }
    if (getFor(ctx).buildRunning || mutations.has(ctx.key)) return { ok: false, error: i18n.t('knowledge:store.writeInProgress') };
    if (name !== undefined && !name.trim()) return { ok: false, error: i18n.t('knowledge:store.nameRequired') };
    if (!beginMutation(ctx)) return { ok: false, error: i18n.t('knowledge:store.writeInProgressRetry') };
    try {
      const manifest = await readManifest(ctx.fs);
      if (!manifest) throw new Error(i18n.t('knowledge:store.configMissing'));
      manifest.goal = goal; manifest.scope = [...scope];
      if (language !== undefined) manifest.language = language;
      await writeManifest(ctx.fs, manifest);
      if (name !== undefined) {
        const registry = await updateThemeRegistry(ctx.vaultId, (value) => {
          const theme = value.themes.find((theme) => theme.id === ctx.themeId);
          if (!theme) throw new Error(i18n.t('knowledge:store.themeMissing'));
          theme.name = name.trim();
        });
        if (activeVaultId() === ctx.vaultId && get().contextVaultId === ctx.vaultId) set({ themes: registry.themes });
      }
      await hydrate(ctx);
      commit(ctx, { goal, scope: [...scope], ...(language !== undefined ? { language } : {}), buildError: '' });
      if (!isCurrent(ctx)) return { ok: false, error: i18n.t('knowledge:store.themeSwitchedSaved') };
      return { ok: true };
    } catch (error) { return { ok: false, error: i18n.t('knowledge:store.saveConfigFailed', { error: errText(error) }) }; }
    finally { endMutation(ctx); }
  },

  build: async (only) => {
    let ctx: OperationContext;
    try { ctx = capture(); } catch { return; }
    if (getFor(ctx).buildRunning) return;
    if (mutations.has(ctx.key)) { commit(ctx, { buildError: i18n.t('knowledge:store.buildWhileSaving') }); return; }
    const { goal, scope } = get();
    if (scope.length === 0 && !only) {
      commit(ctx, { buildItems: [], buildCurrentIndex: -1 });
      return;
    }
    commit(ctx, { buildRunning: true, cancelBuild: false, buildItems: [], buildCurrentIndex: -1, buildError: '', buildDetails: {} });
    // 逐项 detail：并行构建下回调显式携带资料路径（无单一「当前项」），按路径落键。
    const details: Record<string, KbBuildDetail> = {};
    const detailFor = (path: string): KbBuildDetail | null => {
      if (!path) return null;
      return details[path] ?? (details[path] = { lines: [], stream: '' });
    };
    try {
      await buildKnowledge(ctx.fs, {
        goal,
        scope,
        ...(only ? { only } : {}),
        onProgress: (items, completed) => {
          commit(ctx, { buildItems: items, buildCurrentIndex: completed });
        },
        onDetail: (line, path) => {
          const detail = detailFor(path);
          if (!detail) return;
          detail.lines.push(line);
          commit(ctx, { buildDetails: { ...details } });
        },
        onStream: (text, path) => {
          const detail = detailFor(path);
          if (!detail || !text) return;
          detail.stream = streamTailBuffer(detail.stream, text);
          commit(ctx, { buildDetails: { ...details } });
        },
        shouldCancel: () => getFor(ctx).cancelBuild,
      });
      await hydrate(ctx);
    } catch (err) {
      // 整体失败（如目录扫描/manifest 写入）；单项收录失败在 buildItems 里逐项展示。
      console.error('[KnowledgeStore] build failed:', err);
      commit(ctx, { buildError: i18n.t('knowledge:store.buildFailed', { error: errText(err) }) });
    } finally {
      commit(ctx, { buildRunning: false, buildCurrentIndex: -1 });
    }
  },

  cancelBuildRequested: () => set({ cancelBuild: true }),

  stopTracking: async (srcId) => {
    let ctx: OperationContext;
    try { ctx = capture(); } catch { return; }
    if (!beginMutation(ctx)) { commit(ctx, { reviewNotice: i18n.t('knowledge:store.writeInProgressRetry') }); return; }
    try {
    commit(ctx, { reviewNotice: '' });
    const fs = ctx.fs;
    try {
      const manifest = await readManifest(fs);
      const entry = manifest?.sources[srcId];
      if (!manifest || !entry) return;
      entry.removed = true;
      // 显式收录的文件同时移出范围；目录覆盖的文件靠 removed 标记（构建时跳过）。
      manifest.scope = manifest.scope.filter((p) => p !== entry.path);
      await writeManifest(fs, manifest);
      invalidateKbIndexCache();
      await hydrate(ctx);
    } catch (err) {
      console.error('[KnowledgeStore] stopTracking failed:', err);
      commit(ctx, { reviewNotice: i18n.t('knowledge:store.stopTrackingFailed', { error: errText(err) }) });
    }
    } finally { endMutation(ctx); }
  },

  setAskQuestion: (q) => set({ askQuestion: q }),

  ask: async () => {
    let ctx: OperationContext;
    try { ctx = capture(); } catch { return; }
    if (getFor(ctx).askRunning) return;
    const question = getFor(ctx).askQuestion.trim();
    const vaultId = activeVaultId();
    if (!question || !vaultId) return;
    const priorTurns = getFor(ctx).askTurns;
    commit(ctx, { askRunning: true, askQuestion: '', askPhase: '', cancelAsk: false });
    try {
      const result = await askKnowledge(question, ctx.fs, vaultId, {
        priorTurns,
        onProgress: (phase) => commit(ctx, { askPhase: phase }),
        shouldCancel: () => getFor(ctx).cancelAsk,
      });
      // 取消轮次也入会话：已找到的证据不丢（answer 为空、note 说明已停止）。
      commit(ctx, (state) => ({
        askTurns: [...state.askTurns, { question, answer: result.answer, evidence: result.retrieval.evidence, ...(result.retrieval.note ? { note: result.retrieval.note } : {}) }],
        askPhase: '',
      }));
    } catch (err) {
      // 失败轮与取消轮同构：answer 空 + note 说明原因（answer 非空的轮次才会注入后续上下文）。
      commit(ctx, (state) => ({ askTurns: [...state.askTurns, { question, answer: '', evidence: [], note: i18n.t('knowledge:store.askFailed', { error: errText(err) }) }], askPhase: '' }));
    } finally {
      commit(ctx, { askRunning: false, cancelAsk: false });
    }
  },

  cancelAskRequested: () => set({ cancelAsk: true }),

  /** 清空重置整个会话（含输入草稿）；取消只中断当前轮，不动这里。 */
  clearAsk: () =>
    set({ askQuestion: '', askTurns: [], askPhase: '', cancelAsk: false }),

  applyReviewItem: async (id, editedBody) => {
    let ctx: OperationContext;
    try { ctx = capture(); } catch { return; }
    if (!beginMutation(ctx)) { commit(ctx, { reviewNotice: i18n.t('knowledge:store.writeInProgressRetry') }); return; }
    try {
    const review = getFor(ctx).reviews.find((r) => r.id === id);
    if (!review) return;
    commit(ctx, { reviewNotice: '' });
    const outcome = await applyReview(
      ctx.fs,
      review,
      editedBody !== undefined ? { editedBody } : {},
    );
    if (outcome.ok) {
      invalidateKbIndexCache();
      commit(ctx, {
        reviewNotice:
          review.reason === 'restore-suggestion'
            ? i18n.t('knowledge:store.appliedRestore')
            : review.reason === 'add-ref'
              ? i18n.t('knowledge:store.appliedAddRef')
              : i18n.t('knowledge:store.appliedReview'),
      });
      await hydrate(ctx);
    } else {
      // stale / missing-page / error：不写入正文，把原因如实呈现。
      commit(ctx, { reviewNotice: outcome.message });
    }
    } finally { endMutation(ctx); }
  },

  discardReviewItem: async (id) => {
    let ctx: OperationContext;
    try { ctx = capture(); } catch { return; }
    if (!beginMutation(ctx)) { commit(ctx, { reviewNotice: i18n.t('knowledge:store.writeInProgressRetry') }); return; }
    try {
    const review = getFor(ctx).reviews.find((r) => r.id === id);
    if (!review) return;
    try {
      await discardReview(ctx.fs, review);
      commit(ctx, {
        reviewNotice:
          review.reason === 'restore-suggestion'
            ? i18n.t('knowledge:store.discardedRestore')
            : review.reason === 'add-ref'
              ? i18n.t('knowledge:store.discardedAddRef')
              : i18n.t('knowledge:store.discardedReview'),
      });
      await hydrate(ctx);
    } catch (err) {
      commit(ctx, { reviewNotice: i18n.t('knowledge:store.actionFailed', { error: errText(err) }) });
    }
    } finally { endMutation(ctx); }
  },

  verifyTopicRefItem: async (tpId, refId) => {
    let ctx: OperationContext;
    try { ctx = capture(); } catch { return; }
    if (!beginMutation(ctx)) { commit(ctx, { refNotice: i18n.t('knowledge:store.writeInProgressRetry') }); return; }
    try {
    commit(ctx, { refNotice: '', verifyingRefId: refId });
    const fs = ctx.fs;
    try {
      const manifest = await readManifest(fs);
      const refs = await readTopicRefs(fs, tpId);
      const ref = refs.find((r) => r.id === refId);
      const topicPath = manifest?.topics[tpId]?.path;
      if (!ref || !topicPath) {
        commit(ctx, { refNotice: i18n.t('knowledge:store.refOrTopicMissing') });
        return;
      }
      const outcome = await verifyTopicRef(fs, ref, topicPath);
      if (outcome.ok) {
        commit(ctx, {
          refNotice: outcome.supported
            ? i18n.t('knowledge:store.verifyPassed', { reason: outcome.reason })
            : i18n.t('knowledge:store.verifyUnsupported', { reason: outcome.reason }),
        });
      } else {
        commit(ctx, { refNotice: outcome.message });
      }
      await hydrate(ctx); // dataVersion+1 → 阅读视图重读 refs
    } catch (err) {
      commit(ctx, { refNotice: i18n.t('knowledge:store.verifyFailed', { error: errText(err) }) });
    } finally {
      commit(ctx, { verifyingRefId: null });
    }
    } finally { endMutation(ctx); }
  },

  saveTopicPage: async (tpId, content) => {
    let ctx: OperationContext;
    try { ctx = capture(); } catch { return { ok: false, error: i18n.t('knowledge:store.selectThemeRequired') }; }
    if (!beginMutation(ctx)) return { ok: false, error: i18n.t('knowledge:store.writeInProgressRetry') };
    try {
      const topicPath = (await readManifest(ctx.fs))?.topics[tpId]?.path;
      if (!topicPath) return { ok: false, error: i18n.t('knowledge:store.topicPageMissing') };
      // 用户编辑：不更新 lastProgramHash —— 页 hash 漂移触发 ADR-0006 的
      // user-edited 降级（AI 追加内容进审阅），这是有意保持的语义。
      suppressWatcherFor(topicPath);
      await kbWriteAtomic(ctx.fs, topicPath, content);
      invalidateKbIndexCache();
      await hydrate(ctx); // dataVersion+1 → 阅读视图重读正文与引用
      return { ok: true };
    } catch (err) {
      return { ok: false, error: i18n.t('knowledge:store.saveTopicFailed', { error: errText(err) }) };
    } finally { endMutation(ctx); }
  },
  };
});
