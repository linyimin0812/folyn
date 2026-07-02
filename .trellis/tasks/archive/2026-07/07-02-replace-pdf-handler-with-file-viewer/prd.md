# replace pdf handler with file-viewer

## Goal

PDF 预览改由 file-viewer（preset-office 的 pdf.js renderer）承接，移除 Quill 自建 PdfViewer。

## What I already know

- office handler（`components/file-types/office/index.ts`）已用 `OfficeFileViewer`（FileViewer），扩展名数组现不含 `pdf`。
- `components/file-types/pdf/{index.ts,PdfViewer.tsx}` 仅自引用。
- FileIcon `EXT_TO_THEME_ICON.pdf = 'pdf'`（文件树图标）、`HANDLER_TO_THEME_ICON.pdf = 'pdf'`（tab 图标，按 handler id）。

## Requirements

- office handler `extensions` 数组加 `'pdf'`。
- 删除 `components/file-types/pdf/` 目录。
- 保留 FileIcon 的 `pdf` 映射（.pdf 文件树仍显示 pdf 图标）。
- 不改 OfficeFileViewer（已能处理二进制 pdf）。

## Acceptance Criteria

- [ ] `.pdf` 由 office handler 承接，经 FileViewer 渲染。
- [ ] `components/file-types/pdf/` 删除。
- [ ] .pdf 文件树图标仍为 pdf。
- [ ] tsc + vitest 绿；vite build 成功。

## Out of Scope

- 不动 office handler 的其它扩展名。
- 不改图标映射。
- 运行时 Tauri 渲染需手动验证（同上任务）。

## Technical Notes

- 改 `components/file-types/office/index.ts` 一行 + 删 `pdf/` 目录。
