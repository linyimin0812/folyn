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

import type { ScheduleTask } from '@/features/schedule/types';
import type { StudyUnit, StudyMaterial, AiAction } from './types';
import { listAdapters } from '@quill/cli-adapter';
import { useSettingsStore } from '@/store/settingsStore';
import { useEditorStore } from '@/store/editorStore';
import { runFeatureAgent } from '@/services/featureAgentService';

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
 * 判定：settings.cliAdapter 非空且在已注册 CLI 适配器列表中。
 * 未配置时 AI 动作按钮禁用并提示，复习/计划/笔记非 AI 部分仍可用。
 */
export function isAiAvailable(): boolean {
  const id = useSettingsStore.getState().cliAdapter;
  if (!id) return false;
  try {
    return listAdapters().some((a) => a.id === id);
  } catch {
    return false;
  }
}

/**
 * 构造各 AI 动作的运行指令（PR9：动态部分）。
 *
 * 静态输出契约（行语法 / callout 格式 / append-only 规则）由 canonical
 * `study.md` 的 system prompt 承载。运行时 agent 文件已播种到
 * `<vault>/__study__/.claude/agents/study.md`，Claude CLI 在 `bare:false` 下靠 cwd
 * （`<vault>/__study__/`）自动发现（PR2：不再用 `--agents` 内联交付）。
 * 本函数只产出与主题/资料相关的动态指令，agent 据此按契约执行：
 * - research / plan：agent 返回结构化文本建议行（不直编文件）→ studyStore
 *   捕获 effect 扫 study 会话最后 assistant 消息 → 建议卡片。
 * - feynman / selftest / sq3r：agent 用 Edit 直编主题 .md 的 `## 笔记` 段，
 *   fileChange 经 aiStore.addFileChange → enterDiffReview 进 DiffView 审阅
 *   （PR5 机制不变）。
 *
 * topicName 为人类可读主题标题，topicPath 为 vault 相对路径。
 * plan 可选传入 selectedMaterials（用户在资料区勾选的资料），作为拆解依据。
 */
export function buildStudyInstruction(
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
  // agent cwd = `<vault>/__study__/`，topicPath 是 vault 相对路径（如 `__study__/<slug>.md`）。
  // 提取 cwd 相对文件名（`<slug>.md`）方便 agent 直接 Read/Edit；同时保留 vault 相对路径供显示。
  const cwdFileName = topicPath.split('/').pop() ?? topicPath;
  const head = `主题文档：${topicPath}（${topicName}）\n主题文档 cwd 相对路径：${cwdFileName}`;
  switch (action) {
    case 'research':
      return [
        head,
        '动作：research',
      ].join('\n');
    case 'plan': {
      const refs = selectedMaterials && selectedMaterials.length
        ? [
          '',
          '依据以下资料拆解单元，确保单元覆盖这些资料：',
          ...selectedMaterials.map((m) =>
            `- ${m.title}${m.author ? ` | ${m.author}` : ''}${m.url ? ` | ${m.url}` : ''}${m.summary ? ` | ${m.summary}` : ''}`,
          ),
        ].join('\n')
        : '';
      return `${head}${refs}\n动作：plan`;
    }
    case 'feynman':
      return [
        head,
        '动作：feynman',
        ...(unitTitle ? [`聚焦单元：${unitTitle}`] : []),
        '我会先用大白话讲，请按契约执行。',
      ].join('\n');
    case 'selftest':
      return `${head}\n动作：selftest`;
    case 'sq3r':
      return [
        head,
        '动作：sq3r',
        `对资料做 SQ3R 预读：${materialTitle ? `「${materialTitle}」` : ''}${materialUrl ? `（${materialUrl}）` : ''}`,
      ].filter((s) => s.length > 0).join('\n');
    default:
      return '';
  }
}

/**
 * 在专用 study 会话里运行 study agent（PR2：改调 runFeatureAgent）。
 * - 不再预填 ChatInput 输入框（不 setPendingPrompt / addFileToChat）；
 * - 调 runFeatureAgent('study', instruction) 在 study 会话自动执行（cwd 发现
 *   vault 内 agent 文件，缺失回退 `--bare`），prompt 不显示在聊天框；
 * - 打开 AI 面板（settings.showAiPanel + editorStore.aiPanelVisible）；
 * - opts.openFile !== false 时，同时把主题文档作为编辑器 tab 打开，接上 diff 审阅链路
 *   （feynman/selftest/sq3r 直编文件场景需要）。research/plan 返回文本建议、
 *   不直编文件，调用方传 { openFile: false } 跳过开 tab。
 * 调用方应在 isAiAvailable() 为真时才调用。
 */
export function openStudyAiAction(
  topicPath: string,
  instruction: string,
  opts?: { openFile?: boolean },
): void {
  void runFeatureAgent('study', instruction);
  useSettingsStore.getState().updateSettings({ showAiPanel: true });
  useEditorStore.setState({ aiPanelVisible: true });
  if (opts?.openFile === false) return;
  // 非阻塞打开主题文档 tab，接上 diff 审阅链路（不切换页面、不影响 study 视图）。
  const fileName = topicPath.split('/').pop() ?? topicPath;
  void useEditorStore.getState().openFile(topicPath, fileName);
}
