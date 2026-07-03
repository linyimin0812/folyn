# CSV 预览序号列宽度自适应

## Goal

CSV / XLSX / ODS 预览（基于 `@file-viewer/renderer-spreadsheet` + e-virt-table）中，最左侧的序号列（`__index`）当前固定为 `INDEX_COLUMN_WIDTH = 68`px，对只有几行的小文件来说过宽，挤占了数据列的可视空间。希望让序号列宽度根据总行数位数自适应，序号列只占刚好够显示最大序号的宽度。

## What I already know

- `INDEX_COLUMN_WIDTH = 68` 写死在 `dist/spreadsheet/view.js:3`，导出供 `buildColumns` 使用。
- `buildColumns(ws)` 在 `view.js:234` 构造列定义；序号列（`key: INDEX_COLUMN_KEY`）的 `width = minWidth = maxWidth = INDEX_COLUMN_WIDTH`，且 `widthFillDisable: true`（不参与宽度填充分配，固定占 68px）。
- `buildColumns(ws)` 接收的 `ws: SheetModel`，其 `ws.meta.totalRows` 给出总行数（见 `dist/spreadsheet/worker/type.d.ts:44`）。
- 当前已通过 pnpm patch 修改过 `@file-viewer/renderer-spreadsheet@2.1.17`（`patches/@file-viewer__renderer-spreadsheet@2.1.17.patch`），改动点：`TABLE_FONT_SIZE=12`、`HEADER_HEIGHT=22`、`HEADER_FONT=bold 12px`、数据列 `widthFillDisable: false`、`rowHeight=22`、`SCROLLER_TRACK_SIZE: 0`。
- `buildColumns` 唯一调用方：`dist/spreadsheet.js:1014`。
- 序号列实际渲染时由 e-virt-table 内部按列定义的 `width/minWidth/maxWidth` 处理，三值都设成同一值就锁死宽度不可拖拽。
- 字体使用 `BODY_FONT`（基于 `TABLE_FONT_SIZE=12`）。单字符宽度估算 ~8px（Aptos/Calibri 类无衬线 12px 数字字符 advance 宽度约 7-8px）。

## Requirements

- 序号列宽度根据 `ws.meta.totalRows` 的十进制位数动态计算，序号列只占"刚好够显示最大序号 + 适当 padding"的宽度。
- 公式（初稿）：`width = 16 (padding) + digits * 9 (digit advance @ 12px) `，`digits = max(1, String(totalRows).length)`，并 clamp 到 `[28, 80]` 防止极端值。
  - 1 位 → 25 → clamp 28
  - 2 位 → 34
  - 3 位 → 43
  - 4 位 → 52
  - 5 位 → 61
  - 6 位 → 70
  - 7 位+ → 79 → clamp 80
- 保持 `width = minWidth = maxWidth`（依然锁死，不可手动拖拽调整），只让默认宽度自适应。
- 保持 `widthFillDisable: true`（序号列不参与宽度填充，剩余空间全给数据列）。
- 同时作用于 CSV / XLSX / ODS（它们都走 `renderer-spreadsheet`）。
- 通过扩展已有的 pnpm patch 实现，不引入新的 patch 文件。

## Acceptance Criteria

- [ ] 2 行 CSV：序号列宽度 ~28px（视觉上比 68px 明显更窄，约等于"1"/"2"两字符宽度 + padding）。
- [ ] 1000 行 CSV：序号列宽度 ~52px（够显示"1000"四位数字）。
- [ ] 100000 行 CSV：序号列宽度 ~70px。
- [ ] 数据列总宽度 = 可视宽度 - 序号列宽度（序号列省下的空间全部分给数据列）。
- [ ] 拖拽列边界依然无效（保持锁死行为）。
- [ ] CSV / XLSX / ODS 三种类型表现一致。
- [ ] `pnpm -C apps/desktop exec tsc -b` 通过。

## Definition of Done

- `patches/@file-viewer__renderer-spreadsheet@2.1.17.patch` 扩展完成，`pnpm patch-commit` 重新生成。
- 视觉验证：CSV 预览中序号列不再过宽。
- spec 文档 `.trellis/spec/desktop/frontend/file-type-editors.md` 中 FileViewer Spreadsheet 段落补一行"序号列宽度按行数位数自适应"。
- `pnpm -C apps/desktop exec tsc -b` 通过。

## Technical Approach

在 `dist/spreadsheet/view.js` 中：

1. 把 `INDEX_COLUMN_WIDTH` 由常量改为函数：
   ```js
   export const computeIndexColumnWidth = (totalRows = 0) => {
     const digits = Math.max(1, String(totalRows || 1).length);
     return Math.min(80, Math.max(28, 16 + digits * 9));
   };
   ```
   保留 `INDEX_COLUMN_WIDTH = 68` 作为默认 fallback（其它地方如有引用不会崩）。
2. 在 `buildColumns(ws)` 内：
   ```js
   const indexWidth = computeIndexColumnWidth(ws.meta?.totalRows || 0);
   // ...columns[0] = { ..., width: indexWidth, minWidth: indexWidth, maxWidth: indexWidth, ... }
   ```
3. 通过 pnpm patch 重新生成 `patches/@file-viewer__renderer-spreadsheet@2.1.17.patch`。

## Out of Scope

- 不改 e-virt-table 的列宽拖拽行为（保持锁死）。
- 不引入按单元格内容自动测算宽度（auto-size 基于实际渲染度量，复杂度太高）。
- 不改表头高度 / 字号 / 行高等其它已调好的样式。
- 不改 sheet tab / toolbar 等周边 UI。

## Technical Notes

- 相关文件：
  - `node_modules/.pnpm/@file-viewer+renderer-spreadsheet@2.1.17.../dist/spreadsheet/view.js` — 改 `INDEX_COLUMN_WIDTH` 与 `buildColumns`。
  - `patches/@file-viewer__renderer-spreadsheet@2.1.17.patch` — 扩展补丁。
  - `apps/desktop/src/components/file-types/csv/CsvFileViewerPreview.tsx` / `office/OfficeFileViewer.tsx` — 不改，验证用。
  - `.trellis/spec/desktop/frontend/file-type-editors.md` — 文档补一行。
- 已记录的 spec 约定：FileViewer Spreadsheet Preview (CSV / XLSX / ODS) 段落中已写明 pnpm patch + `widthFillDisable: false` 的 gotcha。
