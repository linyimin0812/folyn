# 日程工作台移除事件分类（work/personal/family/health/task）

## Goal

从日程工作台（schedule workbench）中**完全移除**"事件分类"概念。当前每条日历事件都带一个
`EventCategory`（work / personal / family / health / task），用于颜色区分、筛选与持久化。
用户希望简化为"事件不分类"，数据模型 + UI + markdown 持久化 + AI plan-my-day 全部 rip 掉。

## Decision (ADR-lite)

**Context**: EventCategory 是事件的颜色/筛选维度，但实际代码逻辑里没有分支依赖
（EventBlock 已经用 `taskId` 区分任务 vs 事件），分类仅用于 CSS 类名、i18n 标签、markdown 字段。

**Decision**:
- 类型层：删除 `EventCategory` 类型、`EVENT_CATEGORIES`、`EVENT_CATEGORY_LABEL` 常量
- 数据层：`ScheduleEvent` 移除 `category` 字段；markdown 序列化格式从
  `- @event HH:MM-HH:MM | <cat> | <title> [| <note>]` 改为 `- @event HH:MM-HH:MM | <title> [| <note>]`
- 解析层：**硬切换** — 新格式正则，旧格式行不再匹配（事件从 UI 消失，源文件不动）
- 状态层：`scheduleStore.calendarFilter` 整个删除，`setCalendarFilter` action 删除
- UI 层：`ScheduleModal` 删分类选择器、`WeekGrid` 删图例、`CalendarCategoryList` 整组件删除、
  `EventBlock` 删 `category` prop 和 CSS 类名分支（统一颜色或按 `taskId` 二分）
- AI 层：`planMyDayService` 的 `PlannedEvent` 类型删 `category`、prompt 模板不再输出该字段、
  `PlanMyDayPreview` 不再展示
- i18n：删 `schedule.json` 中 `weekGrid.legend.*`、`category.event.*`，同步 en/ja
- CSS：删 `index.css` 中 `--cal-work/personal/family/health/task` 变量及对应类样式（保留 task
  用于已排程任务渲染样式则改为按 `taskId` 选中）

**Consequences**:
- 历史 daily notes 中带 `| work |` 等格式的事件行**不会再被解析**，UI 中事件消失但源文件保留
- 用户需要手动迁移历史文件，或接受这些事件丢失
- 不影响任务看板分类（TaskCategory: design/dev/bug/...）
- 已排程任务渲染成事件仍正常显示（由 `taskId` 驱动样式）

## Requirements

1. 类型层 rip：`EventCategory` / `EVENT_CATEGORIES` / `EVENT_CATEGORY_LABEL` 删除
2. `ScheduleEvent.category` 字段删除
3. markdown.ts：`EVENT_RE` 改为新格式（不带 cat 槽），`serialize` 不再写 category
4. `scheduleStore.ts`：删 `calendarFilter` 状态、`setCalendarFilter` action、初始化值
5. `ScheduleModal.tsx`：删分类选择器 UI 与相关 state；新建事件默认无 category
6. `WeekGrid.tsx`：删底部图例；事件块样式不再依赖 category
7. `CalendarCategoryList.tsx`：整组件删除，并清理调用点
8. `EventBlock.tsx`：删 `category` prop，CSS 类名简化为 `sw-event`（或 `sw-event sw-event--task` 当 `taskId` 存在）
9. `planMyDayService.ts`：`PlannedEvent` 删 `category`、prompt 模板更新、解析忽略 category
10. `PlanMyDayPreview.tsx`：删 category 相关渲染
11. i18n：zh/en/ja `schedule.json` 删 `weekGrid.legend.*` 和 `category.event.*`
12. CSS：`index.css` 删 `--cal-work` 等变量，事件块统一颜色；task 样式改为按 `.sw-event--task`
13. 测试：`markdown.test.ts` / `planMyDayService.test.ts` / `PlanMyDayPreview.test.ts` 同步更新

## Acceptance Criteria

