# csv preview excel-style full-bleed

## Goal

CSV 预览改成 Excel 风格：full-bleed 铺满整个预览页，单元格全边框，表头置顶 sticky，行斑马。

## What I already know

- `CsvTablePreview.tsx` 当前：外层 `csv-table-preview h-full overflow-auto bg-panel p-4` + 内层 `overflow-x-auto rounded border border-brd2` + `table w-full border-collapse`；表头/单元格仅 `border-b`（无竖向网格线）。
- `PreviewPane.tsx:106`：preview 外层 `prev-body flex-1 overflow-auto pt-2 px-8 pb-[80vh]`——`px-8`/`pt-2`/`pb-[80vh]` padding 阻止 full-bleed。已有 `activeTab.fileType === 'markdown'` 分支先例。
- csv preview 经 `PreviewPane` 渲染（WorkArea:330）。

## Requirements

- `PreviewPane.tsx`：`activeTab.fileType === 'csv'` 时，preview 容器去掉 `px-8 pt-2 pb-[80vh]`，改 full-bleed（如 `h-full overflow-auto`，无 padding）。markdown 路径不变。
- `CsvTablePreview.tsx` 重样式：
  - 外层 `h-full w-full overflow-auto bg-panel`（去掉 `p-4`、去 rounded/border 卡片）。
  - 表 `w-full border-collapse text-sm`，`table-layout:auto`。
  - 单元格 `th`/`td`：`border border-brd2`（全网格线）+ `px-3 py-1.5` + `whitespace-nowrap` + `align-top`。
  - 表头 `thead th`：`sticky top-0 z-10 bg-hov font-semibold text-t1`。
  - 行斑马：`even:bg-hov/40`。
  - 空内容降级提示不变。

## Acceptance Criteria

- [ ] CSV 预览 full-bleed 铺满预览页（无两侧 px-8 留白、无卡片 padding）。
- [ ] 单元格四向边框（Excel 网格线）。
- [ ] 表头滚动时 sticky 置顶。
- [ ] 行斑马条纹。
- [ ] markdown 预览样式不受影响。
- [ ] tsc + vitest 绿。

## Definition of Done

- tsc / vitest 绿；更新 CsvTablePreview 测试（如有断言旧 className）。
- 遵循 desktop frontend spec。

## Technical Approach

- `PreviewPane`：加 `const isCsv = activeTab.fileType === 'csv'`；`prev-body` div 的 className 按 `isCsv` 切换（csv 用 `h-full overflow-auto`，其它保持原 `pt-2 px-8 pb-[80vh]`）。
- `CsvTablePreview`：去掉外层卡片 wrapper，直接 `overflow-auto` + table；单元格加全边框；表头 sticky。
- 不改 parser、不改 handler、不改 WorkArea。

## Out of Scope

- 不加 Excel 行号列(1,2,3)/列字母(A,B,C)。
- 不做可编辑单元格。
- 不做 sticky 首列。
- 不强行拉伸表格填满高度（行数少时下方留 panel bg）。

## Technical Notes

- 改 `components/work-area/PreviewPane.tsx`（容器按类型切 padding）+ `components/file-types/csv/CsvTablePreview.tsx`（样式）。
