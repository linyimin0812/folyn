// 学习主题文档的数据模型。一个主题 = vault 里的 `学习/<主题>.md`，用
// front-matter + 四个托管段（`## 资料` / `## 计划` / `## 复习`，以及非托管
// 的 `## 笔记`）承载结构化数据。详见 markdown.ts 的解析/序列化约定。

/** 资料条目类型（`## 资料` 段内 `- @book` / `- @web` 行） */
export type MaterialKind = 'book' | 'web';

/** 书目难度（仅 book） */
export type Difficulty = 'easy' | 'medium' | 'hard';

/** `## 资料` 段的一条资料 */
export interface StudyMaterial {
  /** 稳定 id = `<slug>#materials-<lineIndex>` */
  id: string;
  kind: MaterialKind;
  title: string;
  /** 书作者（仅 book） */
  author?: string;
  /** 简介 */
  summary?: string;
  /** 难度（仅 book） */
  difficulty?: Difficulty;
  /** 链接 */
  url?: string;
  /** 在源文件中的行号，用于写回定位 */
  lineIndex: number;
}

/** `## 计划` 段的一个学习单元（`- [ ] N. 单元名 @{est:.. dep:.. prog:..}` 行） */
export interface StudyUnit {
  /** 稳定 id = `<slug>#units-<lineIndex>` */
  id: string;
  /** 序号（行内 `N.`） */
  order: number;
  title: string;
  /** 是否完成（checkbox `[x]`） */
  done: boolean;
  /** 估时（如 "2h"） */
  est?: string;
  /** 依赖序号；`-` 表示无依赖 */
  dep?: string;
  /** 进度 0-100 */
  prog: number;
  /** 在源文件中的行号，用于写回定位 */
  lineIndex: number;
}

/** `## 复习` 段的一个复习原子（SM-2 调度） */
export interface ReviewAtom {
  /** 稳定 id = `<slug>#review-<lineIndex>` */
  id: string;
  /** 摘要 */
  summary: string;
  /** 是否完成（checkbox `[x]`，表示今日已复习） */
  done: boolean;
  /** 到期日 YYYY-MM-DD */
  next: string;
  /** 连续正确次数 */
  rep: number;
  /** ease factor，下限 1.3 */
  ef: number;
  /** 上次间隔（天） */
  ivl: number;
  /** lapse 次数 */
  lapses: number;
  /** 来源主题 slug（跨主题今日复习队列标注） */
  topic?: string;
  /** 关联子文档 wiki 链接 `[[..]]` */
  src?: string;
  /** 在源文件中的行号，用于写回定位 */
  lineIndex: number;
}

/** 主题文档 front-matter（仅解析常用键；未识别键原样保留在 rawLines 中） */
export interface StudyFrontmatter {
  title?: string;
  slug?: string;
  created?: string;
}

/** 一个主题文档解析后的结构 */
export interface ParsedStudy {
  /** 完整文件按行切分（含未托管行 / front-matter / 散文，写回时原样保留） */
  rawLines: string[];
  /** front-matter 常用键 */
  frontmatter: StudyFrontmatter;
  /** `## 资料` 段的托管条目 */
  materials: StudyMaterial[];
  /** `## 计划` 段的托管学习单元 */
  units: StudyUnit[];
  /** `## 复习` 段的托管复习原子 */
  reviewAtoms: ReviewAtom[];
}

/** SM-2 评级（UI 4 按钮） */
export type ReviewRating = 'again' | 'hard' | 'good' | 'easy';

/** 学习工作台 AI 动作（5 个，走现有 AI 面板，无新调用链） */
export type AiAction = 'research' | 'plan' | 'feynman' | 'selftest' | 'sq3r';

/** SM-2 调度器输入状态 */
export interface Sm2State {
  rep: number;
  ef: number;
  ivl: number;
  lapses: number;
}

/** SM-2 调度器输出（含新到期日） */
export interface Sm2Result extends Sm2State {
  /** 新到期日 YYYY-MM-DD */
  next: string;
}

/** 难度标签 ↔ 枚举 */
export const DIFFICULTY_LABEL: Record<Difficulty, string> = {
  easy: '易',
  medium: '中',
  hard: '难',
};

/** 复习原子属性缺省值（新建时） */
export const DEFAULT_REVIEW_ATOM: Pick<ReviewAtom, 'rep' | 'ef' | 'ivl' | 'lapses'> = {
  rep: 0,
  ef: 2.5,
  ivl: 1,
  lapses: 0,
};
