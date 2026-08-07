# PlantUML file-preview shows source when plugin absent

## Goal

`:::file-preview{src="*.puml"}` 在未安装 plantuml 插件时，应直接显示源码（CodeFileViewer），而不是被 `office` handler 接管走 OfficeFileViewer（结果空白/报错）。装了插件时，仍走 plantuml handler 渲染 SVG。

## What I already know

* `MarkdownPreview.tsx:458` 的 `renderFile(path, content)`：`getHandlerByExtension(ext)` → 取到 handler 就用其 `Preview`；取不到则 fallback `getHandlerById('code').Preview`（`CodeFileViewer`，源码高亮）。
* `office/index.ts:34` 把 `'plantuml'`、`'puml'` 列入 extensions（office handler）。`.pu` 不在内（已会 fallback 到 code）。
* 装了 plantuml 插件时，插件 handler 经 `HandlerRegistry` 的 extMap 覆盖式注册接管这三种扩展名（PRD `08-06-plantuml-file-viewer-plugin`）。
* 未装插件时：`getHandlerByExtension('puml')` 命中 office handler → `OfficeFileViewer` 尝试用 `@file-viewer/react` 渲染 puml，无对应 renderer → 报错/空白。这就是当前不良体验。
* `detectFileType` (`editorStore.ts:24`) 在无 handler 时 fallback 到 `'code'`，所以直接打开 .puml 文件本身没有问题（已走 CodeFileViewer）—— 只有 `:::file-preview` 受影响，因为 office handler 抢先匹配。

## Assumptions (temporary)

* office handler 当初收纳 puml/plantuml 是为了"未装插件时也能给个 office-ish 只读预览"，但 OfficeFileViewer 实际并不支持这两种格式，等于死代码。
* 删掉 office 对这两个扩展名的接管不会破坏既有测试（grep 未发现 `office.*puml` 断言）。

## Open Questions

* （已解决）选 A：从 office 删除 `plantuml`/`puml` 扩展名。

## Requirements (evolving)

* 未装 plantuml 插件时，`:::file-preview` 对 `.puml` / `.plantuml` / `.pu` 显示源码（CodeFileViewer，带 highlight.js 高亮）。
* 装了 plantuml 插件时，`:::file-preview` 仍渲染 SVG（plugin handler 通过 extMap 覆盖接管）。
* 不破坏直接打开 .puml 文件已有的 source view 行为。

## Acceptance Criteria (evolving)

* [ ] 未装 plantuml 插件时，markdown 中 `:::file-preview{src="foo.puml"}` 显示 foo.puml 源码（不是空白/office 报错）。
* [ ] 同上对 `.plantuml` 后缀生效。
* [ ] 装上 plantuml 插件后，同一 directive 渲染 SVG（回归）。
* [ ] `pnpm lint` / typecheck / 既有测试绿。

## Definition of Done

* Tests added/updated（office extensions 不再含 puml/plantuml 的回归测试，或 renderFile fallback 路径单测）。
* Lint / typecheck / build green。
* 不改动 plantuml 插件本身。

## Out of Scope

* 离线 plantuml 渲染方案。
* 修改 plantuml 插件 manifest 或 handler。
* 给 .puml 加专门图标（仍走 code handler 默认图标）。

## Technical Notes

* 入口：`apps/desktop/src/components/file-types/office/index.ts:34`。
* Fallback 链路：`MarkdownPreview.tsx:461` → `getHandlerById('code').Preview` = `CodeFileViewer`（`code/CodeFileViewer.tsx`）。
* 直接打开文件路径：`editorStore.ts:24` `detectFileType` 已 fallback `'code'`，无需改。
* HandlerRegistry extMap 覆盖语义：`HandlerRegistry.ts:24`（插件装上后 plantuml handler 覆盖 office 的 puml/plantuml extMap 项）。

## Decision (ADR-lite)

**Context**: office handler 收纳了 `plantuml`/`puml` 但 OfficeFileViewer 不支持这两种格式，等于死代码且拦截了 code fallback。

**Decision**: 选 A——从 `office/index.ts` extensions 列表删除 `'plantuml'`、`'puml'`。最小 diff，根因修复；所有 caller（MarkdownPreview.renderFile、detectFileType、FileIcon、editorIoService 等）一致 fallback 到 code handler。

**Consequences**:
- 未装 plantuml 插件时 `.puml`/`.plantuml` 文件图标变成 code 图标（原来是 office 图标）—— 可接受，更贴合实际渲染。
- 装了 plantuml 插件时 plantuml handler 经 extMap 覆盖接管，行为不变。
- `.pu` 本来就不在 office 列表，无需改。
- office 列表里仍可能有其他无 renderer 的死扩展名（如 mmd）—— 留作后续清理，本任务不动。

## Implementation Plan

* PR1（单步）：从 `apps/desktop/src/components/file-types/office/index.ts:34` 的 `Mindmap / drawing (read-only)` 行删除 `'plantuml'`、`'puml'`，保留 `'xmind'`、`'mmd'`。跑 lint / typecheck / test。
