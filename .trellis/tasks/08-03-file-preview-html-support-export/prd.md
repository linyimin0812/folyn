# file-preview html support export

## Goal

让 `:::file-preview{src="foo.html"}` 在 markdown 导出 HTML/PDF 时保留 html 预览内容,而不是落到"此文件类型内容不支持导出"兜底卡片。

## What I already know

- `apps/desktop/src/services/exportService.ts:296-331` 的 `processFilePreviews` 按 ext 走 REGISTRY,无匹配且 body 无 `<svg>` 时落到"不支持导出"卡片。
- REGISTRY 只注册了 dbml/excalidraw/drawio/mmap,html 未注册。
- HtmlPreview (`apps/desktop/src/components/file-types/html/HtmlPreview.tsx`) 渲染 `<iframe sandbox="allow-scripts" srcDoc=...>`,内容已自包含(bootstrap + 用户 HTML 都在 srcDoc 里)。
- srcDoc 不依赖外部资源(相对路径资源在 in-app 预览就已是局限,非导出回归)。

## Assumptions (temporary)

- 保留 iframe 包装(不内联到导出 body)是可接受的 —— 安全/样式隔离 > 视觉融合。
- iframe 的 sandbox 在导出的独立 HTML 文件中仍然生效,行为与 in-app 一致。

## Open Questions

(none — Approach A confirmed)

## Requirements

- markdown 含 `:::file-preview{src="*.html"}` 时,导出的 HTML 文件中该块以 iframe 形式保留 html 预览内容。

## Acceptance Criteria

- [ ] 导出包含 html file-preview 的 markdown 为 HTML,导出文件中 html 块显示预览内容(非"不支持导出"卡片)。
- [ ] iframe sandbox=allow-scripts 在导出文件中保留,与 in-app 行为一致。

## Definition of Done

- 类型/Lint 通过
- 导出 HTML 文件浏览器打开,html 块正常渲染

## Technical Approach

**Approach A: 保留 iframe (Confirmed)** — 在 `processFilePreviews` 兜底分支前加 `if (body.querySelector('iframe')) return;`,html 块原样保留 iframe。srcDoc 自包含,一行修复。

## Out of Scope

- html 预览内相对路径资源在导出中的修复(in-app 预览同样问题,单独处理)
- 其它 iframe 类预览类型的导出(本任务只确认 html)

## Technical Notes

- `apps/desktop/src/services/exportService.ts:282-332` REGISTRY + processFilePreviews
- `apps/desktop/src/components/file-types/html/HtmlPreview.tsx:1-13`
- `apps/desktop/src/components/file-types/html/injectPreviewBootstrap.ts` srcDoc 自包含
