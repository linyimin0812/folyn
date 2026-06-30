// 学习工作台与 schedule 工作台的关联层（PRD Decision 5：单向排期 + 回链读回）。
//
// 回链属性 `study:<slug>` / `unit:<order>` 寄居在 daily note 任务行的属性块中，
// 属于 schedule/markdown.ts 的"未知属性"——由其 extraAttrs 透传机制原样保留，
// 保证 schedule 侧对任务行的任何写回（勾选/移动/排程）不会丢弃学习回链。
//
// 本模块只做：
// 1. 拼装学习单元对应的任务行文本（study 侧直写 daily note，不经过 scheduleStore.addTask，
//    以完全控制回链属性格式）。
// 2. 把任务行追加到 daily note 的 `## 任务` 段尾（段不存在则新建），原样保留非托管行。
// 3. 从 schedule 已解析任务中按 slug 收集回链状态（due/done/noteDate），供计划区只读展示。
// 4. AI 动作的可用性判断与"打开 AI 面板 + 预填提示词"统一入口（无新调用链）。

import type { ScheduleTask } from '@/schedule/types';
import type { StudyUnit, AiAction } from './types';
import { CliAdapterRegistry } from '@quill/cli-adapter';
import { useAiStore } from '@/store/aiStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useEditorStore } from '@/store/editorStore';

const H2_RE = /^##\s+(.+?)\s*#*\s*$/;
const SECTION_TASK = '任务';

/** 一个学习单元在某 daily note 上的排期回链状态（只读）。 */
export interface ScheduleLink {
  /** 学习单元序号（任务行 unit:<n>） */
  unit: number;
  /** 截止日 MM-DD（来自 due） */
  due?: string;
  /** schedule 侧是否已勾选完成 */
  done: boolean;
  /** 所属 daily note 日期 YYYY-MM-DD */
  noteDate: string;
}

/**
 * 拼装学习单元写入 daily note `## 任务` 段的任务行。
 * 格式（PRD Decision 5）：`- [ ] <单元名> @{col:todo cat:learn study:<slug> unit:<order> due:<MM-DD> prog:0}`
 */
export function buildStudyTaskLine(unit: StudyUnit, slug: string, dueMmDd: string): string {
  const attrs = [
    'col:todo',
    'cat:learn',
    `study:${slug}`,
    `unit:${unit.order}`,
    `due:${dueMmDd}`,
    'prog:0',
  ];
  return `- [ ] ${unit.title} @{${attrs.join(' ')}}`;
}

/**
 * 把一行任务追加到 daily note 的 `## 任务` 段尾；段不存在则在文件末尾新建。
 * 原样保留既有行（含散文、其它段、未托管复选框），仅插入。
 */
export function appendTaskLineToDaily(content: string, line: string): string {
  const lines = content.split('\n');
  let end = lines.length;
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    const m = H2_RE.exec(lines[i]);
    if (m && m[1].trim() === SECTION_TASK) {
      start = i;
      end = lines.length;
      for (let j = i + 1; j < lines.length; j++) {
        if (H2_RE.test(lines[j])) { end = j; break; }
      }
      break;
    }
  }
  if (start < 0) {
    if (lines.length && lines[lines.length - 1].trim() !== '') lines.push('');
    lines.push(`## ${SECTION_TASK}`);
    lines.push(line);
    return lines.join('\n');
  }
  // 段尾回退掉尾部空行，再追加，保持段内紧凑
  let insertAt = end;
  while (insertAt - 1 > start && lines[insertAt - 1].trim() === '') insertAt -= 1;
  lines.splice(insertAt, 0, line);
  return lines.join('\n');
}

/**
 * 从 schedule 已解析任务中按 slug 收集回链状态。
 * 同一单元若被排到多日，取最近一条（按 noteDate 降序）。
 * 纯函数，便于单测；today 不参与（仅做聚合，到期展示交给调用方）。
 */
