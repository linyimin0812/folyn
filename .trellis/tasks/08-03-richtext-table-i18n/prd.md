# 富文本表格提示国际化

## Goal

把表格编辑相关的所有用户可见文案（工具栏"插入表格"按钮 title、行/列 hover 手柄 title、行/列 hover 菜单项、单元格右键菜单项）从硬编码英文改为 `editor:table.*` 命名空间下的 i18n key，覆盖 zh/en。其他工具栏按钮（Bold/Italic 等）不在本任务范围。

## What I already know

- i18n 体系：`apps/desktop/src/i18n/locales/{en,zh}/<namespace>.json`，扁平 key 树，zh/en 必须同构（`extracted-namespaces.test.ts` 强制校验）。
- 命名空间列表含 `editor`（`NAMESPACES` 数组），已有 `editor:slashMenu.richText.triggerButton` 在 `RichTextToolbar` 中使用，pattern 已落地。
- React 组件用 `useTranslation()` hook，store/服务层用 `i18n` 单例。本任务全在 React 组件，用 hook。
- 命名空间前缀强制：`t('editor:table.xxx')`，不能省 `editor:`。
- 现有硬编码文案位置：
  - `RichTextToolbar.tsx`：`title="Insert table"`（L240）
  - `TableControlsOverlay.tsx`：`title="Row actions"` / `title="Column actions"`、openRowMenu/openColMenu 内 8 个 label
  - `RichTextEditor.tsx`：`cellCtxItems` 数组 9 个 label
  - `TableSizeGrid.tsx`：仅 `{r} × {c}` 数字 + aria-label，数字/符号无需 i18n，跳过。

## Requirements

1. 在 `apps/desktop/src/i18n/locales/en/editor.json` 和 `zh/editor.json` 顶层加 `table` 节点，子节点 `insertButton` / `handle` / `rowMenu` / `colMenu` / `cellMenu`，zh/en 同构。
2. `RichTextToolbar.tsx`：`title="Insert table"` → `t('editor:table.insertButton.title')`。`useTranslation` hook 已在文件中 import，直接用。
3. `TableControlsOverlay.tsx`：加 `useTranslation`，handle title + 8 个 menu label 全部走 `t('editor:table.rowMenu.*'/'colMenu.*'/'handle.*')`。
4. `RichTextEditor.tsx`：加 `useTranslation`，`cellCtxItems` 9 个 label 全部走 `t('editor:table.cellMenu.*')`。
5. `TableSizeGrid.tsx`：跳过（数字 + "×" 符号通用）。
6. zh/en 同构：`extracted-namespaces.test.ts` 必须绿。

## Acceptance Criteria

- [ ] 切换 zh 时，工具栏表格按钮 title、行/列 hover 手柄 title、行/列 hover 菜单项、单元格右键菜单项全部显示中文。
- [ ] 切换 en 时全部显示英文。
- [ ] `extracted-namespaces.test.ts` 通过（zh/en key 树同构）。
- [ ] typecheck / vitest 绿。

## Out of Scope

- 其他工具栏按钮（Bold/Italic/Heading 等）的 i18n——单独任务。
- 表格 hover 菜单分隔符 `---`（结构标记，非文案）。
- `TableSizeGrid` 的 `r × c` 数字标签。

## Technical Notes

- 关键文件：
  - `apps/desktop/src/i18n/locales/en/editor.json` + `zh/editor.json`：加 `table` 节点。
  - `apps/desktop/src/components/file-types/rich-text/RichTextToolbar.tsx`：1 处 title。
  - `apps/desktop/src/components/file-types/rich-text/TableControlsOverlay.tsx`：2 处 title + 8 处 label。
  - `apps/desktop/src/components/file-types/rich-text/RichTextEditor.tsx`：9 处 label。
- key 树设计：
  ```json
  "table": {
    "insertButton": { "title": "Insert table" },
    "handle": { "rowActions": "Row actions", "colActions": "Column actions" },
    "rowMenu": {
      "insertAbove": "Insert row above",
      "insertBelow": "Insert row below",
      "delete": "Delete row",
      "toggleHeader": "Toggle header row"
    },
    "colMenu": {
      "insertLeft": "Insert column left",
      "insertRight": "Insert column right",
      "delete": "Delete column",
      "toggleHeader": "Toggle header column"
    },
    "cellMenu": {
      "merge": "Merge cells",
      "split": "Split cell",
      "alignLeft": "Align left",
      "alignCenter": "Align center",
      "alignRight": "Align right",
      "toggleHeaderCell": "Toggle header cell",
      "deleteTable": "Delete table"
    }
  }
  ```

## Decision (ADR-lite)

**Context**: 表格文案分散在 3 个组件，全硬编码英文。
**Decision**: 集中到 `editor:table.*` 子树，按触发位置（insertButton/handle/rowMenu/colMenu/cellMenu）分组。仅 i18n 表格文案，其他工具栏按钮留下个任务。
**Consequences**: zh/en 两份 locale 文件各加 ~18 个 key。`TableControlsOverlay` 和 `RichTextEditor` 各加 `useTranslation` hook 调用（极小开销）。
