# csv preview: always show grid, fill page (empty-data too)

## Goal

CSV 预览始终显示表格网格铺满页面：空文件不再显示"CSV 为空"文字，而是渲染铺满页面的空网格（Excel 新建表风格）；数据行少时下方用空行网格填满到页底。

## What I already know

- `CsvTablePreview.tsx`：空内容（`rows.length===0`）返回"CSV 为空或无法解析"提示；有数据时仅渲染数据行，行少则下方留白。
- 外层 `h-full w-full overflow-auto bg-panel`，表 `w-full border-collapse`，单元格 `border border-brd2`，表头 sticky。
- PreviewPane csv 分支已 full-bleed（无 padding）。

## Requirements

- 空内容也渲染表格网格（不再显示空状态文字）。
- 列数 = `max(数据最大列数, MIN_COLS=10)`；每行用空串补齐到该列数。
- 行数：`max(数据体行数, MIN_ROWS=60)`——数据行之后用空行填充到 MIN_ROWS，保证铺满视口并向下滚动。
- 空文件：渲染空表头行（MIN_COLS 个空 th）+ MIN_ROWS 个空体行。
- 表头仍 sticky；体行仍斑马；单元格仍全边框。
- 数据行 cell 内容不变；填充行 cell 为空串。

## Acceptance Criteria

- [ ] 空 CSV 显示铺满页面的空网格（无"CSV 为空"文字）。
- [ ] 少行 CSV 下方用空网格行填满到页底。
- [ ] 多行 CSV 正常滚动，无多余空行（空行仅用于填充不足视口的情况）。
- [ ] 表头 sticky、斑马、全边框不受影响。
- [ ] tsc + vitest 绿；更新 CsvTablePreview 测试（空内容不再返回 hint，而渲染 table）。

## Definition of Done

- tsc / vitest 绿；测试更新。
- 遵循 desktop frontend spec。

## Technical Approach

- `CsvTablePreview.tsx`：
  - `const MIN_COLS = 10; const MIN_ROWS = 60;`
  - `const colCount = Math.max(MIN_COLS, ...rows.map(r => r.length))`；`pad = (r) => { const out = r.slice(); while (out.length < colCount) out.push(''); return out; }`
  - header = rows.length ? pad(rows[0]) : Array(colCount).fill('')；bodyRows = rows.slice(1).map(pad)
  - fillerCount = Math.max(0, MIN_ROWS - bodyRows.length)；fillers = Array(fillerCount).fill(Array(colCount).fill(''))
  - 渲染 thead(header) + tbody(bodyRows ++ fillers)，每个 cell 用 cell || ''。
- 移除空状态 hint 分支（rows.length===0 也走表格渲染）。

## Out of Scope

- 不加行号列/列字母。
- 不做可编辑单元格。
- 不做视口高度动态测量（用固定 MIN_ROWS 兜底）。

## Technical Notes

- 改 `components/file-types/csv/CsvTablePreview.tsx` + 其测试。
