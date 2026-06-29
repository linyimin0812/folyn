# 日程周视图：并列布局 + 任意分钟精度

## Goal

修复周视图两个显示问题：(1) 同一时间格内多个事件/任务直接绝对定位重叠，无法区分；(2) 时间仅按整小时吸附，4:30-5:00 这类半小时事件无法精确表达与显示。

## What I already know

- `WeekGrid.tsx`：每日列 24 个 `.sw-slot`（每小时一格），事件用 `EventBlock` 绝对定位 `top = start * var(--hour-h)`。同格多个事件会完全重叠。
- `EventBlock.tsx`：`top/height` 用 `calc(start * var(--hour-h))` 与 `calc((end-start) * var(--hour-h) - 2px)`，**已经支持浮点小时**（如 9.5）。
- `types.ts`：`ScheduleEvent.start/end`、`ScheduleTask.scheduledStart/End` 都是小时浮点（9.5 = 09:30）。
- `markdown.ts`：`parseTime("09:30")` → 9.5，`formatTime(9.5)` → `"09:30"`。**数据层与序列化已支持任意分钟精度**。
- `ScheduleModal.tsx`：用 `<input type="time">`（HH:MM）输入起止时间，**已支持分钟输入**。
- `WeekGrid` drop handler：`h = Math.floor((e.clientY - rect.top) / hourH)`，按整小时吸附；任务 `scheduleTask(id, dStr, h, h+1)` 固定 1 小时；事件 `moveEvent(id, dStr, h, h+dur)` 保留原时长按整小时平移。
- `EventBlock` 的 `short` 标记：`end - start < 1` 时只显标题不显时间，对半小时事件仍可用但样式可能需要调整。

## Assumptions (temporary)

- 拖放吸附粒度 = 15 分钟（与分钟精度输入匹配，避免像素抖动）。事件块起点对齐到最近的 15 分钟。
- 已排程任务拖拽不再固定 1 小时，而是保留原时长按 15 分钟吸附（与事件一致）。
- 同格多个事件按时间区间有交集时进行并列分组；时间不交叠的事件各自占满列宽。

## Open Questions

- （待确认）Q1：拖放吸附粒度 15 分钟是否合适？还是 5 分钟？
- （待确认）Q2：并列布局时是否需要层叠错位以露出标题首部，还是纯 N 等分？
- （已定）A1：用户选「并列缩窄（N 等分宽度）」。
- （已定）A2：用户选「支持任意分钟精度」。

## Requirements

### 1. 重叠事件并列布局（N 等分宽度）

- 在 `WeekGrid` 每日列渲染事件前，按"时间区间有交集"对当日所有事件 + 已排程任务做分组（greedy clustering by overlap）。
- 同组内 N 个块，每个块宽度 = `calc(100% / N)`，按开始时间从左到右排列；组内可留 2px gap。
- 跨组（时间不交叠）的事件恢复正常 100% 宽度。
- 实现位置：`WeekGrid.tsx` 内对 `dayEvents + dayTasks` 做分组后传 `colCount` + `colIndex` 给 `EventBlock`；`EventBlock` 增加 `colCount`、`colIndex` props，`width` / `left` 用百分比计算。

### 2. 任意分钟精度（拖放吸附 15 分钟）

- `WeekGrid` drop handler：把 Y 坐标换算成分钟，再吸附到 15 分钟。`start = Math.floor(minutes / 15) * 15 / 60`。
- 任务拖放：`scheduleTask(id, dStr, start, start + dur)`，`dur` 默认 1 小时（保留原时长 if 已排程）。
- 事件拖放：保留原时长，`moveEvent(id, dStr, start, start + dur)`。
- 视觉：`.sw-slot` 保持每小时一格（不改 DOM 结构），但 CSS 增加半小时参考线（`background-image` linear-gradient 或 `::before` 12:30/13:30 处虚线），可选。
- `EventBlock` 的 `short` 阈值：从 `< 1` 改为 `< 0.25`（< 15 分钟）才极短，30 分钟块正常显示时间+标题。

### 3. 类型 / 不变量

- 不改 `ScheduleEvent.start/end` 类型（已是浮点）。
- 不改 markdown 解析（已支持）。
- 不改 ScheduleModal（已支持 `<input type="time">`）。

## Acceptance Criteria