export function collectScheduleLinks(tasks: ScheduleTask[], slug: string): Map<number, ScheduleLink> {
  const matched = tasks.filter((t) => t.extraAttrs?.study === slug);
  // 按 unit 分组，每组取 noteDate 最大的一条
  const byUnit = new Map<number, ScheduleTask[]>();
  for (const t of matched) {
    const unitStr = t.extraAttrs?.unit;
    const unit = unitStr ? parseInt(unitStr, 10) : NaN;
    if (!Number.isFinite(unit)) continue;
    const arr = byUnit.get(unit) ?? [];
    arr.push(t);
    byUnit.set(unit, arr);
  }
  const out = new Map<number, ScheduleLink>();
  for (const [unit, arr] of byUnit) {
    arr.sort((a, b) => (a.noteDate < b.noteDate ? 1 : a.noteDate > b.noteDate ? -1 : 0));
    const t = arr[0];
    out.set(unit, {
      unit,
      due: t.due,
      done: t.done,
      noteDate: t.noteDate,
    });
  }
  return out;
}

/**
 * 判断 AI 适配器是否可用（容错降级入口）。
 * 判定：settings.cliAdapter 非空且在 CliAdapterRegistry 中已注册。
 * 未配置时 AI 动作按钮禁用并提示，复习/计划/笔记非 AI 部分仍可用。
 */
export function isAiAvailable(): boolean {
  const id = useSettingsStore.getState().cliAdapter;
  if (!id) return false;
  try {
    return CliAdapterRegistry.getInstance().getAll().some((a) => a.id === id);
  } catch {
    return false;
  }
}

/**
 * 构造各 AI 动作的预填提示词（PR5：让 AI 用 Edit 工具直接编辑主题 .md 文件，
 * 而非在聊天产出供粘贴）。topicName 为人类可读主题标题，topicPath 为 vault 相对
 * 路径（如 `学习/<slug>.md`，与 Claude adapter 的 workingDir=vault 根对齐）。
 *
 * 复用既有 AI 文件编辑+diff 审阅基础设施：
 * - openStudyAiAction 已 addFileToChat 把该文件挂进上下文（ChatInput → AiPanel.handleSend
 *   会生成"请先使用 Read 工具读取以下文件"指令），AI 因此能 Read 该路径；
 * - 提示词显式要求 AI 用 Edit 工具改对应段，fileChange 事件经 aiStore.addFileChange →
 *   enterDiffReview 进 DiffView 审阅；用户接受 → 文件已是新内容，拒绝 → 回写 oldContent；
 * - AiPanel 的 done 事件触发 vaultStore.refreshFileTree → studyStore.subscribeToFileTree
 *   防抖 300ms → refresh，工作台自动重新解析并刷新缓存。
 */
