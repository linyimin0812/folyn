# 微内核 + 插件化架构

## Goal

把 quill 从"5 套散装 registry、构建期发现"演进为**统一的微内核 + 插件 SDK**，并支持 **uTool 式运行时安装**：用户能在运行中的 app 里安装一个插件包，立刻获得新的文件类型 / feature / 工具能力，无需重新打包发布。

分两层：
- **Layer A — 统一插件 SDK + 规范化内核**：把现有 5 套 registry 统一为一个 `PluginHost`，定义 manifest + 生命周期 + 统一 capability API，贡献点包括 文件类型 / feature / 工具 / 命令 / 容器指令。
- **Layer B — 运行时装载**：从本地或市场下载插件包，动态加载进运行中的 app，解决沙箱、签名、Tauri 能力授权、动态 import。

## What I already know

* 技术栈：Tauri 2 (Rust shell) + React 18 + Vite 6 + CodeMirror 6 + Zustand 5 + Tailwind；pnpm monorepo。
* 已有 5 套 registry（均构建期/静态，不能运行时装载）：
  - `apps/desktop/src/components/file-types/registry.ts` — `import.meta.glob` eager 发现 `FileTypeHandler`
  - `packages/container-plugins/ContainerRegistry.ts` — Markdown 容器指令（callout/tabs/...）
  - `packages/vault-provider/registry.ts` — 存储后端（tauri/webdav/s3/github）
  - `packages/cli-adapter/registry.ts` — AI CLI 适配器（claude）
  - `apps/desktop/src/services/commandRegistry.ts` — 命令面板（⌘P）
* 文件类型 handler 已是接口化设计（`FileTypeHandler`，含 `extensions`/`id` 等），是较好的贡献点雏形。
* Tauri 后端较薄：`commands.rs` / `lib.rs` / `pet_panel_macos.rs`；capabilities 已分文件（default/pet/pet-panel）。
- 现有 feature 模块在 `apps/desktop/src/features/`（analyze/clips/schedule/study/wiki），是 feature 贡献点的参考形态。

## Assumptions (temporary, to validate)

* 插件以 **npm 包形态 + manifest** 分发，运行时动态 import（而非 iframe 沙箱）—— 需验证 Tauri/Vite 下动态 import 远程 ESM 的可行性。
* 内核 host 运行在 React 主线程；插件贡献 UI 组件、命令、handler，不自带完整窗口。
* uTool 式"独立工具窗口"是 Layer B 的高阶形态，MVP 可先做"在 app 内装载插件贡献的 file-type/feature/command"，再演进到独立窗口。

## Open Questions

* MVP 贡献点范围：5 个贡献点（file-type / feature / tool / command / container）哪些进 MVP？
* 可信层信任模型：插件如何成为"可信"（quill 签名 / 用户 pin / 仅内置）？—— 决定 in-process 路径在 MVP 能否被第三方插件走通。
* manifest 字段与贡献点 schema。
* host RPC 能力 API 表面 + 安装期 consent UX。
* 装载来源：本地文件 / URL / 市场（MVP 取哪些）。

## Decision (ADR-lite)

**Context**: 需同时支持"uTool 式工具窗口"（要隔离）与"加新文件类型/容器指令"（要渲染进主编辑器，要主 realm）。单一隔离层无法兼顾。
**Decision**: 选 Approach B 双层——不可信插件走沙箱 iframe + host RPC（`quill-plugin://` scheme）；可信插件（签名/内置/用户 pin）`import()` 进主 realm，可直接贡献内联 React/CodeMirror 组件，走 `add_capability` 受限授权。
**Consequences**: SDK 分两档（sandbox API vs in-process SDK）；可信层必须建签名链（ed25519，MVP 可先 SHA-256 完整性 + TOFU）；两套加载/卸载路径（iframe destroy vs dispose()+revokeObjectURL）；现有 5 套 registry 需补 register/unregister + Disposable。

## Requirements (evolving)

* 统一 PluginHost + Plugin 生命周期（install/activate/deactivate/uninstall）。
* 插件 manifest 描述贡献点与所需能力。
* 运行时加载插件包并注册其贡献点，热生效无需重新打包。
* 现有 5 套 registry 改造为 PluginHost 的贡献点适配器（向后兼容内置实现）。

## Acceptance Criteria (evolving)

* [ ] 不重新打包 app，即可装载一个第三方插件并使其注册的文件类型/命令在 UI 生效。
* [ ] 内置实现（现有 file-type/container 等）经 PluginHost 路由后行为不变。
* [ ] 插件申请受控 Tauri 能力时需显式授权，未授权不可调用。
* [ ] 卸载插件后其贡献点从 UI/registry 完全移除。

## Definition of Done

