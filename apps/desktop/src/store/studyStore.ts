import { create } from 'zustand';
import { useVaultStore } from './vaultStore';
import { useScheduleStore } from './scheduleStore';
import { useSettingsStore } from './settingsStore';
import {
  parseStudy,
  serializeStudy,
  scanMaterialSuggestions,
  scanUnitSuggestions,
} from '@/features/study/markdown';
import {
  STUDY_DIR,
  slugifyTopic,
  buildEmptyStudyDoc,
  studyDocPath,
  extractSlug,
  type StudyTopicEntry,
} from '@/features/study/studyDoc';
import {
  buildStudyTaskLine,
  appendTaskLineToDaily,
  collectScheduleLinks,
  type ScheduleLink,
} from '@/features/study/scheduleLink';
import { dateToString } from '@/features/schedule/dailyScan';
import { isDue } from '@/features/study/sm2';
import type { ParsedStudy, ReviewAtom, StudyUnit, StudyMaterial } from '@/features/study/types';

/** 跨主题今日复习队列项（交错练习）：atom + 来源主题 slug/path（写回定位）。 */
export interface DueAtomEntry {
  atom: ReviewAtom;
  topicSlug: string;
  topicPath: string;
}

/** AI research/plan 动作的待捕获状态：动作发起后置位，待聊天产出后扫描清零。 */
export interface PendingSuggestion {
  kind: 'research' | 'plan';
  slug: string;
}

/** 复用 markdown.ts 的扫描器把 AI 聊天文本解析为建议项（纯函数，便于单测）。 */
export function parseSuggestionText(
  text: string,
  kind: 'research' | 'plan',
  slug: string,
): StudyMaterial[] | StudyUnit[] {
  return kind === 'research'
    ? scanMaterialSuggestions(text, slug)
    : scanUnitSuggestions(text, slug);
}

/**
 * 资料去重键：优先用 url，否则用 title，统一小写。空标题/空链接返回空串
 * （调用方按"已见过"处理，避免空资料重复落入 `## 资料`）。纯函数，便于单测。
 */
export function materialDedupeKey(m: { url?: string; title: string }): string {
  const key = (m.url?.trim() || m.title.trim()).toLowerCase();
  return key;
}

/**
 * 聚合所有主题里到期的复习原子（交错练习队列）。纯函数，便于单测。
 * today 由调用方传入（避免读系统时钟、便于测试）。每条带 topic 来源标注。
 */
export function collectDueAtoms(
  topics: StudyTopicEntry[],
  today: string,
): DueAtomEntry[] {
  const out: DueAtomEntry[] = [];
  for (const t of topics) {
    for (const atom of t.parsed.reviewAtoms) {
      if (isDue(atom.next, today)) {
        out.push({ atom, topicSlug: t.slug, topicPath: t.path });
      }
    }
  }
  return out;
}

interface StudyState {
  /** 扫描 `学习/` 得到的所有主题（按 slug 索引稳定 id）。 */
  topics: StudyTopicEntry[];
  /** 当前聚焦主题的 slug。 */
  activeSlug: string | null;
  loading: boolean;
  error: string | null;

  /** AI plan 动作返回的学习单元建议（research 不再产卡片，自动写盘）。 */
  suggestedUnits: StudyUnit[];
  /** 当前等待 AI 产出文本建议的动作（research/plan）；扫描到产出后清零。 */
  pendingSuggestion: PendingSuggestion | null;

