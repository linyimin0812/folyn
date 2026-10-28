/**
 * 知识库（切片 A）数据类型 —— 文件真源的磁盘格式契约（ADR-0009/0011）。
 *
 * 这些接口描述 `~/.folyn/vaults/<vaultId>/__kb__/` 下各 JSON / Markdown 文件的结构。
 * 新增到已持久化 schema 的字段一律 optional（见 type-safety.md）。
 */

import type { VaultEntry } from '@folyn/vault-provider';

/** manifest.json — 知识库目标、收录范围、稳定标识注册表。 */
export interface KbManifest {
  goal: string;
  /** 用户选定的收录范围（vault 相对路径，文件或目录）。 */
  scope: string[];
  /** srcId -> 资料登记项。 */
  sources: Record<string, KbSourceEntry>;
  /** tpId -> 主题知识页登记项。 */
  topics: Record<string, KbTopicEntry>;
}

export interface KbSourceEntry {
  /** 原始资料当前位置（vault 相对路径；身份由 srcId 承载，ADR-0009）。 */
  path: string;
  /** 最近一次收录时的内容 SHA-256。 */
  currentHash: string;
  /** 索引重写次数。 */
  indexVersion: number;
  /** true = 已停止跟踪（移出收录范围或用户显式移除）：保留知识与历史引用，
   * 检索证据标记「来源已移除」（ADR-0007）。重新收录时程序清除该标记。 */
  removed?: boolean;
}

export interface KbTopicEntry {
  /** 主题页当前位置（vault 相对路径）。 */
  path: string;
  title: string;
  /** 程序最近一次写入后的页面内容 hash；null 表示尚未被程序写过。 */
  lastProgramHash: string | null;
}

/** sources/<srcId>.index.json — 资料结构索引（ADR-0005）。 */
export interface KbSourceIndex {
  srcId: string;
  path: string;
  versionHash: string;
  nodes: KbIndexNode[];
}

export interface KbIndexNode {
  title: string;
  summary: string;
  /** 1-based，含端点。 */
  startLine: number;
  endLine: number;
}

/** topics/<tpId>.refs.json — 来源引用（数组，与 ADR/PRD 布局一致）。 */
export interface KbRef {
  /** 页内引用标记 id，如 c1、c2。 */
  id: string;
  topicId: string;
  /** 原文锚文本（双保险：与行范围一起定位证据）。 */
  anchorText: string;
  /** 引用标注的知识页结论句（删除意图/引用核验的段落基线；旧记录可能缺省）。 */
  claimText?: string;
  srcId: string;
  /** 引用发生时的资料路径（快照式记录；路径移动后以 manifest 为准）。 */
  srcPath?: string;
  versionHash: string;
  startLine: number;
  endLine: number;
  /**
   * active = 正常；unverified = 引用待核验（段落被人工修改，ADR-0007）；
   * deleted = 结论被人工删除（删除意图已记录，ADR-0006）；verified /
   * unsupported = 核验结果（原文支持 / 不支持该说法）；source-removed =
   * 来源已停止跟踪（ADR-0007）。
   */
  status: 'active' | 'unverified' | 'deleted' | 'verified' | 'unsupported' | 'source-removed';
  /** 最近一次核验的理由（status 为 verified/unsupported 时存在）。 */
  verifyNote?: string;
}

/** navigation.json — 全库主题导航（ADR-0005）。 */
export interface KbNavigation {
  topics: KbNavigationTopic[];
}

export interface KbNavigationTopic {
  tpId: string;
  title: string;
  sourceIds: string[];
}

/** reviews.json — 待审阅修订（apply/discard 在 kbReviewActions）。 */
export interface KbReviewItem {
  id: string;
  topicId: string;
  topicPath: string;
  /**
   * user-edited = 目标页被人工编辑，追加内容降级进审阅（ADR-0006）；
   * restore-suggestion = 提议内容命中人工删除意图，恢复需用户确认
   * （ADR-0006「尊重人工删除意图」：新证据可形成待确认的恢复建议）；
   * add-ref = 重复佐证补引用（提议命中既有结论，但目标页被人工编辑 →
   * 降级进审阅；采用 = 只补引用标记与 refs，不改写正文，ADR-0006
   * 「重复佐证仅补充来源引用，不重复生成正文」）。
   */
  reason: 'user-edited' | 'restore-suggestion' | 'add-ref';
  /** 原本要追加的 Markdown 片段（完整主题页格式，含脚注定义行）。 */
  proposedMarkdown: string;
  /** 修订生成时目标页内容的 hash —— 采用时程序复核，页面已变化则标记需重新比较。 */
  topicHash?: string;
  /** 该修订会新增的来源引用（采用时程序重编页内 cN 标记后写入 refs.json）。 */
  refs?: KbRef[];
  createdAt: number;
  status: 'pending';
}

/** deletions.json — 人工删除意图（ADR-0006：记录删除意图，不自动恢复）。 */
export interface KbDeletionIntent {
  id: string;
  topicId: string;
  anchorText: string;
  /** 来源引用信息（命中恢复建议与「恢复」后清除意图用）。 */
  srcId?: string;
  versionHash?: string;
  createdAt: number;
}

/** 检索层输出的结构化证据（ADR-0008：检索与回答分层）。 */
export interface KbEvidence {
  kind: 'topic' | 'source';
  /** 主题页或原始资料的 vault 相对路径。 */
  path: string;
  srcId?: string;
  tpId?: string;
  title?: string;
  versionHash?: string;
  startLine?: number;
  endLine?: number;
  text: string;
  /** 状态标记（如"来源已移除"/"版本待核验"），切片 A 通常为空。 */
  status?: string;
}

/** 模型提议的主题变更（程序校验后才写入，ADR-0006）。 */
export interface KbClaimProposal {
  /** 结论正文（写入知识页的句子）。 */
  text: string;
  /** 原文锚文本。 */
  anchorText: string;
  startLine: number;
  endLine: number;
}

export interface KbSectionProposal {
  heading: string;
  body: string;
  claims: KbClaimProposal[];
}

export interface KbTopicProposal {
  title: string;
  /** new = 新建主题页；append = 补充已有主题（按 title 匹配）。 */
  mode: 'new' | 'append';
  sections: KbSectionProposal[];
}

/** expandScope 用的最小目录列举形状（vaultStore.manager 兼容）。 */
export type KbListFiles = (
  path: string,
  recursive?: boolean,
  showHidden?: boolean,
) => Promise<VaultEntry[]>;
