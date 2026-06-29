# 日程事件拖拽修改时间

## Goal
在日程页周视图里，把已排程的**事件块**（work/personal/family/health）拖到别的时间格即可修改其时间，并与现有"任务拖到时间格排程"机制协调、不冲突。

## What I already know
- `EventBlock.tsx`：当前仅 `category === 'task'` 的块 `draggable`，拖拽载荷 `application/x-task`；普通事件不可拖。
- `WeekGrid.tsx`：`.sw-slot` 是 drop target，仅接受 `application/x-task`，drop 时调用 `scheduleTask(taskId, dStr, h, h+1)`（固定 1 小时）。
- `scheduleStore`：有 `scheduleTask(taskId, date, start, end)`；事件只有 `addEvent`，**没有改事件时间的 action**。
- 事件持久化在 daily note 的 `## 日程` 段，`- @event 09:00-10:00 | work | 标题 | 备注`，按 `noteDate` 归属当天。改时间=改行；跨天=从旧 note 删除+新 note 新增。
- `mutateNote(noteDate, fn)` 已支持读→改→序列化→写回→重新解析→刷新树。
- 时间格高度 `var(--hour-h)`（48px），事件定位用 `calc(start * var(--hour-h))`。

## Assumptions (temporary)
- 拖事件到新时间格 = 吸附到该小时（snap-to-hour），与任务拖拽一致。
- 保留事件原时长（end-start），仅平移 start。
- 跨天拖拽需要支持（事件从周一移到周三）。

## Open Questions
- （已全部解决）

## Requirements (evolving)
- 事件块（work/personal/family/health）可拖拽（HTML5 DnD，载荷 `application/x-event` + eventId + 原时长）。
- 拖到时间格 h → start=h，end=h+原时长（保留原时长，平移）。
- **支持同日改时间 + 跨日移动**：
  - 同日：改该 daily note 内事件行的 start/end。
  - 跨日：旧 daily note 删该事件行 + 新 daily note 增该事件行（noteDate 改为目标日）。
- 与任务拖拽并存：slot drop 按 dataTransfer 类型分支（`application/x-task`→scheduleTask；`application/x-event`→moveEvent），互不干扰。
- 持久化写回 daily note，UI 即时刷新（复用 mutateNote 的重新解析 + refreshFileTree）。

## Acceptance Criteria (evolving)
- [ ] 拖事件到同日另一小时格 → 时间更新、UI 刷新、磁盘 `## 日程` 行 start/end 改变。
- [ ] 拖事件到他日列的小时格 → 事件从旧 daily note 消失、出现在新 daily note，时间更新。
- [ ] 原时长保留（9:00-10:30 拖到 14:00 → 14:00-15:30）。
- [ ] 拖任务到时间格仍正常（不回归）。
- [ ] tsc / build / markdown 测试通过。

## Definition of Done
- tsc / build / 现有 markdown 测试通过。
- 手测：同日拖、跨日拖、任务拖不回归、原时长保留。

## Out of Scope (explicit)
- 自由拖拽到半小时精度（snap-to-hour 即可）。
- 拖拽时实时预览/影子跟随。
- 拖到周视图之外的日期（如下个月）。
- 任务拖拽改用"保留时长"（保持现有 1 小时吸附，不动）。

## Technical Approach
1. **store `moveEvent(eventId, newNoteDate, newStart, newEnd)`**：
   - 从 cache 找到事件（含 noteDate、原 start/end、category、title、note、lineIndex）。
   - 计算新 end = newStart + (原 end - 原 start)（若调用方已传 newEnd 则用 newEnd）。
   - 若 newNoteDate === 原 noteDate：`mutateNote(noteDate, fn)` 中把该事件行的 start/end 改为新值（按 lineIndex 定位）。
   - 否则跨日：先 `mutateNote(oldNoteDate, fn)` 删除该事件行（filter out by lineIndex）；再 `mutateNote(newNoteDate, fn)` 追加新事件（lineIndex=-1，noteDate=newNoteDate）；两次写回 + refreshFileTree。
   - 两次 mutateNote 后用返回的 ParsedDaily 更新 cache（删旧 noteDate 的事件、加新 noteDate 的事件）。
2. **EventBlock**：事件也 `draggable`；`onDragStart` 设 `application/x-event` + eventId + `dur`（原 end-start）；保留任务分支。
3. **WeekGrid slot drop**：新增 `application/x-event` 分支：读 eventId + dur，newStart=h，newEnd=min(h+dur, 24)，newNoteDate=dateToString(d)，调 `moveEvent`。保留 `application/x-task` 分支不变。
4. **toast**：`「${title}」已移到 ${DOW} ${formatTime(newStart)}`。

## Decision (ADR-lite)
- Context: 事件时间修改此前只能重建；用户要拖拽改时间。
- Decision: 复用 HTML5 DnD + mutateNote；事件用独立 mime 与任务区分；保留原时长；支持跨日（跨 daily note 迁移）。
- Consequences: 跨日移动是两次文件写回（旧删+新增），若中途失败可能事件暂失——mitigate：先删旧再增新，均在 mutateNote 内 await；id 在跨日后改变（新 noteDate#lineIndex），UI 按 noteDate 整体替换缓存避免 key 残留。

## Technical Notes
- `mutateNote` 现返回重新解析的 ParsedDaily（真实 id/lineIndex），跨日移动后缓存替换以 noteDate 为单位。
- EventBlock 当前 `draggable={category === 'task'}` → 改为所有 category 可拖。
- slot drop 已有 `application/x-task` 判定，扩展为同时识别 `application/x-event`。
- 跨日迁移时若新 daily note 不存在，mutateNote 的 readNoteContent 会自动用模板创建。