  refresh: () => Promise<void>;
  selectTopic: (slug: string) => void;
  createTopic: (title: string) => Promise<string | null>;
  deleteTopic: (slug: string) => Promise<void>;
  /** 把改动后的 ParsedStudy 序列化回写对应主题文档（PR3 勾选/评级用）。 */
  saveTopic: (parsed: ParsedStudy) => Promise<void>;
  /**
   * 对指定主题的 materials/units/reviewAtoms 做增量编辑（增/改/删）并回写。
   * 关键修复：以 topics 缓存里的原始 parsed（含全部原 lineIndex）作为
   * serializeStudy 第一参数，传入新数组（filter/map 后）作为后续参数，
   * 使被删除的托管行（原 lineIndex 不在新数组中）被正确移除。
   * 未传的维度沿用 originalParsed 的原数组（不改写）。
   */
  saveTopicEdits: (
    slug: string,
    edits: { materials?: StudyMaterial[]; units?: StudyUnit[]; reviewAtoms?: ReviewAtom[] },
  ) => Promise<void>;
  /** 发起 research/plan 建议：置 pendingSuggestion、清空对应建议列表。 */
  beginSuggestion: (kind: 'research' | 'plan', slug: string) => void;
  /**
   * AI 产出后扫描聊天文本：
   * - research：解析资料后**自动追加**到主题 `## 资料` 段（去重，不产建议卡片）
   *   ——用户诉求"找好资料后自动更新，不要询问"。
   * - plan：解析为 `suggestedUnits` 建议卡片（计划仍需人工取舍）。
   * 任一分支结束后清 pendingSuggestion（无产出也清零）。
   */
  consumeSuggestion: (text: string) => Promise<void>;
  /** 清空建议列表（切换主题/取消时）。 */
  clearSuggestions: () => void;
  /**
   * 把 research 产出的资料建议去重后追加到主题 `## 资料` 段并回写。
   * 去重键：`(url || title)` 小写；与已有资料重复则跳过。无主题/无新增则 no-op。
   * 由 `consumeSuggestion` research 分支调用，取代旧的逐条 accept 流程。
   */
  autoApplyMaterialSuggestions: (slug: string, suggestions: StudyMaterial[]) => Promise<void>;
  /** 接受一条单元建议：序号重排为 max+1 后追加到 `## 计划` 段，并从建议列表移除。 */
  acceptUnitSuggestion: (slug: string, unit: StudyUnit) => Promise<void>;
  /** 忽略一条单元建议。 */
  dismissUnitSuggestion: (id: string) => void;
  /**
   * 对指定主题（可非当前激活）的复习原子做就地更新并回写。
   * 跨主题"今日复习"队列评级用：避免依赖 activeSlug，直接按 slug 定位主题文档。
   * 返回更新后的 ParsedStudy（供调用方刷新本地视图），失败返回 null。
   */
  rateAtomInTopic: (slug: string, atomId: string, next: ReviewAtom) => Promise<ParsedStudy | null>;
  /**
   * 把一个学习单元排到目标日期的 daily note `## 任务` 段（单向排期 + 回链）。
   * study 侧直写任务行（不经 scheduleStore.addTask），回链属性 study:<slug> unit:<n>
   * 由 schedule/markdown.ts 的 extraAttrs 透传机制在后续 schedule 写回中保留。
   * noteDate 默认今天。写后刷新 scheduleStore 任务缓存与文件树。
   */
  scheduleUnitToToday: (unit: StudyUnit, slug: string, noteDate?: string) => Promise<void>;
  /**
   * 扫描 schedule 已解析任务中带 `study:<slug>` 回链的条目，返回各单元的
   * 排期/完成状态（只读单向读回）。基于 scheduleStore.tasks 缓存（已扫描 daily note）。
   */
  scanScheduleLinks: (slug: string) => Map<number, ScheduleLink>;
}

