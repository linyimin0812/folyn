# csv preview fill width

## Goal

CSV 预览表格自适应铺满可用宽度（小表格不再窄、右侧大片留白）。

## What I already know

- `components/file-types/csv/CsvTablePreview.tsx`：`<table className="w-auto border-collapse text-sm">`，外层 `overflow-x-auto`，单元格 `whitespace-nowrap`。
- `w-auto` 让表格按内容宽度收缩 → 小 CSV 不铺满。

## Requirements

- 表格 `w-full`（铺满容器宽度），`table-layout:auto`（默认）让列分配剩余宽度。
- 超宽（多列/长文本）仍 `overflow-x-auto` 横向滚动。
- 其它样式（边框、表头、斑马纹、cell nowrap）不变。

## Acceptance Criteria

- [ ] 小 CSV 表格铺满预览区宽度。
- [ ] 宽 CSV 仍可横向滚动。
- [ ] tsc + vitest 绿。

## Out of Scope

- 不改 parser。
- 不改 cell nowrap（保持列对齐）。
- 不做可编辑单元格。

## Technical Notes

- 改 `CsvTablePreview.tsx` 一处 className：`w-auto` → `w-full`。
