# 富文本表格编辑优化

## Goal

优化 `.rt` 富文本编辑器（Tiptap 3 + TableKit）的表格编辑体验：点击表格图标弹出"行列选择网格"按需建表；表格上提供悬浮的"+行/+列"按钮；支持单元格合并/拆分、单元格对齐。当前 TableKit 已注册但 UI 只有固定 2×2 插入 + 工具栏内的增删行列/表头/删表，且增删按钮全用同一个 Plus 图标无法区分，缺合并/拆分/对齐。

## What I already know

- 编辑器：`apps/desktop/src/components/file-types/rich-text/RichTextEditor.tsx`，Tiptap 3.29，已注册 `TableKit.configure({ table: { allowTableNodeSelection: true } })`。
- 工具栏：`RichTextToolbar.tsx`。已存在 `Insert table`（L195，硬编码 `insertTable({rows:2,cols:2,withHeaderRow:true})`）和 `tableButtons`（L204–215，仅在 `editor.isActive('table')` 时渲染，全用 Plus/Minus 图标）。
- 存储格式：Tiptap JSON（`.rt` 文件 = `JSON.stringify(getJSON())`），无 markdown 转换。`richTextContent.ts` 的 `stableStringify` 抗写回环。round-trip 测试已覆盖 tableCell/Row/Header 节点。
- TableKit 3 命令（已确认存在于 `@tiptap/extension-table` dist）：`insertTable({rows,cols,withHeaderRow})`、`addColumnBefore/After`、`addRowBefore/After`、`deleteColumn/Row/Table`、`mergeCells`、`splitCell`、`mergeOrSplit`、`toggleHeaderRow/Column/Cell`、`setCellAttribute(name,value)`、`setCellSelection({anchorCell,headCell})`、`goToNextCell/PreviousCell`、`fixTables`。
- TableCell 节点内置 `align` 属性（left/center/right），`renderHTML` 产出 `style: text-align: …`。对齐 = `setCellAttribute('align', 'left'|'center'|'right')`，读 = `editor.getAttributes('tableCell').align`。**无需额外扩展。**
- 多单元格选择由 TableKit 内置的 cell-selection 提供（鼠标拖拽跨格），`mergeCells` 需矩形多选；`editor.can().mergeCells()` 可用于禁用态。
- Table 选项 `resizable` 默认 false（当前未开），`lastColumnResizable` 默认 true。
- 样式：编辑器 className 里已有 `[&_.ProseMirror_table]:border-collapse` 等表格样式（RichTextEditor.tsx L141）。
- 工具栏图标来自 `lucide-react`；`UrlModal` 模式可复用做行列网格弹出。

## Requirements

1. **行列选择网格插入**：点击工具栏表格图标 → 弹出 N×M 网格（建议最大 8×8），鼠标悬停高亮所选行列数，显示"3×3"文字提示，点击确认后 `insertTable({rows,cols,withHeaderRow:true})`。Esc/点外关闭。
2. **表格上的悬浮"+行/+列"按钮**：光标在表格内时，在行末/列末显示 `+` 按钮，点击在该位置之后插入行/列（`addRowAfter` / `addColumnAfter`）。
3. **合并/拆分**：工具栏表格区增加 Merge cells / Split cell 按钮，仅当可执行时启用（`editor.can().mergeCells()` / `can().splitCell()`）。可统一用 `mergeOrSplit` 单按钮，或拆成两按钮。
4. **单元格对齐**：工具栏表格区增加 左/中/右 三个对齐按钮，调用 `setCellAttribute('align', …)`，active 态读 `getAttributes('tableCell').align`。
5. **表头切换完善**：现有 `toggleHeaderRow` 保留，补 `toggleHeaderColumn`、`toggleHeaderCell`（可选）。
6. **图标可区分**：把现有 tableButtons 里全 Plus/Minus 的按钮换成各自语义图标（`Rows3`/`Columns3`/`Plus`/`Trash2` 等 lucide），title 文案区分。
7. **键盘 Tab 跨格**：`goToNextCell` 已是 TableKit 默认 Tab 行为，确认不破坏即可（不在本任务范围扩展）。

