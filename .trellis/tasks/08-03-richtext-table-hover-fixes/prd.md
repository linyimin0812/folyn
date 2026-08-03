# 富文本表格 hover 修复

## Goal

修上一轮 `08-03-richtext-table-hover-and-context-menu` 上线后的三个回归：(1) 表格上的 +行/+列 快速按钮不要了；(2) 行左/列上 hover 手柄丑且点不到——鼠标移到按钮位置时 hover 状态被 `mouseover` 清掉，按钮消失；(3) 表格插入网格 picker 只显示一根竖长条、只能选 1×1——`TableSizeGrid` 的 grid 只设了 `gridTemplateRows`，列宽 auto 收缩到 0，按钮没显式宽度。

## Requirements

1. **删 +row/+col 快速按钮**：`TableControlsOverlay` 移除两个 `+` append 按钮（行末/列末）。row/col hover 手柄和右键菜单已覆盖插入需求。
2. **修 hover 手柄消失**：`onOver` 当前在 target 不在当前 table 时 `setHover(null)` —— 但手柄在表格外，鼠标移到手柄就触发清空。改成：target 不在当前 table 时 no-op（不清空），让 wrapper 的 `mouseleave` 负责清空。手柄加 `data-table-handle` 属性，`onOver` 命中手柄也 no-op。
3. **手柄样式**：去掉重 border/shadow，改成轻量 `w-4 h-4` 无 border 的 hover-bg 方块，icon 用 `MoreVertical`/`MoreHorizontal`（lucide 已有），更克制。
4. **修 TableSizeGrid 列宽**：grid style 加 `gridTemplateColumns: repeat(8, 16px)`（或 `gridAutoColumns: 16px`），按钮加显式 `w-4 h-4` 兜底，确保 8×8 方块全显。

## Acceptance Criteria

- [ ] 表格上不再有 +行/+列 按钮。
- [ ] 鼠标从单元格移到行/列手柄，手柄不消失，可点击打开菜单。
- [ ] 手柄样式克制（无重 border）。
- [ ] 点工具栏表格图标弹出 8×8 正方形网格，可悬停选择任意 r×c（如 5×8），点击插入对应表。
- [ ] lint/typecheck/vitest 绿。

## Out of Scope

- 列宽拖拽、行/列拖拽重排、单元格背景色等（同前一任务）。
- 手柄的拖拽重排功能（手柄只负责开菜单）。

## Technical Notes

- 关键文件：
  - `TableControlsOverlay.tsx`：删 +row/+col 按钮、改 `onOver`、改手柄样式。
  - `TableSizeGrid.tsx`：grid style 加列宽。
- `onOver` 修复逻辑：
  ```ts
  if (target.closest('[data-table-handle]')) return; // 命中手柄：no-op
  const table = findCurrentTableDom(editor);
  if (!table || !table.contains(target)) return; // 不在当前 table：no-op（不清空）
  // 在 table 内：更新 hover
  ```
- `mouseleave` 仍挂在 wrapper 上，离开 wrapper 才清空。

## Decision (ADR-lite)

**Context**: hover 手柄在表格外，鼠标穿过 22px gap 时 mouseover 触发清空。
**Decision**: 改 `onOver` 为"不在当前 table 就 no-op"，加 `data-table-handle` 标记手柄自己。手柄样式去 border 减视觉重量。
**Consequences**: 鼠标移到 wrapper 内非 table 区域（如表格下方段落）时手柄仍可见，直到 wrapper `mouseleave` 或 editor selection 离开 table。可接受——selectionUpdate 触发 measure() 会清 rowBtn/colBtn 使 overlay 整体 return null。
