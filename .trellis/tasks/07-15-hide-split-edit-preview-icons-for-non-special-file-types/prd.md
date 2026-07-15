# Hide split/edit/preview icons for non-special file types

## Goal

Topbar 的 split/edit/preview 图标段当前用黑名单控制，仅对 image/pdf/code/web/drawio 隐藏；其余 csv/mmap/dbml/html/clip/office/excalidraw 仍会显示。改为白名单：只有支持多模式切换的文件类型显示图标段，其余隐藏。

## Requirements

- Topbar 改为白名单：仅 `markdown / json / csv / mmap / dbml / html` 显示 split/edit/preview（html 走 HTML_MODES）图标段
- 其余文件类型（office/image/pdf/clip/code/web/drawio/excalidraw 等）隐藏整个图标段
- `PREVIEW_ONLY_FILE_TYPES` 逻辑可移除（白名单已覆盖）

## Acceptance Criteria

- [ ] 打开 markdown/json/csv/mmap/dbml 文件 → Topbar 显示 split/edit/preview 三按钮
- [ ] 打开 html 文件 → Topbar 显示 preview/source/visual 三按钮
- [ ] 打开 office/image/pdf/clip/code/web/drawio/excalidraw 文件 → Topbar 图标段完全隐藏
- [ ] 切换 tab 时图标段按当前 tab 的 fileType 正确显示/隐藏

## Definition of Done

- 类型检查通过
- 现有测试未破坏

## Technical Approach

将 `HIDE_VIEW_MODE_FILE_TYPES` 黑名单替换为 `SHOW_VIEW_MODE_FILE_TYPES` 白名单，条件由 `!hideViewMode` 改为 `showViewMode`。移除 `PREVIEW_ONLY_FILE_TYPES` 与对应分支（白名单下 preview-only 类型本就不显示，按钮也不会被渲染）。

## Out of Scope

- 不修改各 handler 的 supportedViewModes
- 不修改 WorkArea 的 viewMode 重置逻辑

## Technical Notes

- 关键文件：`apps/desktop/src/components/shell/Topbar.tsx:11` (黑名单定义)、`Topbar.tsx:101` (渲染条件)、`Topbar.tsx:70-71` (isPreviewOnly/hideViewMode 派生)
