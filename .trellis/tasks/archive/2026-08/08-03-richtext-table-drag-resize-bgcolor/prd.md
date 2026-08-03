# 富文本表格：拖拽重排 + 列宽拖拽 + 单元格背景色

## Goal

把之前三个 out-of-scope 项补上：行/列拖拽重排（用 prosemirror-tables 的 `moveTableRow`/`moveTableColumn` 命令）、列宽拖拽（`TableKit` 的 `resizable: true` 一键开 + colwidth 自动持久化）、单元格背景色（自定义 TableCell 扩展加 `background` attr + 右键菜单颜色选择）。

## What I already know

- `prosemirror-tables@1.8.5`（`@tiptap/pm/tables` 重导出）导出：
  - `moveTableRow({from, to})` / `moveTableColumn({from, to})`：ProseMirror Command，按索引移动行/列。签名 `(options): Command`，调用方式 `cmd(editor.state, editor.view.dispatch.bind(editor.view))`。
  - `columnResizing` 插件：列宽拖拽 handle，colwidth 存到 tableCell 节点的 `colwidth` 属性。
- `TableKit.configure({ table: { allowTableNodeSelection, resizable } })`：`resizable: true` 即开 columnResizing 插件。className 已有 `[&_.ProseMirror_.column-resize]:cursor-col-resize`。
- Tiptap TableCell 节点内置 attrs：`colspan` / `rowspan` / `colwidth` / `align`。**无 `background` attr**——需要自定义扩展。
- TableKit 是 Extension，`addExtensions()` 按 `options.{tableCell, tableHeader, tableRow, table} !== false` 决定是否注册。设 `tableCell: false` 即可禁用内置，单独注册自定义 TableCell。
- `setCellAttribute(name, value)` 是 TableKit 命令，对当前 cell selection 的所有 cell 设 attr——要求 attr 在 schema 中声明。
- 现有：行/列 hover 手柄（`data-table-handle`，`TableControlsOverlay.tsx`），右键菜单（`RichTextEditor.tsx` 的 `cellCtxItems`），i18n `editor:table.*` 子树。
- round-trip 测试在 `rich-text-roundtrip.test.ts`，覆盖 tableCell/Row/Header 节点。colwidth 作为 cell attr 应自动往返（不需要改 serializer）。

## Requirements

1. **列宽拖拽**：`TableKit.configure({ table: { allowTableNodeSelection: true, resizable: true } })`。colwidth 自动持久化到 `.rt` JSON。验证 round-trip 测试 + 新增一个 colwidth 往返断言。
2. **单元格背景色**：
   - 创建 `RichTextTableCell` 扩展，继承 Tiptap `TableCell`，加 `background` attr（`parseHTML`: `el.style.backgroundColor`，`renderHTML`: `attrs.background ? { style: 'background-color: ' + bg } : {}`）。
   - 同样扩展 `TableHeader`（让表头也能着色）。
   - `TableKit.configure({ tableCell: false, tableHeader: false })` + 注册自定义 cell/header。
   - 右键 cell context menu 加"Background color"项：点击打开 `<input type="color">` 选择器（ponytail: 原生 over lib），确认时 `editor.chain().focus().setCellAttribute('background', color).run()`。加"Clear background"项 → `setCellAttribute('background', null)`。
   - i18n key：`editor:table.cellMenu.bgColor` / `editor:table.cellMenu.clearBg`。
3. **行/列拖拽重排**：
   - 行/列 hover 手柄 `draggable` + `onDragStart`：捕获 source row/col index（DOM `tr.rowIndex` / cell `cellIndex`），存到 `dataTransfer`。
   - wrapper `onDragOver`：target 在 table 内时 `e.preventDefault()`（允许 drop），高亮目标行/列（可选，MVP 跳过高亮）。
   - wrapper `onDrop`：从 `dataTransfer` 取 source index，从 drop target 算 target index，调 `moveTableRow({from, to})` 或 `moveTableColumn({from, to})` 作为 PM Command（直接 `cmd(editor.state, editor.view.dispatch.bind(editor.view))`）。
   - i18n：拖拽无新文案，跳过。
4. **样式**：className 链补 `[&_.ProseMirror_td[style*="background"]]:...` 不需要——浏览器原生渲染 `background-color` style。可选加 `.selectedCell` 之上 z-index 兼容。

## Acceptance Criteria

- [ ] 列宽：拖动列间分隔线改变列宽，存盘重开保持。
- [ ] 单元格背景色：右键 cell → 选背景色 → cell 渲染该色；"Clear" 项恢复透明；存盘重开保持。
- [ ] 行拖拽：拖动行手柄到另一行 → 整行内容移动到目标位置。
- [ ] 列拖拽：同理列。
- [ ] `moveTableRow`/`moveTableColumn` 在合并单元格场景：边界情况下不崩（可接受不完美）。
- [ ] round-trip 测试新增 colwidth + background 断言通过。
- [ ] `editor` 命名空间 zh/en key 树同构（加 bgColor/clearBg）。
- [ ] typecheck / vitest 绿。

## Out of Scope

- 行/列拖拽时的视觉高亮（drop indicator）——MVP 不做。
- 自定义颜色面板（swatch palette）——用原生 `<input type="color">`。
- 表格全局样式（边框、条纹）——单独任务。

## Technical Notes

- 关键文件：
  - `RichTextEditor.tsx`：TableKit 配置加 `resizable: true` + `tableCell: false` + 注册自定义 cell/header；wrapper 加 `onDragOver`/`onDrop`；`cellCtxItems` 加 bgColor 项。
  - `TableControlsOverlay.tsx`：行/列手柄加 `draggable` + `onDragStart`。
  - 新文件 `RichTextTableCell.tsx`：TableCell + TableHeader 扩展，加 `background` attr。
  - `rich-text-roundtrip.test.ts`：加 colwidth + background 往返断言。
  - `i18n/locales/{en,zh}/editor.json`：`table.cellMenu.bgColor` / `clearBg`。
- `moveTableRow`/`moveTableColumn` 调用样板：
  ```ts
  import { moveTableRow, type Command } from '@tiptap/pm/tables';
  const cmd: Command = moveTableRow({ from: srcRow, to: dstRow });
  cmd(editor.state, editor.view.dispatch.bind(editor.view));
  ```
- 拖拽 source/target 索引：用 `tr.rowIndex`（HTMLTableRowElement）和 cell.cellIndex（HTMLTableCellElement）。colspan/rowspan 边界用 `moveTableColumn`/`moveTableRow` 自身处理（prosemirror-tables 内部 clip）。

## Decision (ADR-lite)

**Context**: 三个独立表格能力，各自有现成底座（columnResizing 插件、moveTable* 命令、setCellAttribute）。
**Decision**: 都走原生底座，不重新发明。bgColor 需要自定义 TableCell 因为 Tiptap 默认无 `background` attr。drag reorder 用 HTML5 拖拽 + DOM 索引（不写 NodeView）。
**Consequences**: 一个新扩展文件 `RichTextTableCell.tsx`（~40 行）；TableControlsOverlay 加 dragstart（~15 行）；RichTextEditor 加 drop handler（~30 行）+ bgColor 菜单项（~10 行）；TableKit config 改 3 处。round-trip 测试加 2 个断言。