export function buildStudyPrompt(
  action: AiAction,
  ctx: { topicName: string; topicPath: string; unitTitle?: string; materialTitle?: string; materialUrl?: string },
): string {
  const { topicName, topicPath, unitTitle, materialTitle, materialUrl } = ctx;
  switch (action) {
    case 'research':
      return [
        `你是学习规划专家。基于主题「${topicName}」（见附件文件 ${topicPath}），`,
        `检索高质量学习资料（网络文章/文档）与经典书籍/论文。`,
        `请用 Edit 工具直接编辑文件 \`${topicPath}\` 的 \`## 资料\` 段：`,
        `只在段尾追加新行，不要删除或改写已有行；若该段不存在，在文件末尾新建 \`## 资料\` 段。`,
        `每条资料必须严格单行，格式（\`|\` 两侧留空格，难度用 易/中/难，链接为可访问 URL）：`,
        `- @book <书名> | <作者> | <简介> | 难度:<易|中|难> | <链接>`,
        `- @web <标题> | <链接> | <简介>`,
        `编辑完成后，在聊天里简要说明你追加了哪些资料即可，不要输出整段清单。`,
      ].join('\n');
    case 'feynman':
      return [
        `扮演一个 5 岁小孩，听我用大白话讲「${topicName}」${unitTitle ? `的「${unitTitle}」` : ''}（见附件文件 ${topicPath}）。`,
        `我会先讲，你哪里听不懂就一次只追问一个问题，直到我讲清或暴露知识盲区。`,
        `当暴露盲区时，请用 Edit 工具直接编辑文件 \`${topicPath}\` 的 \`## 笔记\` 段：`,
        `只在段尾追加一个 callout 块记录盲区，不要改写已有内容；若 \`## 笔记\` 段不存在，在文件末尾新建。`,
        `块格式（前后各一空行）：`,
        `:::callout{type="warning" title="盲区"}`,
        `<用一句话描述这个知识盲区>`,
        `:::`,
        `一次暴露多个盲区时，可追加多个块。`,
      ].join('\n');
    case 'selftest':
      return [
        `先读取附件文件 \`${topicPath}\` 的 \`## 笔记\` 段内容，根据其中要点为「${topicName}」生成 5 道回忆题，考查主动检索。`,
        `然后用 Edit 工具直接编辑文件 \`${topicPath}\` 的 \`## 笔记\` 段：`,
        `只在段尾追加一个 callout 块，先列题目、再用 <details> 折叠每题答案；不要改写已有内容。`,
        `块格式（前后各一空行）：`,
        `:::callout{type="tip" title="自测题"}`,
        `1. <题目>`,
        `<details><summary>答案</summary>答案…</details>`,
        `:::`,
      ].join('\n');
    case 'sq3r':
      return [
        `对这条资料做 SQ3R 预读：${materialTitle ? `「${materialTitle}」` : ''}${materialUrl ? `（${materialUrl}）` : ''}。`,
        `先给 survey（大纲），再为每部分给一个预读问题。`,
        `然后用 Edit 工具直接编辑附件文件 \`${topicPath}\` 的 \`## 笔记\` 段：`,
        `只在段尾追加一个 callout 块列出预读问题，不要改写已有内容；若 \`## 笔记\` 段不存在，在文件末尾新建。`,
        `块格式（前后各一空行）：`,
        `:::callout{type="info" title="预读问题"}`,
        `- <预读问题1>`,
        `- <预读问题2>`,
        `:::`,
      ].join('\n');
    default:
      return '';
  }
}

/**
 * 打开 AI 面板并预填提示词（无新调用链，复用 ContextMenu 的 addFileToChat 模式）。
 * - 注入主题文档作为附件上下文（ChatInput → AiPanel.handleSend 会生成"请先用 Read 工具
 *   读取该文件"指令，AI 据此 Read + Edit 该路径；Claude adapter 以 vault 根为 workingDir，
 *   `topicPath` 为 vault 相对路径，Edit 工具可直达）；
 * - 预填提示词到输入框（经 aiStore.pendingPrompt，由 ChatInput 消费）——提示词指令已从
 *   "产出清单供粘贴"改为"用 Edit 工具直接编辑对应段"（PR5）；
 * - 打开 AI 面板（settings.showAiPanel + editorStore.aiPanelVisible）；
 * - 同时确保主题文档作为编辑器 tab 打开：AI 提出的 fileChange 经 aiStore.addFileChange
 *   命中已打开的 tab → enterDiffReview，使现有 DiffReviewBar（WorkArea）可审阅 accept/reject；
 *   openFile 不切换 currentPage，study 页无视觉影响，切回 editor 页即可审阅 diff。
 *   工作台侧则由 AiPanel done → vaultStore.refreshFileTree → studyStore.subscribeToFileTree
 *   （防抖 300ms）→ refresh 自动重新解析，无需 diff 审阅也能看到 AI 编辑结果。
 * 调用方应在 isAiAvailable() 为真时才调用。
 */
export function openStudyAiAction(
  topicName: string,
  topicPath: string,
  prompt: string,
): void {
  const ai = useAiStore.getState();
  ai.addFileToChat(topicName, topicPath);
  ai.setPendingPrompt(prompt);
  useSettingsStore.getState().updateSettings({ showAiPanel: true });
  useEditorStore.setState({ aiPanelVisible: true });
  // 非阻塞打开主题文档 tab，接上 diff 审阅链路（不切换页面、不影响 study 视图）。
  const fileName = topicPath.split('/').pop() ?? topicPath;
  void useEditorStore.getState().openFile(topicPath, fileName);
}
