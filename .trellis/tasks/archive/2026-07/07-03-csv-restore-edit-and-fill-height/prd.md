# csv: restore edit + fill height

## Goal

恢复 CSV 编辑能力（CodeMirror raw 编辑 + file-viewer 表格预览 + split），并让 CSV（及 office 类）预览撑满页面高度，不再挤一起。

## What I already know

- CSV 现归 office handler（`office/index.ts` extensions 含 'csv'），office handler `useCodeMirror:false`、`supportedViewModes:['preview']` → 无编辑。
- `tab.fileType` 存 handler id。CSV 文件 fileType='office' → PreviewPane `isCsv`（fileType==='csv'）不成立 → 走 markdown padding wrapper（`pt-2 px-8 pb-[80vh]`）→ file-viewer 无 bounded height → 挤一起。
- OfficeFileViewer：`h-full w-full` + `<FileViewer style={{height:'100%'}}>`——需父容器给高度。
- file-viewer 的 spreadsheet renderer（preset-office）可承接 csv 预览；CodeMirror 可编辑 raw CSV 文本（content string）。

## Requirements

- 新 csv handler `components/file-types/csv/index.ts`：`id:'csv'`、`extensions:['csv']`、`useCodeMirror:true`、`needsFileContent:true`、`supportedViewModes:['split','edit','preview']`、`Preview: CsvFileViewerPreview`。
- office handler `extensions` 移除 `'csv'`（csv 由 csv handler 接管）。
- 新 `CsvFileViewerPreview.tsx`：用 `content`（string）→ `new File([content], fileName, {type:'text/csv'})` → `<FileViewer file={file} options={{preset: officePreset}} style={{height:'100%'}} />`。容器 `h-full w-full overflow-hidden`。不读 Tauri FS（content 已有）。
- PreviewPane：`isCsv` 扩展为 `fullBleed = fileType==='csv' || fileType==='office'`，两者都用 `h-full overflow-auto` 无 padding wrapper。
- CSV 文件树图标（FileIcon `csv` 映射）保留。

## Acceptance Criteria

- [ ] csv 文件可编辑（edit 模式 CodeMirror raw）、可预览（file-viewer 表格）、可 split。
- [ ] csv 预览撑满页面高度（无 padding 留白、不挤）。
- [ ] office（docx/xlsx/pptx/pdf）预览也 full-bleed 撑满。
- [ ] csv tab 图标仍为 csv。
- [ ] tsc + vitest + vite build 绿。

## Out of Scope

- 不恢复自建 CsvTablePreview（预览仍用 file-viewer）。
- 不动 office handler 的其它扩展名（除移除 csv）。
- 不做可编辑单元格（inline cell editing）。

## Technical Notes

- 新建 `components/file-types/csv/index.ts` + `CsvFileViewerPreview.tsx`。
- 改 `components/file-types/office/index.ts`（移除 'csv'）+ `components/work-area/PreviewPane.tsx`（fullBleed 条件）。
