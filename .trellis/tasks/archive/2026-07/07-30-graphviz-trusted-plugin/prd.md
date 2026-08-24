# Graphviz Trusted-Tier Plugin

## Goal

把 Graphviz（DOT 语言）图渲染能力作为 **trusted-tier 插件**接入 Folyn，而不是内置进
`apps/desktop`。用户安装插件后可在 Folyn 里打开 `.dot`/`.gv` 文件，左侧 CodeMirror 编辑
源码、右侧实时渲染成 SVG 图。不装插件 = 主应用零包体增长。这是前面调研得出的成本最优解。

## What I already know

来自前序对话轮次的代码库调研（已验证）：

- **文件类型系统是插件友好的**：`components/file-types/registry.ts` 用
  `import.meta.glob('./*/index.{ts,tsx}')` 自动发现内置 handler；同时导出
  `registerFileTypeHandler` / `unregisterFileTypeHandler` 作为**插件贡献目标**。
- **插件贡献点已完整接线**：`packages/plugin-host/src/types.ts` 定义了
  `FileTypeContribution { id, extensions, handler, defaultViewMode }` 和
  `ContainerContribution`；`apps/desktop/src/services/plugin-host/contributionAdapters.ts`
  读 `manifest.contributes.fileTypes[]` → 调 `registerFileTypeHandler` 注入，卸载时 dispose。
- **trusted 插件运行模型**（`trustedLoader.ts` 注释）：跑在主 webview realm，TOFU 门
  （用户钉 + 完整性哈希）是真正安全边界；`main` 必须是**自包含 ESM bundle**——blob URL
  里相对 import 不解析、远程 import 被 `folyn-plugin://` CSP 挡，**插件必须打包所有依赖**。
- **rendering 引擎候选**：`@viz-js/viz`（MIT，纯 WASM 移植，wasm ~1.6MB / gzip ~600KB）。
  graphviz 本体 EPL，弱 copyleft，不传染 Folyn（MIT）代码，仅需 license 声明。
- **先例 pattern**：`MermaidPlugin.tsx`（container-plugins 包）做 `mermaid.render() → SVG
  字符串 → dangerouslySetInnerHTML`；`dbml` handler 做 `useCodeMirror:true + Preview` split。
- **FileType 是开放类型**：`editorStore.ts:15 export type FileType = string;`，无需扩 union。
- **图标**：`FileIcon.tsx` 的 `EXT_TO_THEME_ICON`/`HANDLER_TO_THEME_ICON` 加映射即可复用 theme icon。
- **新建文件菜单**：`ContextMenu.tsx` 从 `getAllHandlers()` 动态生成，插件注册后自动出现。

## Research findings (resolved blocking Q3)

`research/trusted-plugin-wasm-loading.md` 结论：wasm 加载问题**不存在**。

- `@viz-js/viz@3.28` 把 wasm 以内嵌 `binaryDecode('…')` 字符串打进 `lib/backend.js`，
  自调 `WebAssembly.instantiate(bytes, imports)` —— 无独立 `.wasm`、无 `fetch`、无 `locateFile`/`wasmURL`。
- 插件只需把 `@viz-js/viz` 打进自包含 ESM `main`，wasm 随 blob-URL `import()` 自动进来。
- 主 webview CSP（`tauri.conf.json:144`）已有 `wasm-unsafe-eval`（script-src）+ `folyn-plugin:`（connect-src），
  WebAssembly 实例化放行。
- `read_plugin_file` Rust 命令（`plugin_commands.rs:624`）用 `fs::read_to_string` 返 UTF-8，
  无法传二进制 wasm —— 但本方案用不到它。
- 代价：~1.17MB raw / ~456KB gzip，全在插件动态 chunk，宿主零增长。
- ⚠️ 别解码/改写那个 `binaryDecode` 字符串（非标准 base64），让 `@viz-js/viz` 自跑。

→ Open Question #3 关闭。技术路线锁定：插件自包含 bundle + `@viz-js/viz` 内嵌 wasm。

## Open Questions

