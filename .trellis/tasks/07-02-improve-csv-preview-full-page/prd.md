# improve csv preview full-page all-columns

## Goal

CSV 预览效果改进：显示真实列数（不强制最小 10 列）、表格铺满整个页面（宽 + 高）、空文件也显示空表格。

## Requirements

- 移除 `MIN_COLS = 10` 强制最小列数。显示 CSV 实际解析出的列数。
- 列数少时（如 3 列）列等宽撑满页面宽度；列数多时允许水平滚动。
- 空 CSV（0 行 0 列）显示 1 列 × N 行空表格。
- 表格高度填满预览视口：动态计算填充行数，而不是静态 `MIN_ROWS = 60`。
- 保留行交替色（`even:bg-hov/40`）、表头 sticky、边框等现有视觉。
- 空 CSV 有数据时也画表格（已部分满足，去掉 MIN_COLS 后需保证 1 列兜底）。

## Acceptance Criteria

- [ ] 3 列 CSV 渲染 3 列（不 padded 到 10），3 列等宽撑满页面宽度
- [ ] 50 列 CSV 渲染 50 列（不截断），允许水平滚动
- [ ] 空文件（0 字节）渲染 1 列 × 填满视口高度的空表格
- [ ] 1 行 CSV（只有表头）渲染表头 + 填充行填满视口高度
- [ ] 表格宽度铺满预览 pane（无右侧空白）
- [ ] 表格高度铺满预览 pane（无底部空白）
- [ ] 列数变化或窗口缩放时，填充行数动态调整
- [ ] `CsvTablePreview.test.tsx` 覆盖：3 列不 padded、空文件 1 列、等宽撑满 class

## Definition of Done

- 测试更新通过
- `tsc -b` clean
- 视觉验证：3 列 CSV / 50 列 CSV / 空文件 三种 case 都铺满页面

## Technical Approach

- 移除 `MIN_COLS`，`colCount = Math.max(1, ...rows.map(r => r.length))` —— 至少 1 列兜底
- `table-layout: fixed` + `w-full` 让列等宽撑满（列少时）；列多时 `overflow-auto` 横向滚动
- 动态填充行数：用 `ResizeObserver` 测容器高度，按行高（约 32px）算需要多少填充行。或简化方案：保留静态大数（如 200 行）+ CSS `min-h-full` 让表格至少撑满容器
- 简化路径（推荐 MVP）：去掉 MIN_COLS，保留 MIN_ROWS 但改大（如 100），加 `table-layout: fixed` + `w-full` + `min-h-full`。动态 ResizeObserver 留作 future enhancement

## Out of Scope

- 单元格内容编辑（CSV 预览保持只读）
- 列宽拖拽调整
- 行/列选择高亮
- CSV 大文件虚拟滚动（性能优化）

## Technical Notes

- 主文件：`apps/desktop/src/components/file-types/csv/CsvTablePreview.tsx`
- 测试：`apps/desktop/src/components/file-types/csv/CsvTablePreview.test.tsx`
- 解析器：`apps/desktop/src/utils/csvParse.ts`（RFC-4180，不改）
- 挂载点：`apps/desktop/src/components/work-area/PreviewPane.tsx`（CSV 分支已用 `h-full overflow-auto`，不需改）