- [ ] 全项目无 `EventCategory` 类型引用残留（`grep -r EventCategory apps/desktop/src` 无输出）
- [ ] 全项目无 `EVENT_CATEGORY_LABEL` / `EVENT_CATEGORIES` 残留
- [ ] `grep -r "cal-work\|cal-personal\|cal-family\|cal-health\|cal-task" apps/desktop/src` 仅剩迁移注释或无
- [ ] 新建事件流程不再出现分类选择器
- [ ] 周视图底部图例已删除
- [ ] 侧栏分类计数列表已删除
- [ ] AI plan-my-day prompt 不再要求 category 输出
- [ ] 测试套件通过（`markdown.test.ts`、`planMyDayService.test.ts`、`PlanMyDayPreview.test.ts`）
- [ ] i18n zh/en/ja 同步

## Definition of Done

- 全部 Acceptance Criteria 满足
- 类型检查通过（`tsc --noEmit`，由用户运行）
- 用户在新 vault 或测试 vault 中验证新建事件、查看周视图、运行 AI plan-my-day 正常
- 不修改任务看板分类（TaskCategory）相关逻辑

## Technical Approach

按文件依赖顺序，自底向上：

1. **types.ts** — 删除 EventCategory 类型、常量、ScheduleEvent.category 字段
2. **markdown.ts** — 改 EVENT_RE 正则为 `- @event\s+(\d{1,2}:\d{2})-(\d{1,2}:\d{2})\s*\|\s*(.+?)(?:\s*\|\s*(.+))?$`；serialize 改为不带 cat 的格式
3. **scheduleStore.ts** — 删 calendarFilter 状态、setCalendarFilter action、初始化
4. **EventBlock.tsx** — 删 category prop，CSS 类改为 `sw-event` + （taskId 时）`sw-event--task`
5. **ScheduleModal.tsx** — 删分类选择器、cal state、initialCal
6. **WeekGrid.tsx** — 删图例段；事件块 props 不再传 category
7. **CalendarCategoryList.tsx** — 删除整个文件；调用点（ScheduleWorkbenchPage 或 Sidebar）移除引用
8. **planMyDayService.ts** — PlannedEvent 删 category；prompt 模板 newEvents 字段示例去掉 category；解析忽略
9. **PlanMyDayPreview.tsx** — 删 category 相关展示
10. **index.css** — 删 --cal-* 变量与对应 .sw-event.work 等规则；新增 .sw-event--task 替代
11. **i18n** — zh/en/ja schedule.json 删 weekGrid.legend 和 category.event 段
12. **测试** — markdown.test.ts / planMyDayService.test.ts / PlanMyDayPreview.test.ts 同步

## Out of Scope

- 任务看板分类（TaskCategory: design/dev/bug/growth/ops/calendar/learn）
- 历史 daily notes 迁移脚本（用户接受硬切换）
- Plan-my-day 的核心 AI 逻辑（仅删 category 字段）

## Technical Notes

- 关键文件：
  - `apps/desktop/src/features/schedule/types.ts:4,81,114-120`
  - `apps/desktop/src/features/schedule/markdown.ts:19,84,155`
  - `apps/desktop/src/store/scheduleStore.ts:17,23,45,56,144,182-183`
  - `apps/desktop/src/components/schedule/ScheduleModal.tsx:7,20,67,78,221`
  - `apps/desktop/src/components/schedule/WeekGrid.tsx:61-65`
  - `apps/desktop/src/components/schedule/EventBlock.tsx:5,8,29`
  - `apps/desktop/src/components/schedule/CalendarCategoryList.tsx`（整文件删）
  - `apps/desktop/src/components/schedule/PlanMyDayPreview.tsx:31,482`
  - `apps/desktop/src/services/planMyDayService.ts`
  - `apps/desktop/src/i18n/locales/{zh,en,ja}/schedule.json`
  - `apps/desktop/src/index.css`（--cal-* 变量）
- 测试文件：markdown.test.ts、planMyDayService.test.ts、PlanMyDayPreview.test.ts、ActivityBar.test.tsx
- 相关 feature agent: `apps/desktop/src/features/schedule/.claude/agents/schedule.md` 不涉及 category