1. ✅ MVP 范围：文件类型 + `:::graphviz` 容器块，两条都做。
2. ✅ 编辑模式：preview-only（只看图，不编辑，源码交外部编辑器）——绕开 CodeMirror 语言扩展。
3. ✅ 插件包位置：**monorepo 内新建 `plugins/` 目录** + 扩 `pnpm-workspace.yaml` glob（`plugins/*`）。
4. ✅ 宿主契约来源：插件 `workspace:*` 链 `@folyn/plugin-host`（源码在仓内可直接用），**不发布 plugin-host 到 npm**。
5. ✅ 交付边界：插件与宿主同仓，**本任务单仓交付全部**——无跨仓拆分。

## Requirements (evolving)

- 新建 monorepo 包 `plugins/folyn-plugin-graphviz`，扩 `pnpm-workspace.yaml` 加 `plugins/*` glob。
  插件 `workspace:*` 链 `@folyn/plugin-host`（类型契约，源码在仓内直接用），**不发布 plugin-host 到 npm**。
- 插件 Vite lib-mode 构建产出自包含 ESM `dist/main.js` + `manifest.json`（trusted `main` 必须自包含；
  `@viz-js/viz` 内嵌 wasm 随 bundle 进，无需独立 wasm 资产）。
- manifest 声明两个贡献点：
  - `contributes.fileTypes`：graphviz，extensions `dot`/`gv`，**preview-only**（`useCodeMirror:false`、无 `Editor`、只有 `Preview`，`defaultViewMode:'preview'`）。源码编辑交外部编辑器，Folyn 只看图。
  - `contributes.containers`：`graphviz` 指令块，markdown 内 `:::graphviz\n digraph { ... }\n:::` 渲染成 SVG（仿 mermaid 块）。
- 用 `@viz-js/viz` 把 DOT 渲染成 SVG；文件类型与容器块**共用同一个 viz 实例/懒加载模块**（wasm 只加载一次）。
- 非法 DOT 显示错误信息 + 原文回退（仿 mermaid 的 error 路径），不崩。
- 卸载插件后两个贡献点都 dispose 拿掉。
- 不碰宿主编辑器/CodeMirror 语言列表（preview-only 不需要任何宿主侧语言贡献点）。
- **宿主侧一处改动（已确认必要）**：`main.tsx` 在 import React 后尽早挂
  `window.React = React; window.ReactDOM = ReactDOM;`（+ 全局类型声明），
  让 trusted 插件内联渲染的 React 组件与宿主**共用同一 React 实例**（否则 hooks 报 "Invalid hook call"）。
  这是代码库既有假设（`markdown-todo`/`ai-chat-demo` 样例的 `_loadReact()` 都查 `window.React`），宿主一直缺这一行。
  import-map 方案经研究否决（WKWebView import map 需 macOS 13.3，本项目继承默认 macOS 10.15，老用户会崩且无法 polyfill，见 research/wkwebview-importmap-blob-url.md）。
- License 声明（graphviz EPL + @viz-js/viz MIT）+ 插件 README 安装/trust 流程。

## Acceptance Criteria (evolving)

- [ ] 安装并 trust 插件后，vault 里打开 `.dot`/`.gv` 文件，preview-only 视图渲染成 SVG（带缩放/平移）。
- [ ] markdown 里 `:::graphviz` 块内嵌渲染成 SVG（仿 mermaid 块）。
- [ ] DOT 源码非法时显示错误信息 + 原文（仿 mermaid 的 error 回退），不崩。
- [ ] 卸载插件后 `.dot` 扩展名与 `graphviz` 容器块都不再被接管。
- [ ] 插件 bundle 自包含，不依赖宿主 node_modules，CSP 不报错。
- [ ] 文件类型与容器块共用同一个 viz 实例（wasm 只加载一次）。

## Definition of Done (team quality bar)

- Tests: render DOT→SVG 的纯逻辑单测 + handler 注册/卸载 dispose 测试。
- Lint / typecheck / CI green。
- License 声明：在插件包内列出 graphviz (EPL) + @viz-js/viz (MIT)。
- 插件 README 说明安装与 trust 流程。

## Out of Scope (explicit)

- **源码编辑**：`.dot` 文件只渲染不编辑，编辑用外部编辑器（VSCode 等）。
- **DOT 语法高亮 / CodeMirror DOT 语言扩展**：preview-only 不需要，留待将来若做 split 编辑再说。
- sandbox-tier 支持（先只做 trusted）。
- DOT 的交互式编辑（拖拽节点、改布局），仅静态渲染。
- graphviz 的非 DOT 输入格式（如 plain/ext-format）。
- 服务端/系统 `dot` 二进制 fallback。