export const useStudyStore = create<StudyState>((set, get) => ({
  topics: [],
  activeSlug: null,
  loading: false,
  error: null,
  suggestedUnits: [],
  pendingSuggestion: null,

  refresh: async () => {
    const vault = useVaultStore.getState();
    set({ loading: true, error: null });
    const entries: StudyTopicEntry[] = [];
    try {
      // 直接列 `学习/` 目录，绕过 excludePatterns（与 scheduleStore.refresh 同策略），
      // 避免用户把 `学习` 加入排除后扫描得空集、随后的写入把缓存冲掉。
      const files = await vault.manager.listFiles(STUDY_DIR, false);
      for (const entry of files) {
        if (entry.type !== 'file' || !entry.name.endsWith('.md')) continue;
        const stem = entry.name.slice(0, -3);
        try {
          const content = await vault.readFile(entry.path);
          // slug 优先取 front-matter，缺失回退文件名 stem，避免 id 漂移。
          const slug = extractSlug(content, stem);
          const parsed = parseStudy(content, slug);
          entries.push({ slug, path: entry.path, parsed });
        } catch {
          // 跳过不可读文件
        }
      }
    } catch {
      // 目录尚不存在 → 空状态
    }
    // 保持 activeSlug：若旧选中主题仍在列表中则保留，否则回退首个。
    const prevSlug = get().activeSlug;
    const stillExists = entries.some((t) => t.slug === prevSlug);
    const nextActive = stillExists ? prevSlug : entries[0]?.slug ?? null;
    set({ topics: entries, activeSlug: nextActive, loading: false });
  },

  selectTopic: (slug) => set({ activeSlug: slug }),

  createTopic: async (title) => {
    const vault = useVaultStore.getState();
    const trimmed = title.trim();
    if (!trimmed) return null;
    const baseSlug = slugifyTopic(trimmed);
    // 列出已有文件名，重名追加后缀（slug 与文件名 stem 保持一致，杜绝漂移）。
    let slug = baseSlug;
    try {
      const files = await vault.manager.listFiles(STUDY_DIR, false);
      const names = new Set(files.filter((e) => e.type === 'file').map((e) => e.name));
      let n = 2;
      while (names.has(`${slug}.md`)) {
        slug = `${baseSlug}-${n}`;
        n += 1;
      }
    } catch {
      // 目录尚不存在 → 不必去重
    }
    try {
      await vault.createDir(STUDY_DIR);
    } catch {
      // 目录可能已存在
    }
    const path = studyDocPath(slug);
    const content = buildEmptyStudyDoc(trimmed, slug, dateToString(new Date()));
    await vault.createFile(path, content);
    useVaultStore.getState().refreshFileTree().catch(() => {});
    await get().refresh();
    set({ activeSlug: slug });
    return slug;
  },

  deleteTopic: async (slug) => {
    const vault = useVaultStore.getState();
    const target = get().topics.find((t) => t.slug === slug);
    if (!target) return;
    try {
      await vault.deleteFile(target.path);
    } catch {
      // 文件可能已被外部删除
    }
    useVaultStore.getState().refreshFileTree().catch(() => {});
    await get().refresh();
  },

  saveTopic: async (parsed) => {
    const vault = useVaultStore.getState();
    const slug = parsed.frontmatter.slug;
    if (!slug) return;
    // 优先查表拿真实路径（兼容用户改文件名后的漂移）；缺失则按 slug 推导。
    const entry = get().topics.find((t) => t.slug === slug);
    const path = entry?.path ?? studyDocPath(slug);
    const out = serializeStudy(parsed, parsed.materials, parsed.units, parsed.reviewAtoms);
    await vault.writeFile(path, out);
    useVaultStore.getState().refreshFileTree().catch(() => {});
    // 更新缓存中该主题的解析结果（lineIndex 与磁盘一致），避免下次 refresh 前的漂移。
    set((s) => ({
      topics: s.topics.map((t) =>
        t.slug === slug ? { ...t, parsed: parseStudy(out, slug) } : t,
      ),
    }));
  },

  saveTopicEdits: async (slug, edits) => {
    const target = get().topics.find((t) => t.slug === slug);
    if (!target) return;
    const original = target.parsed;
    const materials = edits.materials ?? original.materials;
    const units = edits.units ?? original.units;
    const reviewAtoms = edits.reviewAtoms ?? original.reviewAtoms;
    // 以 original（含全部原 lineIndex）为第一参数，使删除检测生效。
    const out = serializeStudy(original, materials, units, reviewAtoms);
    const path = target.path;
    await useVaultStore.getState().writeFile(path, out);
    useVaultStore.getState().refreshFileTree().catch(() => {});
    set((s) => ({
      topics: s.topics.map((t) =>
        t.slug === slug ? { ...t, parsed: parseStudy(out, slug) } : t,
      ),
    }));
  },

  beginSuggestion: (kind, slug) =>
    set(() => ({
      pendingSuggestion: { kind, slug },
      ...(kind === 'research' ? {} : { suggestedUnits: [] }),
    })),

  consumeSuggestion: async (text) => {
    const p = get().pendingSuggestion;
    if (!p) return;
    // 先清 pending，防止流式 effect 重入导致重复消费同一条消息。
    set({ pendingSuggestion: null });
    if (p.kind === 'research') {
      const suggestions = scanMaterialSuggestions(text, p.slug);
      // 自动写入 `## 资料`（去重），不再产建议卡片——用户诉求"不要询问"。
      if (suggestions.length) {
        await get().autoApplyMaterialSuggestions(p.slug, suggestions);
      }
    } else {
      const suggestions = scanUnitSuggestions(text, p.slug);
      set({ suggestedUnits: suggestions });
    }
  },

  autoApplyMaterialSuggestions: async (slug, suggestions) => {
    const target = get().topics.find((t) => t.slug === slug);
    if (!target || !suggestions.length) return;
    const existing = target.parsed.materials;
    const seen = new Set(
      existing.map((m) => materialDedupeKey(m)),
    );
    const fresh: StudyMaterial[] = [];
    for (const s of suggestions) {
      const key = materialDedupeKey(s);
      if (key && seen.has(key)) continue;
      seen.add(key);
      fresh.push({ ...s, lineIndex: -1 });
    }
    if (!fresh.length) return;
    await get().saveTopicEdits(slug, { materials: [...existing, ...fresh] });
  },

  clearSuggestions: () =>
    set({ suggestedUnits: [], pendingSuggestion: null }),

  acceptUnitSuggestion: async (slug, unit) => {
    const target = get().topics.find((t) => t.slug === slug);
    if (!target) return;
    // 序号重排为现有 max+1，避免与已有单元冲突。
    const maxOrder = target.parsed.units.reduce((mx, u) => Math.max(mx, u.order), 0);
    const newUnit = { ...unit, order: maxOrder + 1 };
    const units = [...target.parsed.units, newUnit];
    await get().saveTopicEdits(slug, { units });
    set((s) => ({
      suggestedUnits: s.suggestedUnits.filter((u) => u.id !== unit.id),
    }));
  },

  dismissUnitSuggestion: (id) =>
    set((s) => ({ suggestedUnits: s.suggestedUnits.filter((u) => u.id !== id) })),

  rateAtomInTopic: async (slug, atomId, next) => {
    const target = get().topics.find((t) => t.slug === slug);
    if (!target) return null;
    // 用 lineIndex 定位要替换的 atom（id 含 lineIndex，但写回靠 lineIndex 原地重写）。
    const reviewAtoms = target.parsed.reviewAtoms.map((a) =>
      a.id === atomId || a.lineIndex === next.lineIndex ? { ...a, ...next } : a,
    );
    const updated: ParsedStudy = {
      ...target.parsed,
      reviewAtoms,
    };
    await get().saveTopic(updated);
    return parseStudy(
      serializeStudy(updated, updated.materials, updated.units, updated.reviewAtoms),
      slug,
    );
  },

  scheduleUnitToToday: async (unit, slug, noteDate) => {
    const vault = useVaultStore.getState();
    const settings = useSettingsStore.getState();
    const dir = settings.dailyNotesDir || '__daily__';
    const date = noteDate ?? dateToString(new Date());
    const path = `${dir}/${date}.md`;
    // due 用 MM-DD（与 schedule 任务行约定一致）。
    const dueMmDd = `${date.slice(5, 7)}-${date.slice(8, 10)}`;
    const line = buildStudyTaskLine(unit, slug, dueMmDd);
    let content: string;
    try {
      content = await vault.readFile(path);
    } catch {
      // 不存在 → 用与 scheduleStore.readNoteContent 一致的最小模板新建。
      try { await vault.createDir(dir); } catch { /* 目录可能已存在 */ }
      content = `---\ntitle: "${date}"\ndate: ${date}\ntags: [daily]\n---\n\n# ${date}\n`;
    }
    const next = appendTaskLineToDaily(content, line);
    await vault.writeFile(path, next);
    useVaultStore.getState().refreshFileTree().catch(() => {});
    // 刷新 schedule 任务缓存，使回链状态可被 scanScheduleLinks 读到。
    useScheduleStore.getState().refresh().catch(() => {});
  },

  scanScheduleLinks: (slug) =>
    collectScheduleLinks(useScheduleStore.getState().tasks, slug),
}));

// subscribeToFileTree lives in vaultStore now (shared with scheduleStore).
export { subscribeToFileTree } from './vaultStore';