- [ ] 同一时间格内 2-3 个事件，UI 显示为并列 N 等分宽度，标题可见、互不遮挡。
- [ ] 时间不交叠的事件保持原 100% 宽度。
- [ ] 在 ScheduleModal 用 `<input type="time">` 输入 09:30-10:00，事件块在 9:00 格的下半部分定位精确。
- [ ] 拖事件到周视图，吸附到 15 分钟边界（如 9:15、9:30、9:45），原时长保留。
- [ ] 拖任务到周视图，吸附 15 分钟，默认 1 小时时长（或保留已排程时长）。
- [ ] 跨小时事件（如 9:30-10:30）UI 正确跨越两个 hour 格。
- [ ] 已有添加/拖拽/排程流程无回归。
- [ ] tsc / build / 现有 markdown 测试通过。

## Definition of Done

- 上述 Acceptance Criteria 全部通过。
- 手测：并列显示、半小时事件、15 分钟拖放吸附、跨小时事件。
- Lint / typecheck / build green。

## Out of Scope (explicit)

- `EventBlock` 的层叠错位（用户已选 N 等分）。
- 5 分钟及以下粒度（15 分钟已足够覆盖典型排程需求）。
- 调整 daily note 的 `## 日程` 解析/序列化（已支持）。
- `ScheduleModal` 时间输入 UI 改造（已用 `<input type="time">`）。
- 删除功能（由 06-29-delete-schedule-event 任务承担）。
- 任务类别/列/优先级编辑（仍由看板视图管理）。

## Added Scope: 点开日程支持修改

用户点开事件/任务详情弹窗后，可以直接修改字段并保存（无需删除重建）。

### 事件可编辑字段
- 标题、起止时间（HH:MM，支持分钟精度）、类别（work/personal/family/health）、备注。

### 任务可编辑字段
- 标题、排程起止时间（HH:MM）。其他字段（类别/列/优先级）仍由看板视图管理。

### 实现
- **`updateEvent(eventId, patch)`** in `useScheduleStore`：定位事件 → `mutateNote(noteDate, fn)` 中 fn 用 patch 覆盖该事件行的字段 → 序列化重解析 → 替换该 noteDate 的 events。
- **`updateTask(taskId, patch)`** in `useScheduleStore`：同理，更新任务行的 `sched:` 属性或标题。
- **`EventDetailModal`** 改造：把只读的 `sw-detail-value` 替换为对应输入控件（`<input type="text">` 标题、`<input type="time">` 起止、radio 类别、`<textarea>` 备注），底部增加「保存」按钮；任务分支只暴露标题+起止时间。
- 保存按钮调用 `updateEvent`/`updateTask` 后关闭弹窗；按钮在 patch 为空时可禁用。
- 删除/取消排程按钮保留。

### Acceptance Criteria (added)
- [ ] 点开事件 → 修改标题/时间/类别/备注 → 保存 → 弹窗关闭、WeekGrid 立即反映新值、daily note 行已更新。
- [ ] 点开已排程任务 → 修改标题/排程时间 → 保存 → WeekGrid 块位置与文本更新、daily note 已更新。
- [ ] 未保存改动直接关闭弹窗不写盘。
- [ ] tsc / build 通过。

## Technical Approach

1. **`computeOverlapGroups(items)`** 工具函数：输入 `{id, start, end}[]`，按开始时间排序后扫描，把有交集的归为一组，输出 `Map<id, {colCount, colIndex}>`。放在 `apps/desktop/src/schedule/layout.ts`。
2. **`EventBlock`** 增加 `colCount=1` `colIndex=0` props；`width = calc(100% / colCount - 2px)`、`left = calc(colIndex * 100% / colCount)`。
3. **`WeekGrid`** 每日列：把 `dayEvents + dayTasks` 合并传入 `computeOverlapGroups`，再给每个 `EventBlock` 传 `colCount`/`colIndex`。
4. **`WeekGrid` drop**：分钟吸附 `start = Math.round((y / rect.height) * 24 * 4) / 4`（15 分钟 = 1/4 小时）。
5. **`scheduleTask` / `moveEvent`**：已有签名支持浮点，无需改 store；调用方传浮点即可。
6. **CSS**：`.sw-day-col` 加半小时虚线（`repeating-linear-gradient` 或在 `::after` 画 12 条线），增强可读性。

## Technical Notes

- 文件：`apps/desktop/src/components/schedule/WeekGrid.tsx`、`apps/desktop/src/components/schedule/EventBlock.tsx`、`apps/desktop/src/schedule/layout.ts`（新增）、`apps/desktop/src/index.css`。
- `var(--hour-h)` 是 CSS 变量，`EventBlock` 已依赖；保留。
- 分组算法复杂度 O(n log n)（n = 当日事件数，通常 < 10），无性能问题。
