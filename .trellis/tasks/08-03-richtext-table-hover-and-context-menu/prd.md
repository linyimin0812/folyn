# 富文本表格编辑 v2：悬浮行列菜单 + 右键菜单

## Goal

把表格编辑操作从工具栏搬到表格本体：行左边缘、列上边缘 hover 出菜单（插入上/下、删除、表头切换），单元格右键出合并/拆分/对齐/删表菜单。工具栏只在表格激活时保留一个"删表"或彻底移除。同时修表格插入网格 picker 不显示的 bug（如存在）。

## What I already know

- 现有实现（前一个任务 `08-02-richtext-table-editing` 已归档）：
  - `TableSizeGrid.tsx`：8×8 网格 picker，挂在工具栏表格插入按钮下，popover 模式（`relative` + `absolute top-full right-0` + fixed backdrop）。
  - `TableControlsOverlay.tsx`：React overlay，监听 `transaction`，光标在表内时渲染两个 `+` 按钮（行末=append row，列末=append col），定位到当前 table DOM 的右下边缘。
  - `RichTextToolbar.tsx` L230–246：`tableButtons` 数组（12 个按钮），`inTable` 时渲染在工具栏尾部，含 merge/split/align ×3/add col-row before-after ×4/delete col-row ×2/toggle header row/delete table。
- 用户反馈：
  1. 点表格图标没出网格（待验证；代码看起来是好的，可能是旧 build 或交互问题）。
  2. 工具栏 12 个表格按钮太多太挤。
  3. 想要行左边缘、列上边缘 hover 菜单。
  4. 想要单元格右键合并/拆分等。
- TableKit 命令齐全（见前一任务 PRD）：`mergeCells`/`splitCell`/`mergeOrSplit`/`addColumnBefore/After`/`addRowBefore/After`/`deleteColumn/Row/Table`/`toggleHeaderRow/Column/Cell`/`setCellAttribute`/`setCellSelection`。
- 编辑器外层 wrapper 已是 `relative` + 非 scroll 容器（RichTextEditor.tsx L147），`TableControlsOverlay` 已经靠这个 wrapper-relative 坐标系工作，扩展它在同一坐标系内渲染行列 hover 菜单即可，无需新 positioning 基础设施。
- `selectedCell` class 由 TableKit 给被选中的 td/th 加；右键菜单要基于 cell selection（多选矩形才能 merge）。
- 已有 `UrlModal` popover 模式可参考做右键菜单的渲染层（fixed overlay + stopPropagation + click-outside 关闭）。

## Assumptions (temporary)

- "行左边缘" = 鼠标 hover 到某一行时，在该行左边缘外露一个手柄按钮，点开下拉菜单。
- "列上边缘" = 同理，列顶部。
- "+行/+列"快速按钮（现有 overlay）保留——是高频快捷插入。
- 右键菜单只在光标/选择在 table 内时触发；表格外右键保持浏览器默认（不做富文本自定义右键）。

## Decision (ADR-lite)

**Context**: 表格编辑入口分散在工具栏（12 按钮）和现有 overlay（+row/+col）。用户要求移到表格本体——行左/列上 hover 菜单 + 右键菜单。三种菜单布局候选（全功能 vs 只右键 vs 折中）。

**Decision**: Approach A — 全功能。
- 行左 hover 手柄：Insert above/below/delete row/toggle header row（首行）
- 列上 hover 手柄：Insert left/right/delete col/toggle header column（首列）
- 右键：Merge/Split/Align L/C/R/Toggle header cell/Delete table
- 工具栏移除全部 12 个 tableButtons

**Consequences**: 三处入口（行/列/右键）需要分别实现但定位共享 wrapper-relative 坐标系，复用 `TableControlsOverlay` 基础。右键菜单需要 `onContextMenu` 拦截 + 判断 `editor.isActive('table')`。工具栏只剩基础格式 + insert table 入口。MVP 不做拖拽重排/列宽。

## Requirements (evolving)

