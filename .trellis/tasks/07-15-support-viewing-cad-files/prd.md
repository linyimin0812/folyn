# Support viewing CAD files

## Goal

在 Quill 桌面端增加 CAD 文件查看能力，复用现有 file-type handler 模式（参考 drawio/office/json）。

## What I already know

- 文件类型系统：`apps/desktop/src/components/file-types/<type>/index.ts` 导出 `FileTypeHandler`
- 每个 handler 声明 `extensions / supportedViewModes / Preview?/Editor?`
- `OfficeFileViewer` 用 `@file-viewer/react + preset-office` 处理 pdf/docx/xlsx/pptx
- Tauri 桌面端，可调系统命令/外部二进制
- `@file-viewer` 系列包不含 CAD renderer

## Open Questions

- Q1: 支持哪些 CAD 格式？（dwg/dxf/dgn/3D-step-stl）
- Q2: 仅预览还是允许编辑？
- Q3: 技术路线偏好？（JS lib 解析 / 调外部转换器 / 云服务）

## Assumptions (temporary)

- 先做预览，不做编辑
- DXF 优先（开放格式，JS 生态支持好）；DWG 后置

## Out of Scope (explicit)

- (待定)

## Technical Notes

- 候选 JS 库：dxf-parser、three-dxf、dxf-viewer、@mlightcad/dxf
- DWG 解析（ODA File Converter / LibreCAD CLI）需外部二进制
