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
import type { StudyUnit, StudyMaterial, AiAction } from './types';
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
 * 构造各 AI 动作的预填提示词。
 *
 * 两种产出模式（PR8）：
 * - research / plan：AI 返回结构化文本建议（严格单行），不直编文件、不走 diff。
 *   聊天产出由 studyStore 扫描（scanMaterialSuggestions / scanUnitSuggestions）
 *   → 建议卡片 → 用户逐条"加入"写盘。
 * - feynman / selftest / sq3r：AI 用 Edit 工具直接编辑主题 .md 的 `## 笔记` 段，
 *   fileChange 经 aiStore.addFileChange → enterDiffReview 进 DiffView 审阅
 *   （PR5 机制不变）。
 *
 * topicName 为人类可读主题标题，topicPath 为 vault 相对路径。
 * plan 可选传入 selectedMaterials（用户在资料区勾选的资料），作为拆解依据。
 */
export function buildStudyPrompt(
  action: AiAction,
  ctx: {
    topicName: string;
    topicPath: string;
    unitTitle?: string;
    materialTitle?: string;
    materialUrl?: string;
    selectedMaterials?: StudyMaterial[];
  },
): string {
  const { topicName, topicPath, unitTitle, materialTitle, materialUrl, selectedMaterials } = ctx;
  switch (action) {
    case 'research':
      return [
        `你是学习规划专家。基于主题「${topicName}」（见附件文件 ${topicPath}），`,
        `检索高质量学习资料（网络文章/文档）与经典书籍/论文。`,
        `请返回 5-8 条资料建议，每条严格单行，格式如下（\`|\` 两侧留空格，难度用 易/中/难，链接为可访问 URL）：`,
        `- @book <书名> | <作者> | <简介> | 难度:<易|中|难> | <链接>`,
        `- @web <标题> | <链接> | <简介>`,
        `只输出这些行（可附简短说明），不要用 Edit 工具改文件。`,
      ].join('\n');
    case 'plan': {
      const refs = selectedMaterials && selectedMaterials.length
        ? [
            '',
            `依据以下资料（标题 / 作者 / 链接 / 简介）拆解单元，确保单元覆盖这些资料：`,
            ...selectedMaterials.map((m) =>
              `- ${m.title}${m.author ? ` | ${m.author}` : ''}${m.url ? ` | ${m.url}` : ''}${m.summary ? ` | ${m.summary}` : ''}`,
            ),
            '',
          ].join('\n')
        : '';
      return [
        `你是学习规划专家。基于主题「${topicName}」（见附件文件 ${topicPath}），将其拆解为 5-10 个由浅入深、有先修顺序的学习单元。`,
        `这些单元将被加入主题文档的 \`## 计划\` 段，请按下述行语法返回。`,
        refs,
        `请返回 5-10 个学习单元，每条严格单行，行语法（序号 + 点 + 空格 + 单元名 + 空格 + \`@\{...\}\`，est 用合理估时如 2h/4h，dep 标注依赖单元序号、无依赖用 \`-\`，prog 固定 0）：`,
        `- [ ] 1. 入门概览 @{est:2h dep:- prog:0}`,
        `- [ ] 2. 核心概念 @{est:4h dep:1 prog:0}`,
        `序号从 1 开始连续递增；估时贴近真实学习量；dep 指向先修单元的序号。`,
        `只输出这些行，不要用 Edit 工具改文件。`,
      ].filter((s) => s.length > 0).join('\n');
    }
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
 *   读取该文件"指令）；
 * - 预填提示词到输入框（经 aiStore.pendingPrompt，由 ChatInput 消费）；
 * - 打开 AI 面板（settings.showAiPanel + editorStore.aiPanelVisible）；
 * - opts.openFile !== false 时，同时把主题文档作为编辑器 tab 打开，接上 diff 审阅链路
 *   （feynman/selftest/sq3r 直编文件场景需要）。research/plan 改为返回文本建议、
 *   不直编文件，调用方传 { openFile: false } 跳过开 tab。
 * 调用方应在 isAiAvailable() 为真时才调用。
 */
export function openStudyAiAction(
  topicName: string,
  topicPath: string,
  prompt: string,
  opts?: { openFile?: boolean },
): void {
  const ai = useAiStore.getState();
  ai.addFileToChat(topicName, topicPath);
  ai.setPendingPrompt(prompt);
  useSettingsStore.getState().updateSettings({ showAiPanel: true });
  useEditorStore.setState({ aiPanelVisible: true });
  if (opts?.openFile === false) return;
  // 非阻塞打开主题文档 tab，接上 diff 审阅链路（不切换页面、不影响 study 视图）。
  const fileName = topicPath.split('/').pop() ?? topicPath;
  void useEditorStore.getState().openFile(topicPath, fileName);
}
