import { create } from 'zustand';
import { useVaultStore } from './vaultStore';
import {
  parseStudy,
  serializeStudy,
} from '@/study/markdown';
import {
  STUDY_DIR,
  slugifyTopic,
  buildEmptyStudyDoc,
  studyDocPath,
  extractSlug,
  type StudyTopicEntry,
} from '@/study/studyDoc';
import { dateToString } from '@/schedule/dailyScan';
import { isDue } from '@/study/sm2';
import type { ParsedStudy, ReviewAtom } from '@/study/types';

/** 跨主题今日复习队列项（交错练习）：atom + 来源主题 slug/path（写回定位）。 */
export interface DueAtomEntry {
  atom: ReviewAtom;
  topicSlug: string;
  topicPath: string;
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

  refresh: () => Promise<void>;
  selectTopic: (slug: string) => void;
  createTopic: (title: string) => Promise<string | null>;
  deleteTopic: (slug: string) => Promise<void>;
  /** 把改动后的 ParsedStudy 序列化回写对应主题文档（PR3 勾选/评级用）。 */
  saveTopic: (parsed: ParsedStudy) => Promise<void>;
  /**
   * 对指定主题（可非当前激活）的复习原子做就地更新并回写。
   * 跨主题"今日复习"队列评级用：避免依赖 activeSlug，直接按 slug 定位主题文档。
   * 返回更新后的 ParsedStudy（供调用方刷新本地视图），失败返回 null。
   */
  rateAtomInTopic: (slug: string, atomId: string, next: ReviewAtom) => Promise<ParsedStudy | null>;
}

export const useStudyStore = create<StudyState>((set, get) => ({
  topics: [],
  activeSlug: null,
  loading: false,
  error: null,

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
}));

/** 文件树变化时触发外部刷新（对标 scheduleStore.subscribeToFileTree，debounce 由调用方做）。 */
export function subscribeToFileTree(cb: () => void): () => void {
  let prev = useVaultStore.getState().fileTree;
  return useVaultStore.subscribe((state) => {
    if (state.fileTree !== prev) {
      prev = state.fileTree;
      cb();
    }
  });
}
