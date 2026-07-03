# improve csv preview full-page all-columns

## Goal

CSV / XLSX / ODS 预览样式优化：表格撑满预览 pane 宽度、列等宽分布剩余空间。当前用 `@file-viewer/react` 第三方组件，其内部 spreadsheet renderer（基于 e-virt-table canvas 虚拟表）显式禁用了 width-fill（`widthFillDisable: true`），导致列只按原始宽度左对齐渲染、右侧留白。通过 `pnpm patch` 修改 renderer 源码，开启 e-virt-table 自带的剩余宽度平均分配逻辑。

## Background

- 之前 993d78b 提交尝试用 CSS 覆盖 `table/th/td` 选择器——**无效**，因为 CSV/XLSX/ODS 走的是 e-virt-table（canvas），DOM 里没有 `<table>` 元素。该 CSS 是死代码，本次需要清理。
- e-virt-table 的 `init()`（`index.es.js:4627-4629`）本来就有 "剩余宽度按 resizeNum 平均分配到可拉伸列" 的逻辑，但 renderer 在 `view.js:267` 给每个数据列设了 `widthFillDisable: true`，导致 `resizeNum = 0`，fill 逻辑不触发。
- `FileViewerSpreadsheetOptions` 没有暴露 width-fill 开关，无法通过官方 API 启用。
- 其他 renderer（PDF / Word / PPT / OFD）已经撑满容器，不需要处理。

## Requirements

- 用 `pnpm patch @file-viewer/renderer-spreadsheet@2.1.17` 创建补丁，修改 `dist/spreadsheet/view.js` 第 267 行：数据列的 `widthFillDisable: true` → `false`。
- 第 246 行的索引列（`INDEX_COLUMN_KEY`）保留 `widthFillDisable: true`，索引列宽度固定、不该被拉伸。
- 补丁文件提交到仓库 `patches/` 目录，`pnpm install` 时自动应用。
- 清理 993d78b 留下的死代码：
  - 删除 `apps/desktop/src/components/file-types/csv/csv-preview.css`
  - 还原 `apps/desktop/src/components/file-types/csv/CsvFileViewerPreview.tsx`（移除 `import './csv-preview.css'` 和 `csv-preview-container` class）
- 暗黑模式不需要额外处理：spreadsheet renderer 自带 `data-viewer-theme="dark"` 适配（见 `spreadsheet.js:38`）。

## Acceptance Criteria

- [ ] 3 列 CSV 预览：表格撑满 pane 宽度，3 列等宽分布剩余空间
- [ ] 50 列 CSV 预览：列宽超出容器时水平滚动；列宽不足容器时撑满
- [ ] XLSX 多列预览：撑满 pane 宽度
- [ ] ODS 预览：撑满 pane 宽度
- [ ] 索引列（最左侧行号列）宽度保持固定，不被拉伸
- [ ] 窗口缩放时，列宽动态重新分配
- [ ] `patches/@file-viewer+renderer-spreadsheet@2.1.17.patch` 文件存在并提交
- [ ] `pnpm install` 后 `node_modules` 里的 `view.js` 第 267 行是 `widthFillDisable: false`
- [ ] `csv-preview.css` 已删除，`CsvFileViewerPreview.tsx` 不再引用
- [ ] `tsc -b` clean
- [ ] Office 预览（PDF/Word/PPT/OFD）不受影响

## Definition of Done

- 补丁文件落地、pnpm install 验证通过
- `tsc -b` clean
- 视觉验证：3 列 CSV / 50 列 CSV / XLSX / ODS / 空文件 都撑满
- 死 CSS 清理完毕

## Technical Approach

1. `pnpm patch @file-viewer/renderer-spreadsheet@2.1.17` → 进入临时目录
2. 编辑 `dist/spreadsheet/view.js`：
   - 第 267 行 `widthFillDisable: true,` → `widthFillDisable: false,`（数据列）
   - 第 246 行（索引列）保持不变
3. `pnpm patch-commit <临时目录>` → 生成 `patches/@file-viewer+renderer-spreadsheet@2.1.17.patch`
4. 验证 `pnpm install` 后 `node_modules/.pnpm/@file-viewer+renderer-spreadsheet@2.1.17/.../view.js` 第 267 行是 `false`
5. 删除死代码：
   - `rm apps/desktop/src/components/file-types/csv/csv-preview.css`
   - 还原 `CsvFileViewerPreview.tsx`：移除 `import './csv-preview.css'`，把外层 div 的 className 从 `csv-preview-container h-full w-full overflow-hidden bg-panel` 改回 `h-full w-full overflow-hidden bg-panel`
6. 在 `package.json`（根或 apps/desktop）确认 `pnpm` 配置支持 `patches/`（pnpm 9 默认支持，无需额外配置）
7. 视觉验证 + tsc -b

## Out of Scope

- 替换 FileViewer 为自定义渲染器（CSV/XLSX/ODS 都继续用 FileViewer + patch）
- 单元格编辑
- 列宽手动拖拽（renderer 已有 `resizableColumns` 选项，本次不开）
- 虚拟滚动优化
- 暗黑模式额外 CSS（renderer 自带）

## Technical Notes

- 主修改文件：`node_modules/.pnpm/@file-viewer+renderer-spreadsheet@2.1.17/node_modules/@file-viewer/renderer-spreadsheet/dist/spreadsheet/view.js`（通过 pnpm patch 持久化）
- 补丁输出：`patches/@file-viewer+renderer-spreadsheet@2.1.17.patch`
- e-virt-table fill 逻辑：`node_modules/.pnpm/e-virt-table@1.4.2/.../index.es.js:4619-4630`（`fillContainer` + `resizeAllColumn` 调用）
- 死 CSS 清理：`apps/desktop/src/components/file-types/csv/csv-preview.css`、`apps/desktop/src/components/file-types/csv/CsvFileViewerPreview.tsx`
- Office 预览同用 FileViewer 但不同 renderer，patch 不影响
- 挂载点：`apps/desktop/src/components/work-area/PreviewPane.tsx`（CSV 分支已有 `flex-1 h-full overflow-auto`）

## Risks

- 升级 `@file-viewer/renderer-spreadsheet` 版本时 patch 可能冲突，需要重新跑 `pnpm patch`。建议在 `package.json` 锁定 `2.1.17`（不要用 `^`）。
- e-virt-table 内部 API 变化（`widthFillDisable` 字段名改、`resizeAllColumn` 逻辑改）会导致 patch 失效。需要在使用此 patch 的 README 或 spec 中记录依赖约束。
