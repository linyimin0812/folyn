# file-preview directive hides source when no preview handler

## Goal

`:::file-preview{src="..."}` 指令在目标文件没有 Preview handler 时（如 `.drawio` 这类只有 Editor 的类型），当前会兜底把源文件内容原样 dump 到 `<pre>` 里——用户体验上等于"预览变源码"。改成：无 Preview 时不默认显示源码，给出"无预览"提示 + 跳转到源文件的入口 + 默认收起的"显示源码"折叠区。

## What I already know

- `FilePreviewPlugin.tsx:94-117` 当前结构：`ctx.renderFile(src, content)` 返回非空 → 渲染预览；否则 fall through 到 `<pre>{content}</pre>` 显示源码。
- `MarkdownPreview.tsx:219-226` 中 `renderFile` 通过 `getHandlerByExtension(ext)` 找 handler，没有 `handler.Preview` 就 return null。
- `file-types/drawio/index.ts:5-14` 只有 `Editor`（DrawioEditor），没有 `Preview`，`supportedViewModes: ['edit']`。
- `file-types/mmap/index.ts` 有 `Preview: MmapFileViewerPreview`，不会走兜底——drawio 才是主要受影响类型。
- markdown / dbml / csv / code / json / html / image / clip / office / web 有 Preview handler（excalidraw 走 `img` 分支，不经过 file-preview）。
- "跳转到源文件 ↗" 按钮已经存在（`FilePreviewPlugin.tsx:73-89`），但目前只在有 `ctx.openFile` + `src` 时显示。

## Decision (ADR-lite)

**Context**: `:::file-preview` 在无 Preview handler（典型如 `.drawio`）时直接 `<pre>{content}</pre>` dump 源码，与"预览"语义冲突。
**Decision**: 选方案 B —— 无 Preview 时显示"此类型暂无预览" + "跳转到源文件 ↗"按钮 + 默认收起的"显示源码"折叠区。保留高级用户查看原文本的能力，但默认不泄漏。
**Consequences**: 多一个 `useState` toggle 和一层 `<details>` 或受控折叠 UI。后续若加 drawio Preview 组件，该折叠区自然无人展开，无需提前移除。

## Requirements (evolving)

- `:::file-preview` 在目标文件没有 Preview handler 时，默认不显示源文件内容。
- 兜底 UI 显示"此类型暂无预览"提示；header 始终提供 code 图标按钮（可切换 预览↔源码 视图）+ external-link 图标按钮（跳转到源文件）。
- 有 Preview handler 的类型默认渲染预览；用户可点 code 图标切到源码视图，再点切回预览。
- 无 Preview handler 的类型默认显示"此类型暂无预览"提示；用户可点 code 图标切到源码视图。
- header 中文件 icon 与文件名垂直居中对齐。
- 加载中、错误、未指定 src 等现有分支保持不变。
- `src="..."` 的 autocomplete：当 partial 是目录路径（含 `/`，含 `./` / `../` / 裸路径如 `分享/`）时，列出该目录下的直接子项（文件 + 目录，目录 `apply` 末尾带 `/` 便于继续钻取）；partial 末尾的段作为文件名过滤。无 `/` 时保持现有"全 vault 子串过滤"行为。

## Acceptance Criteria (evolving)

- [x] 在 md 里写 `:::file-preview{src="分享/test.drawio"}` 渲染时默认不显示 drawio XML 源码（`previewEl === null` → 无 `<pre>` 渲染）。
- [x] 上述情况显示"此类型暂无预览，可打开源文件查看"文案 + "跳转到源文件 ↗"按钮 + "显示源码 ▼"折叠开关。
- [x] 点击"显示源码"展开后，源码以 `<pre>` 形式呈现；再次点击（"收起源码 ▲"）收起。
- [x] "跳转到源文件 ↗"按钮沿用现有 openFile 逻辑（未改动）。
- [ ] `:::file-preview{src="some.md"}` 仍正常渲染 markdown 预览（无回归）——需手动验证。
- [ ] `:::file-preview{src="不存在的文件.md"}` 仍显示读取错误（无回归）——需手动验证。
- [x] header 中文件名前的图标按文件扩展名解析（通过 `VaultContext.getFileIcon`），未提供 resolver 时回退到 `📄` emoji。
- [x] header 右侧两个图标按钮：code 图标（始终可见，切换预览/源码视图）+ external-link 图标（沿用 openFile 逻辑，替换原"跳转到源文件 ↗"文字按钮）。
- [x] header 中文件 icon 与文件名垂直居中对齐（flex + alignItems: center，或 verticalAlign: middle）。
- [x] code 图标激活态（viewMode === 'source'）有视觉区分（高亮颜色或背景）。
- [x] viewMode === 'source' 时 body 渲染 `<pre>{content}</pre>`；viewMode === 'preview' 时按 has-Preview 分支渲染预览或"此类型暂无预览"提示。
- [ ] `:::file-preview{src="./"}` 在编辑器里光标在引号内时，弹出当前文档所在目录的直接子项列表（文件 + 目录）。——需手动验证。
- [ ] 选中目录项后 `src` 自动补到 `src="./<dir>/"`，光标继续在引号内时可继续钻取。——需手动验证。
- [ ] `src="分享/"` 列出 `分享/` 目录的直接子项。——需手动验证。
- [ ] `src="分享/dr"` 只列出 `分享/` 下以 `dr` 开头的子项。——需手动验证。
- [ ] 在 dev server 写 `:::file-preview{src="分享/test.drawio"}`，默认显示 drawio 图形（chromeless 只读 viewer）；点 code 图标切换到源码视图显示 drawio XML；点 external-link 图标在编辑器打开该文件；点 code 图标切回预览。——需手动验证。

## Definition of Done

- 代码改动限定在 `FilePreviewPlugin.tsx`（或必要的 VaultContext/renderFile 配套调整）。
- lint / typecheck 通过。
- 手动验证 drawio / mmap 无源码泄漏，markdown 预览无回归。

## Out of Scope (explicit)

- 不给 drawio 新增 Preview 组件（它的 Editor 体验才是主场景）。
- 不改 `renderFile` 的接口契约（保持 `null` 表示无 handler）。
- 不动 mermaid / excalidraw 这类已经在别的路径渲染的流程。
- 不加文件元信息展示（方案 C 已拒绝）。
- ~~不给 drawio 新增 Preview 组件~~（已撤销：drawio 现在加 Preview，渲染 chromeless 只读图形）。

## Technical Notes

- 关键文件：
  - `packages/container-plugins/src/plugins/FilePreviewPlugin.tsx:94-117`（兜底分支）
  - `apps/desktop/src/components/file-types/registry.ts:34-36`（getHandlerByExtension）
  - `apps/desktop/src/components/file-types/drawio/index.ts`（无 Preview 的典型案例）
- 涉及的已修改未提交文件：`FilePreviewPlugin.tsx` 已有 M（在前次会话里加过 VaultContext + openFile 按钮），本次继续在它上面改。