1. **表格插入网格**：点工具栏表格图标 → 弹 8×8 网格，hover 高亮 + "r×c" 提示，点击插入 `insertTable({rows,cols,withHeaderRow:true})`。Esc/点外关闭。**验证现有实现是否真工作**，不工作就修。
2. **行左边缘 hover 菜单**：光标在表内 + 鼠标 hover 到某一行 → 该行左边缘显示手柄按钮，点击下拉菜单：Insert row above / Insert row below / Delete row / Toggle header row（首行特有）/ Toggle header cell（cell-level，可选）。
3. **列上边缘 hover 菜单**：同理列顶部：Insert column left / Insert column right / Delete column / Toggle header column（首列特有）。
4. **保留 +行/+列 快速按钮**：现有 overlay 的 append +row / +col 保留。
5. **单元格右键菜单**：表内右键 → 菜单：Merge cells（多选时）/ Split cell（合并单元格时）/ Align left|center|right / Toggle header cell / Delete table。表外右键 = 浏览器默认。
6. **工具栏清理**：移除 `tableButtons` 数组的 12 个按钮；工具栏不再因表格激活而膨胀。"删表"入口移到右键菜单。
7. **键盘 Tab 跨格**：保持 TableKit 默认，不破坏。

## Acceptance Criteria (evolving)

- [ ] 点工具栏表格图标弹出 8×8 网格，hover 高亮 + "3×5" 提示，点击插入对应表（含表头行）。
- [ ] 光标在表内 + hover 到某行左边缘 → 出现手柄，点击下拉菜单可执行 insert above/below/delete row/toggle header row。
- [ ] 光标在表内 + hover 到某列上边缘 → 同理列操作。
- [ ] 矩形多选单元格后右键 → "Merge cells" 可用，点击合并成功。
- [ ] 光标在合并单元格右键 → "Split cell" 可用，点击拆分成功。
- [ ] 右键菜单含 align left/center/right，点击改变 `text-align`，存盘重开保持。
- [ ] 右键菜单含 "Delete table"，点击删表。
- [ ] 工具栏在表格激活时不出现 12 个表格按钮（只保留原有非表格工具 + Insert table 入口）。
- [ ] lint / typecheck / vitest 绿；round-trip 测试不破坏。

## Definition of Done

- 测试：round-trip 已覆盖 align/colspan/rowspan；新增交互若不便单测就手动验。
- lint / typecheck / vitest 绿。
- 不破坏 anti-write-back-loop、slash 菜单、现有 `TableControlsOverlay` 的 +行/+列。

## Out of Scope

- 列宽拖拽调整 / `colwidth` 持久化（前一任务已声明 out）。
- 单元格背景色 / 边框样式 UI。
- Markdown 表格转换。
- 行/列拖拽重排。
- 嵌套表 / 跨表选择。

## Technical Notes

- 关键文件：
  - `apps/desktop/src/components/file-types/rich-text/RichTextToolbar.tsx`（删 `tableButtons`）
  - `apps/desktop/src/components/file-types/rich-text/TableControlsOverlay.tsx`（扩展为承载行列 hover 菜单 + 右键菜单）
  - `apps/desktop/src/components/file-types/rich-text/TableSizeGrid.tsx`（验证）
  - `apps/desktop/src/components/file-types/rich-text/RichTextEditor.tsx`（挂载点已就绪）
- 定位：行列 hover 按钮沿用 `TableControlsOverlay` 的 wrapper-relative 坐标系（`tr.left - cr.left` 等），无需新基础设施。每个 tr/td 的 `getBoundingClientRect` 即可定位对应手柄位置。
- 右键菜单：在 `RichTextEditor` 的 `EditorContent` wrapper 上挂 `onContextMenu`，判断 `editor.isActive('table')` 后 `e.preventDefault()` 并 setState 开菜单；否则放行浏览器默认。
- 命令速查见前任务 PRD L72。

## Design Proposal (待用户确认)

**行左边缘 hover 手柄下拉菜单**：
- Insert row above
- Insert row below
- Delete row
- ---（分隔）---
- Toggle header row（仅当首行）

**列上边缘 hover 手柄下拉菜单**：
- Insert column left
- Insert column right
- Delete column
- ---
- Toggle header column（仅当首列）

**单元格右键菜单**：
- Merge cells（多选时启用）
- Split cell（合并单元格时启用）
- ---
- Align left / center / right
- ---
- Toggle header cell
- Delete table