## Acceptance Criteria

- [ ] 点击表格图标弹出网格，悬停高亮 + 尺寸提示，点击插入对应行列的表，含表头行。
- [ ] 光标进入表格后，行末/列末出现 `+` 按钮，点击正确插入行/列。
- [ ] 选中多个单元格后 Merge 按钮可用，合并成功；光标在合并单元格时 Split 按钮可用，拆分成功。
- [ ] 左/中/右对齐按钮改变当前单元格 `text-align`，active 态正确高亮，存盘后重开保持。
- [ ] 现有 round-trip 测试仍通过；新增 merge/split/align 产出的 JSON 能 serialize/deserialize 往返。
- [ ] lint / typecheck 通过。

## Definition of Done

- 测试更新（round-trip 覆盖 align/colspan/rowspan 节点；网格交互如难单测则手动验）。
- lint / typecheck / vitest 绿。
- 不破坏现有 anti-write-back-loop 与 slash 菜单。

## Technical Approach

- **网格弹出**：复用 `UrlModal` 的 fixed overlay 模式，写一个 `TableSizeGrid` 组件（8×8 格子 + 尺寸提示），替换 L195 的 onClick。
- **合并/拆分/对齐/表头**：纯工具栏按钮 + TableKit 命令，零新依赖。活跃态/禁用态走 `editor.isActive`/`editor.can()`。
- **表格上的悬浮 + 按钮**：实现方式见下方 ADR —— 用轻量 React overlay（监听 selection/transaction，定位到当前 table 的 DOM 末行末列），不写自定义 NodeView，避免重写 TableView。
- **样式**：补 `.ProseMirror` 内 selected-cell 高亮（`selectedCell` class 由 TableKit 加），在 RichTextEditor className 链里加 `[&_.selectedCell]:bg-accdim`。

## Decision (ADR-lite) — 已确认 Option A

**Context**: "表格上的 + 行/+列按钮"有两种实现路径，成本差 3 倍。
**Decision**: **Option A — React overlay**（用户已确认）。挂在编辑器外层的 overlay 组件，监听 `selectionUpdate`/`transaction`，光标在 table 内时用 DOM 查询定位当前光标所在 `table` 的末行末列 cell，在右下/右边缘渲染 `+` 按钮，点击调 `addRowAfter`/`addColumnAfter`。不写自定义 NodeView、不动 TableView。
**Consequences**: 按钮定位依赖 DOM 查询（`view.dom` 内当前 table 的末行末列），多表/滚动场景需确保只定位光标当前所在表（用 `editor.state.selection` 反查 table 节点 → 对应 DOM，而非 `querySelector` 取第一个）。约 80 行。

## Out of Scope

- 列宽拖拽调整（`resizable`）、列宽持久化（`colwidth`）。
- 单元格背景色 / 边框样式 UI（`setCellAttribute` 的其他属性）。
- Markdown 表格语法转换（`.rt` 是 JSON，不走 markdown）。
- 表格行/列拖拽重排。
- 复杂斜杠菜单的表格项（已有工具栏入口）。
- 跨表选择 / 嵌套表。

## Technical Notes

- 关键文件：
  - `apps/desktop/src/components/file-types/rich-text/RichTextToolbar.tsx`（网格弹窗 + tableButtons 扩展）
  - `apps/desktop/src/components/file-types/rich-text/RichTextEditor.tsx`（overlay 挂载点 + className 补 selectedCell）
  - `apps/desktop/src/components/file-types/rich-text/richTextContent.ts` / `rich-text-roundtrip.test.ts`（往返断言）
- 命令速查：`editor.chain().focus().mergeCells().run()` / `.splitCell()` / `.setCellAttribute('align','center')` / `.toggleHeaderColumn()` / `.toggleHeaderCell()`。
- 活跃态：`editor.getAttributes('tableCell').align === 'center'`。
- 可执行态：`editor.can().mergeCells()`、`editor.can().splitCell()`。
