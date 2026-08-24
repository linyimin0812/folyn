# add-graphviz-file-type

## Goal

为 Folyn 添加 Graphviz（DOT 语言）文件类型支持，参考 plantuml 的实现模式：在线服务器渲染 SVG、支持伸缩、支持 `:::file-preview{src="*.gv"}` 和 ` ```graphviz ` / ` ```dot ` 代码块预览、SVG 导出。

## What I already know

参考 plantuml 实现（已完成）的代码结构：

- `packages/container-plugins/src/plantuml/encode.ts` — PlantUML 文本编码（deflate-raw + 自定义 base64）
- `packages/container-plugins/src/plugins/PlantUmlPlugin.tsx` — `usePlantUmlSvg` hook + `PlantUmlBlock` 内联渲染器
- `apps/desktop/src/components/file-types/plantuml/{index.tsx,PlantUmlPreview.tsx}` — 文件类型处理器 + ZoomPanCanvas 预览
- `apps/desktop/src/services/export/plantuml.ts` — 导出增强（重新拉取 SVG 注入 body）
- `apps/desktop/src/services/registerBuiltinCodeContributions.ts` — 注册 builtin 代码 fence 渲染器
- `apps/desktop/src/services/exportService.ts` — 注册到 REGISTRY
- `apps/desktop/src/services/export/shared.ts` — `renderFilePreviewToSvg` 优先读 `data-raw-svg`
- `apps/desktop/src-tauri/tauri.conf.json` — CSP `connect-src` 添加渲染服务器域名
- `apps/desktop/src/components/icons/FileIcon.tsx` — 扩展名 → theme icon 映射

Graphviz 的 DOT 语言无需类似 plantuml 的 deflate+base64 编码——服务器通常接受原始 DOT 文本（POST 或 URL 编码）。

## Assumptions (temporary)

- 文件扩展名：`.gv`、`.dot`（最常见两个；`.graphviz` 也接受）
- 代码块语言标识：`graphviz`、`dot`
- Loading marker：`渲染图表中...` 已在 `exportService.LOADING_MARKERS`，可复用
- 默认视图模式：`split`（与 plantuml 一致）

## Decisions (ADR-lite)

- **渲染方式**: quickchart.io 在线服务器（POST `https://quickchart.io/graphviz`，JSON body `{format:"svg", graph:"<dot>"}`），与 plantuml 在线模式对称
- **文件扩展名**: `.gv` / `.dot` / `.graphviz` 全部支持
- **代码块语言**: `graphviz` + `dot`
- **图标**: 新建 `apps/desktop/src/assets/icons/graphviz.svg`

## Requirements

- 注册 graphviz 文件类型处理器（扩展名 `.gv` / `.dot` / `.graphviz`）
- 内联代码块 ` ```graphviz ` / ` ```dot ` 渲染为 SVG
- `:::file-preview{src="*.gv"}` 指令支持
- 文件预览支持 ZoomPanCanvas（伸缩/平移）
- SVG 导出（参考 plantuml 的 `data-raw-svg` 保真策略）
- 错误显示（与 plantuml 一致的红色边框 + 源码回退）
- CSP 添加 `https://quickchart.io` 到 `connect-src`
- 新建 `graphviz.svg` 图标文件
- `FileIcon.tsx` 扩展名映射 + `HANDLER_TO_THEME_ICON` 注册
- `registerBuiltinCodeContributions.ts` 注册 `graphviz` / `dot` fence
- `exportService.ts` REGISTRY 注册 `graphviz` / `dot` / `.gv` / `.dot` / `.graphviz`
- `export/graphviz.ts` 增强器（POST quickchart.io 拿 SVG，写入 `data-raw-svg`）
- `container-plugins` 导出 `useGraphvizSvg` + `GraphvizBlock`
- **PlantUML + Graphviz 代码高亮**：在 `container-plugins/src/editor-languages/` 新增 `plantuml.ts` + `dot.ts` StreamLanguage 定义（参考 `mermaid.ts` 模式），在 `registerBuiltinCodeContributions.ts` 通过 `registerEditorLanguage` 注册 `plantuml`/`puml`/`pu` 和 `graphviz`/`dot`/`gv`（`@codemirror/legacy-modes` 无 dot/plantuml 模式，必须自写）

## Acceptance Criteria (evolving)

- [ ] 打开 `.gv` 文件 → 渲染 SVG 预览
- [ ] 内联 ` ```dot ` 代码块在 markdown 中渲染为 SVG
- [ ] `:::file-preview{src="foo.gv"}` 渲染为 SVG
- [ ] 预览支持滚轮缩放、拖拽平移
- [ ] 导出 SVG 字节级保留（无 `Entity 'nbsp' not defined` 类错误）
- [ ] 渲染失败时显示错误 + 源码回退
- [ ] CSP 允许渲染服务器域名

## Definition of Done

- 类型检查 / lint / CI 绿
- zh + en i18n key 补齐（如需要）
- 不修改任何已发布 SVG 源文件（plantuml 教训）

## Out of Scope (explicit)

- 离线渲染（除非选 WASM 方案）
- 编辑器语法高亮（DOT 语法）
- 复杂图布局参数透传

## Research Notes

### Graphviz 渲染方案对比

**Approach A: 在线服务器 — quickchart.io**

- How: POST `https://quickchart.io/graphviz` JSON `{ format: "svg", graph: "<dot source>" }` → 返回 SVG
- Pros: 与 plantuml 模式完全一致（在线 fetch），无新依赖，bundle 不增加
- Cons: 依赖第三方非官方服务，CSP 需添加 quickchart.io，离线不可用
- 编码：纯 JSON POST，无需 deflate+base64

**Approach B: 浏览器 WASM — `@viz-js/viz`**

- How: 客户端 WASM 渲染，无需服务器
- Pros: 离线可用，无 CSP 修改，无第三方依赖
- Cons: 增加 ~1.5MB+ WASM bundle，首次加载慢，与 plantuml 模式不一致

**Approach C: 浏览器 WASM — `@hpcc-systems/wasm`**

- 同 B，但包更大、API 更繁
- 不推荐

### Constraints from our repo

- 已有 plantuml 在线模式作为先例
- ZoomPanCanvas 复用
- `data-raw-svg` 保真导出机制已就位

## Feasible approaches

**推荐 Approach A（quickchart.io）** — 与 plantuml 模式对称，最小代码量，遵循 ponytail 原则。

## Technical Notes

- DOT 源无需编码，POST JSON 即可
- 错误响应可能是 SVG 内嵌错误信息或 HTTP 错误码，需双重判断
- 文件图标：暂无 `graphviz.svg`，需决定方案