* Tests added/updated（PluginHost 生命周期、贡献点注册/卸载、manifest 校验）。
* Lint / typecheck / CI green。
* 文档：插件开发指南（manifest 字段、贡献点、能力申请）。
* Rollout/rollback：插件装载失败不 crash 主 app；可禁用/卸载。

## Out of Scope (explicit, tentative)

* 插件市场服务端（后端市场/账号/付费）—— MVP 仅本地装载 + 可选 URL。
* 跨设备插件同步。
* 插件沙箱内的完整 OS 级隔离（取决于沙箱选型）。

## Research References

* [`research/utool-plugin-model.md`](research/utool-plugin-model.md) — uTool=Electron；folder+`plugin.json`+`.upx` zip；per-feature BrowserWindow + Node preload 桥接 `utools.*` API；**无 per-capability 权限**（靠市场审核信任）。可借鉴：manifest/打包/`quill.*` 命名空间。不可照搬：preload 桥、window-per-feature、无权限 → quill 需 Rust 特权命令 + 内联贡献点 registry + 显式运行时 capability store + 安装期授权 prompt。
* [`research/vscode-extension-host.md`](research/vscode-extension-host.md) — VSCode `contributes`/activation events/disposable 生命周期值得借鉴。**核心结论**：capability-scoped host API 只有配合隔离层（Worker/iframe）才能对不可信插件强制执行；进程内托管（in-process）会让安装期 consent 沦为"软门槛"，因为插件可直接 `import('@tauri-apps/api/core')` 绕过。quill 现状：`file-types/registry` 无 register/unregister（frozen `import.meta.glob`）；`commandRegistry` 无 Disposable 返回；`ContainerRegistry` 已有 `unregister` 雏形。
* [`research/tauri-runtime-loading.md`](research/tauri-runtime-loading.md) — 对照 tauri-2.11.2 源码核验。**可行性判定**：动态 `import()` 同源/CORS 可用、`file://` 跨域被拦；**自定义 URI scheme `quill-plugin://`**（启动期 `register_uri_scheme_protocol` 注册，按 path 路由到 `~/.quill/plugins/<id>/`）是推荐装载路径，自带跨源隔离；**沙箱 iframe**（`sandbox="allow-scripts"` 无 `allow-same-origin`）是现实可行的不可信插件沙箱；Tauri 2 **支持运行时 capability 授权**（`Manager::add_capability` + `CapabilityBuilder`，`dynamic-acl` 默认开），但对不可信插件推荐 **host-mediation** 而非直授原始 Tauri API；签名 DIY（`ed25519-dalek`+`sha2`，MVP 可先只做 SHA-256 完整性）；ES module cache 无法驱逐 → **热卸载靠 iframe destroy**。硬约束：`register_uri_scheme_protocol` 在 `tauri::Builder` 上（consumes self）→ 启动期注册单一 scheme、按 path 分发；quill 当前 `csp: null` → 必须补 CSP。

## Feasible Approaches（隔离层选型，决定一切下游设计）

**Approach A: 全沙箱 iframe + host RPC（最安全）**
* 所有第三方插件跑在 `quill-plugin://` 沙箱 iframe，经 `postMessage` 调 host 审核过的 RPC。无原始 Tauri API。
* Pros: 真隔离；干净热卸载（destroy iframe）；CSP 可逐插件收紧。
* Cons: 插件**无法直接贡献内联 React/CodeMirror 组件**——file-type handler、容器指令这类"渲染进主编辑器"的贡献点做不了，只能做"工具窗口/命令"型插件。与"加新文件类型"诉求冲突。

**Approach B: 双层（推荐）**
* **不可信层**：iframe + host RPC，承载 uTool 式"工具窗口/命令/面板"插件。
* **可信层**（签名/内置/用户 pin）：`import()` 进主 realm，可直接贡献 file-type handler、容器指令、CodeMirror extension、命令面板项；走 `add_capability` 受限授权。
* Pros: 兼顾"内联贡献点"（要主 realm）与"不可信工具"（要隔离）；与 VSCode/uTool 实践一致。
* Cons: 两套加载路径，SDK 要分两档；可信层签名链必须建起来，否则 in-process 等于裸奔。

**Approach C: 全主 realm import() + 安装期 consent + 签名（最强 DX、最弱安全）**
* 所有插件 import() 进主 realm，安装时显式授权 + 签名校验。
* Pros: 一套路径；DX 最丰富；所有贡献点都能做。
* Cons: 沙箱形同虚设——签名一旦伪造或 consent 误点，插件可读全盘/起 shell。不适合未来开市场。

## Technical Approach

### 架构总览
`PluginHost`（React 主线程）+ Rust 侧 `quill-plugin://` 自定义 scheme + `install_plugin` 命令。两档加载：
- **sandbox 档**（不可信）：`<iframe sandbox="allow-scripts" src="quill-plugin://localhost/<id>/index.html">`，`postMessage` ↔ host RPC。贡献点：command / tool-window。
- **trusted 档**（TOFU pin）：`import(/* @vite-ignore */ 'quill-plugin://localhost/<id>/index.js')` 进主 realm，`add_capability` scoped 授权。贡献点：file-type / container / feature / command。