## Technical Notes

- 关键文件：
  - `packages/plugin-host/src/types.ts` — `FileTypeContribution` / `ContainerContribution`
  - `apps/desktop/src/services/plugin-host/trustedLoader.ts` — blob URL + import() + TOFU，要求 `main` 自包含 ESM
  - `apps/desktop/src/services/plugin-host/contributionAdapters.ts` — `registerPluginFileTypes` / `registerPluginContainers`
  - `components/file-types/registry.ts` / `HandlerRegistry.ts` / `types.ts`
  - `packages/container-plugins/src/plugins/MermaidPlugin.tsx` — SVG 渲染先例（`render()→SVG→dangerouslySetInnerHTML`，dark mode invert filter）
  - `apps/desktop/src/editor/EditorView.tsx:33` — 宿主 CM 语言列表硬编码（preview-only 下不碰）
- 仓库约定：pnpm workspace glob = `apps/*` + `packages/*`，无 `plugins/` 目录，无 trusted 插件打包先例——插件包是新地面。
- 约束：trusted `main` 必须 self-contained ESM；blob URL 无相对路径；远程被 CSP 挡；`@viz-js/viz` 内嵌 wasm 随 bundle 进。
- 图标：`contributionAdapters.ts:149` `{ ...handler, id, extensions }` 透传 handler 自带的 `icon`（ReactNode），插件自供图标，无需改宿主 `FileIcon.tsx`。
- 实现切分：PR1 脚手架+workspace glob+Vite lib+manifest，跑通空 handler 注册/卸载；PR2 DOT→SVG 核心+.dot Preview+错误回退+dark mode；PR3 `:::graphviz` 容器块+防抖/loading+license+README+测试。

## Decision (ADR-lite)

**Context**：Graphviz 渲染要接入 Folyn，有多种接法（内置文件类型 / 独立仓插件 / monorepo 内插件 / markdown 内嵌），且渲染引擎有 wasm 包体顾虑。

**Decision**：
- 作为 **trusted-tier 插件**接入（非内置），让"是否需要 graphviz"由用户安装决定，宿主零成本。
- 插件放 **monorepo 内 `plugins/folyn-plugin-graphviz`**（扩 pnpm-workspace glob），`workspace:*` 链 `@folyn/plugin-host`，**不发布 plugin-host 到 npm**。
- 渲染引擎用 **`@viz-js/viz`**（内嵌 wasm，无需独立资产，CSP 已放行）。
- **preview-only**：`.dot` 文件只看图不编辑，绕开"宿主无语言贡献点"的架构缺口。
- 同时提供 `:::graphviz` markdown 容器块（仿 mermaid）。

**Consequences**：
- 优点：wasm 随插件动态加载、与现有插件契约一致、成本可控。
- **宿主改动**：`main.tsx` 挂 `window.React`/`window.ReactDOM`（一行 + 类型声明）——必要，让插件内联 React 组件共用宿主 React 实例。import-map 方案经研究否决（macOS 13.3 底线，本项目默认 10.15，老用户崩且无法 polyfill）。
- 代价：插件 bundle ~1.17MB raw / ~456KB gzip（全在插件 chunk，宿主零增长）。
- 限制：preview-only 无源码编辑/语法高亮；若将来要 split 编辑，需给宿主加 `registerLanguageDescription` 贡献点（本次不做）。插件组件用 `window.React` 的 createElement（不用 JSX），保证 blob URL bundle 不 `import 'react'`。
- License：graphviz EPL（弱 copyleft，不传染 MIT 宿主）+ @viz-js/viz MIT，需在插件包声明。

## Research References

* [`research/trusted-plugin-wasm-loading.md`](research/trusted-plugin-wasm-loading.md) — `@viz-js/viz` 内嵌 wasm，无需独立资产/ fetch，CSP 已放行；wasm 加载卡点不存在。
* [`research/wkwebview-importmap-blob-url.md`](research/wkwebview-importmap-blob-url.md) — import-map-for-blob-URL 否决（macOS 13.3 底线 vs 本项目默认 10.15，老用户崩且无法 polyfill）；回退 `window.React` 全局。