### manifest.json schema（草案）
```jsonc
{
  "id": "kebab-id",            // 全局唯一
  "name": "Display Name",
  "version": "1.0.0",
  "author": "...",
  "quill": ">=0.1.0",          // 引擎兼容
  "tier": "sandbox" | "trusted",
  "main": "index.js",          // sandbox: iframe 内加载; trusted: ESM factory default export
  "html": "index.html",        // sandbox 档 UI 入口
  "permissions": {             // sandbox: host-RPC 能力白名单; trusted: 原始 Tauri perm → add_capability
    "fs":     { "scope": ["data/**", "vault:read-active"] },
    "http":   { "origins": ["https://api.example.com"] },
    "clipboard": true,
    "dialog": true,
    "window": true
  },
  "contributes": {
    "commands":   [{ "id": "...", "title": "...", "icon": "..." }],
    "fileTypes":  [{ "id": "json", "extensions": [".json"], "handler": "default" }],
    "containers": [{ "name": "callout" }],
    "features":   [{ "id": "...", "panel": "right" }],
    "tools":      [{ "id": "...", "title": "...", "window": true }]
  },
  "activation": { "onCommand": "...", "onFileType": [".json"], "onLanguage": "markdown" }
}
```

### host RPC 能力表面（sandbox 档）
| 命名空间 | 能力 | 约束 |
|---|---|---|
| `fs` | read/write/text | 限定 `~/.quill/plugins/<id>/data/**` + manifest 声明的 vault 读取 |
| `http` | fetch | origin allowlist（manifest `http.origins`） |
| `clipboard` | read/write | |
| `dialog` | open/save | 限定 plugin data 目录 |
| `vault` | read-active-doc / insert-content | 需 consent |
| `window` | open/close tool window | 仅 quill-plugin:// origin |

### 生命周期
`install`（落盘 + 校验 + 写 plugins.json）→ `activate`（按 `activation` 懒激活）→ `deactivate`（sandbox: destroy iframe；trusted: 调 `dispose()` + `URL.revokeObjectURL`）→ `uninstall`（移除贡献点 + 删目录）。

### 现有 registry 改造（向后兼容）
- `file-types/registry.ts`：frozen `import.meta.glob` → 加 `register(handler)`/`unregister(id)`，内置 handler 启动期注册。
- `commandRegistry`：返回 `Disposable`，加 `unregister(id)`。
- `ContainerRegistry`：补 `unregister(name)`（已有雏形）。
- `vault-provider` / `cli-adapter` registry：二期接入。

## Implementation Plan（小 PR）

* **PR1 — 内核骨架**：`PluginHost` + manifest schema + 生命周期类型；5 套 registry 补 register/unregister/Disposable；内置实现经 PluginHost 路由，行为不变；单元测试覆盖生命周期 + 注册/卸载。
* **PR2 — sandbox 档装载**：Rust `register_uri_scheme_protocol("quill-plugin")` + `install_plugin` 命令 + `~/.quill/plugins/` 落盘 + `plugins.json` + CSP；React 侧沙箱 iframe + postMessage RPC bridge；MVP command + tool-window 贡献点。
* **PR3 — trusted 档装载**：`import()` + TOFU pin（哈希校验 + 用户批准）+ `add_capability` scoped 授权；file-type / container / feature 贡献点；热卸载（dispose + revokeObjectURL）。
* **PR4 — 完整性与 UX**：SHA-256 完整性校验（预留 ed25519 升级点）+ 安装期 consent/权限 prompt UI + 插件开发指南文档 + 一个端到端示例插件。

## Technical Notes

* 现有 registry 文件路径见 "What I already know"。
* Vite 动态 import 远程模块受 CORS 限制——已由 research 验证：自定义 `quill-plugin://` scheme 规避，无需 remote ESM。
* Tauri 2 capabilities 支持运行时授权（`Manager::add_capability` + `CapabilityBuilder`，`dynamic-acl` 默认开，已核验 tauri-2.11.2 源码）；不可信档走 host-mediation。
* 硬约束：`register_uri_scheme_protocol` 在 `tauri::Builder`（consumes self）→ 启动期注册单一 scheme、按 path 分发；quill 当前 `csp: null` → PR2 必须补 CSP。
* ES module cache 不可驱逐 → trusted 档热卸载用 blob URL cache-busting + `dispose()`，sandbox 档用 iframe destroy。
* 风险点：trusted 档 `dispose()` 不完整会泄漏监听器/全局态——SDK 契约须强制 `dispose()` 返回 Promise 且 host 仍以 iframe-destroy 为兜底。

