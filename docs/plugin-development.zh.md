# Quill 插件开发指南

Quill 的微内核让你可以在运行时扩展编辑器：装一个插件文件夹，它的文件类型、命令、
容器指令、功能面板或工具窗口立刻可用——无需重新编译、无需重新打包。

本指南覆盖：manifest schema、两种执行 tier、contribution 点位、权限模型、生命周期、
TOFU 审批流程、本地开发、打包。示例插件位于
[`examples/plugins/`](../examples/plugins/)。

- [快速开始](#快速开始)
- [一览：host 对外提供什么](#一览host-对外提供什么)
- [两种 tier](#两种-tier)
- [manifest.json schema](#manifestjson-schema)
- [Contribution 点位](#contribution-点位)
- [PluginModule 导出契约（trusted tier）](#pluginmodule-导出契约trusted-tier)
- [Sandbox RPC 协议（sandbox tier）](#sandbox-rpc-协议sandbox-tier)
- [权限模型](#权限模型)
- [生命周期：activate / deactivate / dispose](#生命周期activate--deactivate--dispose)
- [TOFU 审批流程](#tofu-审批流程)
- [完整性升级路径（ed25519 脚手架）](#完整性升级路径ed25519-脚手架)
- [本地开发](#本地开发)
- [打包](#打包)
- [参考：示例插件](#参考示例插件)

---

## 快速开始

最快路径：把 [`examples/plugins/markdown-todo`](../examples/plugins/markdown-todo)
复制到一个文件夹，然后通过 **Settings → Plugins → 从文件夹安装…** 安装。
文件夹名必须是插件的 kebab-case id（如 `markdown-todo`），插件就会出现在列表里。
Trusted tier 插件还需额外点一次 **批准并授权**（见 [TOFU](#tofu-审批流程)）。

安装 + 启用后：

- `markdown-todo` 插件贡献一个 `:::todo` 容器指令（在 `/` 菜单输入 `/todo`）
  和一个 **Todo: Insert Checklist** 命令（⌘P → "Todo: Insert Checklist"）。
- `hello-tool` 插件（sandbox tier）贡献一个 **Hello: Greet** 命令，通过 host RPC
  桥写入剪贴板。

### 安装 SDK

用 `@quill/plugin-sdk` 给你的 manifest 做类型守卫——它是可发布到 npm 的类型包
（manifest schema、贡献点、`PluginModule`、AI 能力类型，以及 `definePlugin`/
`validateManifest` 等 dev helper）。它无运行时依赖；React 仅作 peer 类型
（type-only 消费者在构建时被擦除）。

```bash
npm install @quill/plugin-sdk
```

```ts
// index.ts —— trusted tier 插件入口模块
import type { PluginModule, ExporterHandler } from '@quill/plugin-sdk';

const exportTxt: ExporterHandler = async (content, ctx) =>
  `# ${ctx.filePath}\n\n${content}`;

export const exporters: Record<string, ExporterHandler> = { 'txt-with-header': exportTxt };
export const commands = { ping: () => console.info('pong') };
```

内部 workspace 插件依赖 `@quill/plugin-host`（它 re-export 了完整 SDK 面）——
从两边 import 都可以。运行时微内核（`PluginHost`、`pluginHost` 单例）留在
`@quill/plugin-host`；SDK 保持可发布、无运行时。

---

## 一览：host 对外提供什么

一个 Quill 插件是 `~/.quill/plugins/<id>/` 下的一个文件夹，包含 `manifest.json`
+ 资源文件。host 给你五样东西：

### 1. 两种执行 tier

| Tier | 隔离 | 能力面 | 信任门槛 |
|---|---|---|---|
| `sandbox` | 独立 `WebviewWindow` 或 iframe，origin 为 `quill-plugin://localhost` | 仅能用 host RPC 桥，无 Tauri API | 无（sandbox 本身就是边界） |
| `trusted` | 主 webview realm（进程内） | 完整 host realm + Zustand store + Tauri | TOFU：用户必须点 **批准并授权** |

### 2. Contribution 点位

在 manifest 的 `contributes` 中声明；activate 时由 host 接入对应注册表；deactivate
时自动注销。

| 点位 | Sandbox | Trusted | 作用 |
|---|---|---|---|
| `commands` | ✓ | ✓ | 命令面板入口（⌘P）—— 注册 id 为 `plugin.<pluginId>.<id>` |
| `tools`（`window: true`） | ✓ | ✓ | "Open: <title>" 命令 → 弹出 Tauri WebviewWindow |
| `fileTypes` | ✗ | ✓ | 文件扩展名 → handler 映射 |
| `containers` | ✗ | ✓ | `:::name` Markdown 指令 → React 组件 |
| `features` | ✗ | ✓ | 侧边栏 panel slot（activity bar 图标 + 组件）—— MVP 仅 left |
| `exporters` | ✗ | ✓ | 自定义导出格式 → "Export as <label>" 面板命令 |
| `fileTemplates` | ✗ | ✓ | 新建文件模板 → "New <label>" 面板命令 |
| `keybindings` | ✗ | ✓ | Tauri accelerator → 命令 id（app 级 keydown） |

### 3. RPC 方法表（sandbox tier —— host 中介）

Sandbox 插件通过 `postMessage`（iframe 传输）或
`fetch('quill-plugin://localhost/<id>/rpc', ...)`（工具窗口传输）调用 host 能力。
两者都走同一个 `dispatchPluginRpc` 表——同样的权限校验、同样的路径解析。

| 方法 | 参数 | 所需权限 | 返回值 |
|---|---|---|---|
| `fs:read` | `{ path }` | `fs.scope`（glob） | `string`（文件内容） |
| `fs:write` | `{ path, content }` | `fs.scope` | `void` → `{ ok: true }` |
| `fs:list` | `{ path }` | `fs.scope` | `DirEntry[]` |
| `http:fetch` | `{ url, init? }` | `http.origins`（白名单） | `{ status, headers, body }` |
| `clipboard:read` | `{}` | `clipboard: true` | `string \| null` |
| `clipboard:write` | `{ text }` | `clipboard: true` | `void` → `{ ok: true }` |
| `dialog:open` | `{}` | `dialog: true` | `string \| null`（文件路径） |
| `dialog:save` | `{ content }` | `dialog: true` | `string \| null` |
| `vault:read-active-doc` | `{}` | `vault.readActive: true` | `{ path, content } \| null` |
| `vault:insert-content` | `{ content }` | `vault.insertContent: true` | `{ ok: true }` |
| `window:open` | `{ toolId }` | `window: true` | `{ opened: true, toolId }` |

**响应契约**：成功 → 按"返回值"列的 JSON 对象；失败 → `{ "error": "<msg>" }`
（HTTP 200）；超时 30s → HTTP 504 + `{ "error": "rpc timeout" }`。读取返回字段前
务必先检查 `json.error`。

### 4. manifest 校验规则（开发者必须遵守的规范）

- `id`：kebab-case，`^[a-z0-9]+(-[a-z0-9]+)+$`（至少一个连字符）。
  `~/.quill/plugins/` 下的文件夹名必须等于 `id`。
- `version`：非空字符串（建议 semver）。
- `tier`：`"sandbox"` 或 `"trusted"`。
- `main`：非空字符串（入口模块的相对路径）。
- `sandbox` tier 必须有 `html`（加载进 iframe/窗口的 HTML 入口）。
- 文件完整性：安装时计算每个文件的 SHA-256；trusted tier 在 `import()` 前再次校验
  `main` 的哈希。被篡改则拒绝激活。
- 可选 ed25519 `signature` + `publisherPublicKey`（MVP：不强制，未来 marketplace
  门槛的脚手架）。

### 5. sandbox 插件的 CSP（HTML/JS 能做什么）

每个 `quill-plugin://localhost/<id>/<file>` 响应都带这个 CSP header：

```
default-src 'none';
  script-src 'unsafe-inline' quill-plugin:;
  style-src  'unsafe-inline';
  connect-src quill-plugin:;
```

对开发者意味着：

- ✓ HTML 中可内联 `<script>` 和 `<style>`。
- ✓ `<script src="index.js">`（同 scheme，来自插件自己的文件）。
- ✓ `fetch('quill-plugin://localhost/<id>/rpc', ...)`（RPC 桥）。
- ✗ 不能加载任何远程 script、style、font、image；也不能 `connect-src` 到其他 origin。
  需要网络访问就声明 `http.origins` 并调 `http:fetch` —— host 在 Rust 中发请求
  （不受 CSP 限制）。
- ✗ 不能嵌入 iframe、不能用 blob: 启 web worker（只允许 `quill-plugin:`）。
- ✗ 没有 `default-src` 兜底——每个 directive 都显式声明。

注：故意不用 `'self'`。Chromium 对 `quill-plugin://` 这类 custom scheme 不会把
`'self'` 解析为文档 origin，必须显式写 scheme source `quill-plugin:`。

---

## 两种 tier

每个插件在 manifest 里声明 `tier: "sandbox" | "trusted"`。tier 决定 loader、隔离
边界、能力面、可用的 contribution 点位。

| | **sandbox** | **trusted** |
|---|---|---|
| Loader | 隐藏 `<iframe sandbox="allow-scripts">`（无 `allow-same-origin`），从 `quill-plugin://localhost/<id>/<html>` 加载 | `import(/* @vite-ignore */ blobUrl)` 进 **主 webview realm** |
| 隔离 | 跨 origin opaque origin；无父 DOM、无 Tauri API、无 localStorage | 无——运行在 host realm；可读 Zustand store、调 Tauri、操作 DOM |
| 能力面 | 仅 host RPC 桥（`postMessage`）；manifest 的 `permissions` 把守每一调用 | 完整 host realm 访问；`grant_plugin_capabilities` 加范围化 Tauri 能力（基本冗余——见 [权限模型](#权限模型)） |
| 信任门槛 | 无（sandbox 本身就是边界） | TOFU：激活前必须 **批准并授权** |
| 可用 contribution | `commands`、`tools`（window） | `commands`、`fileTypes`、`containers`、`features`、`tools` |
| 热卸载 | 销毁 iframe 元素 | `dispose()` adapter + `URL.revokeObjectURL(blobUrl)` |
| 打包要求 | HTML + JS 由 iframe 通过 `quill-plugin://` 加载 | 自包含 ESM bundle（eval 时不能有相对/远程 import——blob URL 解析不了） |

**什么时候用哪个**：

- **sandbox**：插件是自包含的工具/启动器，不需要在编辑器内渲染（无 file-type handler，
  无 Markdown 容器指令）。对不信任的第三方代码最安全。
- **trusted**：必须在编辑器内渲染 React/CodeMirror 组件（file-type handler、
  `:::container` 指令、功能面板），或需要深度 host 集成。需要用户显式批准
  （TOFU）。

---

## manifest.json schema

每个插件文件夹根目录有一个 `manifest.json`。完整 schema：

```jsonc
{
  // 必填。全局唯一的 kebab-case id（匹配 ^[a-z0-9]+(-[a-z0-9]+)+$）。
  // ~/.quill/plugins/ 下的文件夹名必须等于此 id。
  "id": "my-plugin",
  // 必填。人类可读的显示名。
  "name": "My Plugin",
  // 必填。semver 风格的版本字符串。
  "version": "1.0.0",
  "author": "Jane Doe",
  // 引擎兼容性，如 ">=0.1.0"。可选但建议。
  "quill": ">=0.1.0",
  // 必填。"sandbox" 或 "trusted"（见上）。
  "tier": "trusted",
  // 必填。入口模块路径（相对插件文件夹）。
  //   sandbox: iframe 中加载的 JS（通常是 "index.js"）
  //   trusted: import() 进 host realm 的 ESM bundle
  "main": "index.js",
  // sandbox tier 必填。iframe 加载的 HTML 入口。
  "html": "index.html",

  // 可选。声明插件可用的能力。不同 tier 执行方式不同——见"权限模型"。
  "permissions": {
    "fs":     { "scope": ["data/**", "vault:read-active"] },
    "http":   { "origins": ["https://api.example.com"] },
    "clipboard": true,
    "dialog": true,
    "window": true,
    "vault":  { "readActive": true, "insertContent": true },
    "ai":     { "chat": true, "agents": ["study"], "edit": true }
  },

  // 可选。本插件添加到 app 的 contribution 点位。
  "contributes": {
    "commands":   [{ "id": "greet", "title": "Greet", "icon": "👋", "keywords": ["hi"], "run": "greet" }],
    "fileTypes":  [{ "id": "json", "extensions": [".json"], "handler": "default", "defaultViewMode": "edit" }],
    "containers": [{ "name": "callout", "icon": "💡", "label": "Callout", "category": "layout", "component": "callout", "template": ":::callout\n:::", "description": "A callout" }],
    "features":   [{ "id": "my-panel", "panel": "left", "component": "my-panel", "icon": "<svg>...</svg>", "title": "My Panel", "order": 50, "badge": "NEW" }],
    "tools":      [{ "id": "my-tool", "title": "My Tool", "icon": "🛠", "window": true, "entry": "index.html" }],
    "exporters":      [{ "id": "txt", "format": "txt-header", "label": "Text with header", "fileExtension": "txt", "run": "txt-with-header" }],
    "fileTemplates":  [{ "id": "meeting-notes", "label": "Meeting Notes", "fileName": "meeting-notes.md", "template": "# Meeting Notes\n\n", "icon": "📝" }],
    "keybindings":    [{ "command": "plugin.my-plugin.greet", "key": "Control+Alt+Shift+T", "mac": "Cmd+Alt+Shift+T" }]
  },

  // 可选。懒激活触发器。仅当以下之一触发时才加载插件代码（仿 VSCode activation events）。
  "activation": {
    "onCommand": "greet",        // 此命令被调用时激活
    "onFileType": [".json"],     // 此扩展名的文件打开时激活
    "onLanguage": ["markdown"]   // 此语言的文档打开时激活
  },

  // 可选（PR4 脚手架）。ed25519 签名 + 固定的 publisher 公钥。
  // MVP 不强制——见"完整性升级路径"。
  "signature": "<base64 ed25519 signature over the canonicalized manifest>",
  "publisherPublicKey": "<base64 ed25519 public key>"
}
```

### 校验规则

manifest 在安装时校验（Rust `validate_manifest` + TS `PluginHost.validateManifest`）。
规则：

- `id` 必须是 kebab-case（`^[a-z0-9]+(-[a-z0-9]+)+$`）——至少一个连字符，仅小写
  字母数字。`my-plugin` ✓；`MyPlugin` ✗；`myplugin` ✗。
- `version` 必须是非空字符串。
- `tier` 必须是 `sandbox` 或 `trusted`。
- `main` 必须是非空字符串。
- `sandbox` tier 必须有 `html`。

---

## Contribution 点位

每个 contribution 是 `contributes` 里的纯数据描述。host 在插件 activate 时把它
适配进对应注册表。

### commands

```jsonc
"commands": [{ "id": "greet", "title": "Greet", "icon": "👋", "keywords": ["hi"], "run": "greet" }]
```

- `id` 是命令的本地 id；注册的 palette id 为 `plugin.<pluginId>.<id>`
  （如 `plugin.hello-tool.greet`）。
- `title` 是 palette 标签（UI 中会加插件名前缀）。
- `run` 是 **entry-ref**——指向插件模块 `commands` map 的 key（trusted），
  或要 dispatch 到 iframe 的命令 id（sandbox）。

### fileTypes（仅 trusted）

```jsonc
"fileTypes": [{ "id": "json", "extensions": [".json"], "handler": "default", "defaultViewMode": "edit" }]
```

- `handler` 是模块 `handlers` map 的 entry-ref。handler 必须是完整的
  `FileTypeHandler`（见 `apps/desktop/src/components/file-types/types.ts`）。
- `defaultViewMode` 可选（`split` / `edit` / `preview` / `visual` / `source`）。
- `supportedViewModes`（可选）声明 handler 支持的 view mode；host 会把 manifest
  声明的 id 合并进 handler 自有的集合，shell 的 view-mode 切换器会展示它们。
  除了 5 个内置（`split`/`edit`/`preview`/`visual`/`source`），插件可以声明
  **自定义** mode id（如 `canvas`），由 handler 自己的 `Editor`/`Preview` 渲染。

### containers（仅 trusted）

```jsonc
"containers": [{ "name": "todo", "icon": "✅", "label": "Todo", "category": "data", "component": "todo", "template": ":::todo\n- [ ] item\n:::", "description": "A todo list" }]
```

- `name` 是指令名（Markdown 中 `:::` 后面的部分）。
- `component` 是模块 `containers` map 的 entry-ref。component 必须是接受
  `ContainerProps`（`{ children?, attributes?, name? }`）的 React 组件。
- `category` 取 `layout` / `media` / `ai` / `data` / `custom`（slash 菜单分组）。
- `template` 是用户从 `/` slash 菜单选择指令时插入的 Markdown。

### features（仅 trusted；MVP 仅 left）

```jsonc
"features": [
  {
    "id": "my-panel",
    "panel": "left",
    "component": "my-panel",
    "icon": "<svg width=\"16\" height=\"16\" viewBox=\"0 0 16 16\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.4\"><path d=\"...\"/></svg>",
    "title": "My Panel",
    "order": 50,
    "badge": "NEW"
  }
]
```

- `id` 是 panel 的本地 id；不得与保留的内置 id（`files` / `wiki` / `clips` /
  `analyze` / `calendar`）冲突。冲突（与内置 id 或已注册的插件 panel）会打
  warning 并拒绝第二次注册。
- `panel` 取 `left` / `right` / `bottom`。**MVP 仅实现 `left`**——`right` 和
  `bottom` 会打 warning 并跳过（right/bottom shell slot 是后续任务）。
- `component` 是模块 `features` map 的 **entry-ref**（见下方 `PluginModule`
  导出契约）。必须是 React 组件（渲染时包在 `PanelErrorBoundary` 内，插件
  panel 抛错不会白屏整个侧边栏）。
- `icon` **必填**。可以是原始内联 SVG 字符串（`<svg ...>...</svg>`），或
  `ThemeIcon` 名（解析 host 的 `assets/icons/*.svg`）。内联 SVG 是插件作者
  的自包含路径。
- `title` 是 tooltip + 无障碍标签。缺省时为 `<pluginId>/<id>`。
- `order` 可选。内置 id 占用 0（files）、10（wiki）、20（clips）、30（analyze）、
  40（calendar）。未声明 `order` 的插件 panel 按注册顺序分配内置之后的槽位
  （≥100）。Activity bar 按 `(order, 注册顺序)` 排序渲染。
- `badge` 可选（`string | number`）。存在时在 activity bar 图标上渲染一个小的
  accent 色文字点。可用于未读数 / 状态标记。
- **仅 trusted tier**（决策 Q1）。sandbox 插件不能贡献侧边栏 panel——需要整页 UI
  时请用 `tools`（工具窗口）。这是有意的不对称：sandbox 隔离无法挂载同 realm 的
  React 组件。
- **deactivate 回退**：插件 deactivate 时其 panel 被注销。如果该 panel 当时正
  处于激活态，激活态回退到 `files`（同时同步 `editorStore.activePanel`，让
  WorkArea 的 tab 过滤器跟上）。
- **持久化激活态回退**：如果下次启动时 `editorStore.activePanel` 指向一个已卸载
  插件的 panel id，`registerBuiltinPanels` 的镜像订阅会把它重路由到 `files`。

#### 参考：示例 feature-panel 插件

- [`examples/plugins/feature-panel-sample`](../examples/plugins/feature-panel-sample)
  —— 最小的 trusted-tier 插件，贡献一个 left 侧边栏 panel（`notes-panel`，
  内联 SVG 图标 + `order` + `badge`）+ 一个 **Notes: Open Panel** 命令（⌘P）。
  panel 是个临时文本框，"Insert into doc" 按钮通过进程内 editor store 把内容
  追加到当前 markdown 文档（trusted tier = 直接访问 store）。

### tools

```jsonc
"tools": [{ "id": "hello", "title": "Hello Tool", "icon": "🛠", "window": true, "entry": "index.html" }]
```

- `window: true` 把工具放进独立的 Tauri `WebviewWindow`，从
  `quill-plugin://localhost/<id>/<entry>` 加载 HTML。窗口 origin 为
  `quill-plugin://localhost`（macOS/Linux）/ `http://quill-plugin.localhost`（Windows）
  ——与主 app 隔离。`window: false` 会内联渲染（MVP：仅支持 `window: true`；
  内联 panel 是后续工作）。
- `entry` 是 HTML 入口文件（sandbox tier）。trusted tier 用 component entry-ref
  （推迟——本 MVP 仅出 sandbox 工具窗口）。
- host 为每个 tool 注册一个 "Open: <title>" 命令，⌘P → "Open: Hello Tool"
  就能创建新窗口。多实例：每次调用开一个新窗口，label 唯一。
- 插件 HTML 通过 `quill-plugin://` scheme 的 **fetch-RPC** 访问 host 能力：

  ```js
  // POST quill-plugin://localhost/<plugin-id>/rpc
  // body: { "method": "<rpc-method>", "params": { ... } }
  // 响应: 成功 → 200 + <返回值>（按方法不同，对象/string/null）；
  //       失败 → 200 + { "error": "<msg>" }；
  //       超时 30s → 504 + { "error": "rpc timeout" }。
  const res = await fetch('quill-plugin://localhost/<plugin-id>/rpc', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ method: 'vault:insert-content', params: { content: '\nhello\n' } }),
  });
  const json = await res.json();           // 成功为 { ok: true }
  if (!res.ok || json?.error) {            // null-safe：成功 body 可能是原始值
    throw new Error(json?.error || `HTTP ${res.status}`);
  }
  ```

  Rust URI handler 发 `plugin-rpc-request` 事件，主 webview 通过共享的
  `dispatchPluginRpc` dispatch（与 iframe 桥相同的权限校验 + 路径解析）。见上方
  "一览" 中的方法表，下方 "Sandbox RPC 协议" 看协议细节。插件 bundle 不依赖
  Tauri SDK——只用纯 `fetch()`。
- 关闭 WebviewWindow（用户 OS 关闭或插件 deactivate）即销毁窗口。插件 deactivate
  会关闭该插件所有打开的工具窗口，与注销命令在同一 dispose pass 中完成。

#### 参考：示例工具插件

- [`examples/plugins/hello-tool`](../examples/plugins/hello-tool) —— 最小 sandbox
  工具，通过 RPC 桥写剪贴板。
- [`examples/plugins/markdown-table`](../examples/plugins/markdown-table) —— 端到端
  demo：textarea → markdown 表格 → Insert 按钮 → `vault:insert-content` RPC →
  表格被追加进当前文档。

### exporters（仅 trusted）

```jsonc
"exporters": [
  { "id": "txt-with-header", "format": "txt-header", "label": "Text with header", "fileExtension": "txt", "run": "txt-with-header" }
]
```

- `format` 是输出格式 id（插件内唯一）；palette 命令 id 为
  `plugin.<pluginId>.export.<format>`。
- `label` 是菜单标签；注册的命令标题为 `Export as <label>`。
- `fileExtension` 是输出扩展名（不带点，如 `txt`）。
- `run` 是模块 `exporters` map 的 **entry-ref**。handler 签名为
  `(content: string, ctx: { filePath, vaultRoot }) => Promise<Blob | string>`；
  返回 `string` 会被包成 `text/plain` Blob。运行命令时 host 用 `getActiveDocument`
  读当前文档，调 handler，再通过共享的 `downloadBlob` chokepoint 写文件
  （与内置导出走同一条 save-dialog + `writeFile` 路径）。

### fileTemplates（仅 trusted）

```jsonc
"fileTemplates": [
  { "id": "meeting-notes", "label": "Meeting Notes", "fileName": "meeting-notes.md", "template": "# Meeting Notes\n\n", "icon": "📝" }
]
```

- 纯声明式——无模块 map。每条会注册进 host 的 `fileTemplateRegistry`
  （key 为 `<pluginId>.<templateId>`）并暴露 palette 命令
  `plugin.<pluginId>.new.<templateId>`，标题 `New <label>`。运行命令会弹保存
  对话框（默认路径在当前 vault root 下），把 `template` 原样写入，再刷新文件树。
- ponytail：文件树右键「新建」子菜单暂未接入——其内联重命名流程按扩展名从
  `prefsStore.fileTemplates` 取内容，无法承载任意 body。palette 命令是 MVP 的
  用户入口；子菜单分组是升级路径（读 `getPluginFileTemplates()`）。

### keybindings（仅 trusted）

```jsonc
"keybindings": [
  { "command": "plugin.my-plugin.greet", "key": "Control+Alt+Shift+T", "mac": "Cmd+Alt+Shift+T", "when": "..." }
]
```

- `command` 是命令 id——可以是插件贡献的命令（`plugin.<pluginId>.<id>`）或
  内置命令（如 `action.toggle-theme`）。按键触发时 host 在 `commandRegistry`
  里查并运行它。
- `key` 是 Tauri accelerator（`Cmd+Shift+K`、`Control+Alt+T`）。
- `mac` 覆盖 macOS。`when` 是可选的激活子句（opaque 字符串，预留——MVP 全局注册）。
- ponytail：项目未装 `@tauri-apps/plugin-global-shortcut`，所以绑定是 app 级
  `keydown` 监听器——只在 app 窗口聚焦时触发，后台不触发。OS 全局的升级路径是
  `plugin-global-shortcut` 的 `register(accelerator, handler)` + dispose 里
  `unregister(accelerator)`。

---

## PluginModule 导出契约（trusted tier）

Trusted 插件的 `main` 是一个 ESM 模块。host `import()` 后读取其 **named exports**
作为 `PluginModule`：

```ts
// index.js —— 自包含的 ESM bundle
export const handlers: Record<string, FileTypeHandler> = { 'default': { ... } };
export const containers: Record<string, ComponentType<ContainerProps>> = { 'todo': TodoComp };
export const commands: Record<string, () => void | Promise<void>> = { 'greet': () => {} };
export const features: Record<string, ComponentType<unknown>> = { 'my-panel': Panel };
export const exporters: Record<string, ExporterHandler> = { 'txt-with-header': exportTxt };
export function activate(ctx: PluginContext) { /* 可选 */ }
export function deactivate(ctx: PluginContext) { /* 可选 */ }
```

各个 map **以 entry-ref 为 key**——即 manifest `contributes.*[].run` / `.handler`
/ `.component` / `.entry` 中填的字符串。模块 export 中找不到的 entry-ref 会被跳过
并打 console 警告（best-effort：部分插件仍能加载其他 contribution）。
`fileTemplates` 与 `keybindings` 是声明式的——无模块 map。

也接受 default-export 工厂 `(ctx) => PluginModule`（loader 会归一两种形态）。详见
`contributionAdapters.ts` 的具体解析规则。

### Trusted tier 打包

Trusted loader 把你的 `main` 包成 **blob URL** 再 `import()`。Blob URL 没有路径，
所以：

- **相对 import 解析不了**（`./utils.js` 会失败）
- **远程 import 被 `quill-plugin://` CSP 拦截**
- **bare specifier**（`react`、`@/store/...`）只有在 Vite 让其作为运行时 `import()`
  时，才能解析到 host realm 已加载的模块。保险起见，**打包你的依赖**（Vite/Rollup/
  esbuild），让 blob-URL `import()` 完全自包含。

`markdown-todo` 样本绕开这点的方法是把所有 bare-specifier import 放 **函数内部**
（懒加载，不在 module-eval 时执行），且用变量 specifier 让 Vite 不静态解析。
demo 能跑；真实插件应该 bundle。

---

## Sandbox RPC 协议（sandbox tier）

Sandbox 插件的 `index.html` + `index.js` 在 sandboxed iframe 中运行，origin 为
`null`（opaque）。通往 host 能力的唯一桥梁是 `window.parent.postMessage`。host 的
`RpcBridge` 每次调用都会校验 manifest 的 `permissions`。

消息协议（见 `rpcBridge.ts`）：

```
iframe → host: { type: 'request',        id, method, params }   // RPC 调用
host → iframe: { type: 'response',       id, result?, error? }  // RPC 响应
host → iframe: { type: 'lifecycle',      event: 'activate'|'deactivate' }
host → iframe: { type: 'invoke',         id, command, params? } // host 调声明的命令
iframe → host: { type: 'invoke-result',  id, result?, error? }
```

可用 RPC 方法（均受 manifest `permissions` 把守）：

| 方法 | 参数 | 权限 |
|---|---|---|
| `fs:read` | `{ path }` | `fs.scope`（glob，相对插件 data dir） |
| `fs:write` | `{ path, content }` | `fs.scope` |
| `fs:list` | `{ path }` | `fs.scope` |
| `http:fetch` | `{ url, init? }` | `http.origins`（白名单） |
| `clipboard:read` | `{}` | `clipboard: true` |
| `clipboard:write` | `{ text }` | `clipboard: true` |
| `dialog:open` | `{}` | `dialog: true` |
| `dialog:save` | `{ content }` | `dialog: true` |
| `vault:read-active-doc` | `{}` | `vault.readActive: true` |
| `vault:insert-content` | `{ content }` | `vault.insertContent: true` |
| `window:open` | `{ toolId }` | `window: true` |

完整示例见 `examples/plugins/hello-tool/index.js`——iframe 脚本把 `postMessage`
封装成 Promise 风格的 `rpc()` helper。

#### `http:fetch` 路由（CSP 旁路）

`http:fetch` 不在 host webview 跑 `fetch()`。Host webview 的 CSP
`connect-src 'self' ipc: http://ipc.localhost` 不包含插件声明的 origin，直接
`fetch()` 在 release 会被拦（dev 不注入 CSP 掩盖了 bug）。RPC 桥改为调用 Rust
命令 `plugin_http_fetch(plugin_id, url, method?, headers?, body?)`，用 `reqwest`
发请求（无 CSP），返回 buffered `{ status, headers, body }`，与旧 `fetch()` 形状
一致。

origin 校验双层：

1. **JS 快速失败**——`rpcBridge` 在 IPC 前调 `isOriginAllowed(url, manifest.permissions.http.origins)`；
   不在白名单的 origin 根本到不了 Rust。
2. **Rust 纵深防御**——`plugin_http_fetch` 重新读磁盘上 `manifest.json` 的
   `permissions.http.origins` 再校验一次，即便未来 JS 桥被绕过，也无法把数据
   送到未声明的 origin。

流式响应超出 MVP 范围（buffered `{body: string}`）。

---

## 权限模型

两个 tier 执行权限的方式截然不同。**这是核心设计权衡**（见 prd.md ADR-lite +
research/vscode-extension-host.md §3）。

### sandbox tier —— host 中介（硬边界）

iframe **没有任何 Tauri API**。每次特权调用都走 `postMessage` RPC 桥，桥先校验
manifest 声明的 `permissions` 再 dispatch。Sandbox 插件无法绕过——根本不存在通往
原生 Tauri 的路径。这就是 VSCode extension-host 模型：隔离让能力范围化的 API 可
强制执行。

### trusted tier —— TOFU + 设计现实（软边界）

Trusted 插件运行在 **主 webview realm**，本身已有 `capabilities/default.json`
赋予的宽泛 Tauri 能力（`fs:scope-home-recursive`、`shell:allow-spawn` 等）。
`grant_plugin_capabilities` Rust 命令调 `add_capability` 加范围化权限——但这是
**additive / 冗余**，不是 confinement。Trusted 插件仍可直接 `import('@tauri-apps/api/core')`
用主窗口已有的能力。

**Trusted tier 真正的安全边界是 TOFU 门槛**（完整性 + 用户 pin），不是
`add_capability`。一旦你批准了一个 trusted 插件，它就有完整权限。这是 VSCode
"in-process host = 软同意门" 的权衡，trusted tier 明确接受：

> TOFU-pinned = 用户显式信任 = 完整权限。

不要假装 `grant_plugin_capabilities` 是硬沙箱。需要硬边界装第三方插件，用
**sandbox tier**。

---

## AI 能力（`permissions.ai`）

Quill 的 AI 面（chat 走 `runRigChat`、feature agent 走 `runFeatureAgent`）以
host 中介的能力暴露给插件。host 持有 provider/model/apiKey；插件永远看不到凭证。

### 权限声明

```json
"permissions": {
  "ai": { "chat": true, "agents": ["study"], "edit": true }
}
```

- `chat`（boolean）——`ctx.ai.chat`（trusted）或 `ai:chat` RPC（sandbox）必填。
- `agents`（string[]）——允许插件驱动的 feature 名白名单。空/缺 = 不能调
  agent。**仅 trusted。**
- `edit`（boolean）——`ctx.ai.editFile` / `ctx.ai.createFile` 必填（仅 trusted）。
  host 把结果文件改动通过共享的 editor/vault chokepoint 应用；插件本身不写文件系统。

### Trusted tier —— `PluginContext.ai`

```ts
ctx.ai.chat({
  sessionId: 'my-plugin-session',   // 插件自管；rig 按 id 持久化历史
  prompt: '用 3 个要点总结当前文档',
  onEvent: (e) => { /* e.type ∈ 'text'|'thinking'|'error'|'done' */ },
  useSharedSession: true,            // 可选：同时在 aiPanel 里露出
});

ctx.ai.agent({
  feature: 'study',                  // 必须在 permissions.ai.agents 里
  instruction: '复习我的笔记',
  onEvent: (e) => { /* 'done' | 'error' */ },
});

// AI 驱动的文件编辑（仅 trusted，需 permissions.ai.edit）。host 通过 vault
// manager 读写文件；插件只表达意图 + 收流式进度。
await ctx.ai.editFile({
  path: 'notes/summary.md',           // vault 相对路径
  instruction: '总结成 3 个要点',
  onEvent: (e) => { /* 'text' | 'error' | 'done' */ },
});
await ctx.ai.createFile({
  path: 'notes/new-note.md',
  instruction: '起草一个会议纪要骨架',
  onEvent: (e) => {},
});
```

`onEvent` 镜像 `CliStreamEvent`，但过滤掉 `tool_*` / `file_change`——插件只
看到 text / thinking / error / done。provider/model 来自 host 的
`useAiConfigStore`；apiKey 不会出现在 `ctx` 或 RPC 参数里。

### Sandbox tier —— `ai:chat` RPC

Sandbox 插件无法调 feature agent（canonical agent 文件位于 vault 的
`__<feature>__/` 目录；sandbox 隔离下安全暴露它们超出范围）。需要 `ai.agent`
请用 trusted tier。

---

## 生命周期：activate / deactivate / dispose

Host 调用插件可选的 `activate(ctx)` / `deactivate(ctx)` 钩子。你注册的每个
contribution 都返回一个 `Disposable`；host 在 deactivate 时统一回收，所以即使
你的 `deactivate` 缺失或抛错，contribution 也会自动注销。

- **install** → `installed` 状态。尚未加载代码。
- **activate** → loader 加载模块；contribution adapter 把 commands/fileTypes/
  containers/features 接入 app 注册表；你的 `activate(ctx)` 执行（如有）。
- **deactivate** → 你的 `deactivate(ctx)` 执行（如有）；所有 disposable 回收
  （命令注销、containers 移除、trusted 的 blob URL revoke / sandbox 的 iframe
  销毁）。
- **uninstall** → deactivate（如激活中）+ 从 `plugins.json` 移除 + 删插件文件夹。

激活/ deactivate 失败会把状态置为 `failed`，错误在 Settings → Plugins UI 显示。

---

## TOFU 审批流程

Sandbox 插件安装即自动激活（其边界是 iframe，无需审批）。Trusted 插件需要显式
批准：

1. 安装 trusted 插件（Settings → Plugins → 从文件夹安装…）。列表中出现，状态为
   "已安装"，带一个 **批准并授权** 按钮。
2. 点 **批准并授权**。弹出同意 modal，列出声明的 permissions + contributions，
   并警告 trusted 插件拥有完整 host 权限。
3. 确认 → `approve_plugin(id)` 在 `plugins.json` 中设 `trusted: true`，并 emit
   `plugin://approved`。host 的 listener 激活插件。
4. 取消 → 插件保持已安装但未批准。仍可卸载。

批准后插件立刻激活，且之后每次 app 启动都会激活（`App.tsx` 的 hydrate 循环看到
`trusted: true` 即激活）。

---

## 完整性升级路径（ed25519 脚手架）

PR3 在安装时计算每文件 SHA-256 完整性 map，trusted loader 在 `import()` 前校验
`main` 的哈希。这是 **MVP 门槛**——证明磁盘上的字节与被批准时一致（篡改检测），
但不证明 publisher 身份。

PR4 在其上加 **ed25519 签名脚手架**：

- manifest 可携带 `signature`（base64 ed25519 签名，覆盖 canonicalized manifest JSON）
  和 `publisherPublicKey`（base64 ed25519 公钥）。
- `verify_plugin_signature(manifest, signature, publicKey)` 是纯 Rust 函数：无签名
  返回 `Ok(())`（MVP：可选），有签名则校验。
- 安装时若有签名，best-effort 校验（非致命——只打 stderr；SHA-256 仍是门槛）。
- `verify_plugin_signature_cmd` Tauri 命令让未来的诊断 UI 在批准前显示"签名无效"。

### 迁移到强制签名

当 marketplace 上线：

1. 加配置开关（如 `requireSignatures: true`）。
2. `verify_plugin_signature` 在 `signature` 为 `None` 且开关打开时返回 `Err`。
3. 在同意 modal 中显示"此插件未签名"。
4. 固定 publisher 公钥到可信集合；首次批准 TOFU-pin（`publisherPublicKey` 持久化
   到 `plugins.json`，后续更新换 key 会重新触发同意）。

对现有插件无破坏性变更——未签名插件在开关打开前一直可用。脚手架已就位，门槛只是
尚未强制。

---

## 本地开发

### 把文件夹丢进 ~/.quill/plugins/

最简单的 dev loop：把插件文件夹复制到 `~/.quill/plugins/<plugin-id>/`。下次 app
启动时 `App.tsx` 的 hydrate 循环读 `plugins.json` + 各 manifest 安装/激活。Sandbox
插件的 HTML/JS 改动通过重载 app 即可生效（iframe 重新从 `quill-plugin://` fetch）。
Trusted 插件则 deactivate → activate 拿新代码（loader 每次激活创建新 blob URL）。

### 从文件夹安装的 UI

用 Settings → Plugins → 从文件夹安装…，选你的 dev 文件夹。文件夹名必须是插件
kebab-case id。会把文件夹复制进 `~/.quill/plugins/<id>/` 并安装。

### Dev server（sandbox tier）

因为 `html` 从 `quill-plugin://localhost/<id>/<html>` 加载，不能直接指向
`http://localhost:5173`（跨 origin）。热重载方案：

- 每次改动后重装（小插件最快），或
- 跑 dev server 并通过 `quill-plugin://` scheme 代理（未来增强——MVP 没有）。

### Trusted tier + Vite

使用 JSX/TSX 的 trusted 插件需要构建步骤。最小 `vite.config.ts`：

```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: { lib: { entry: 'index.tsx', formats: ['es'], fileName: 'index' } },
});
```

输出 `dist/index.js`，manifest 设 `main: "dist/index.js"`。bundle 必须自包含
（内联 React 或标记为 external 依赖 host realm——见上方"Trusted tier 打包"）。

---

## 打包

MVP：**未打包的文件夹**。安装命令把包含 `manifest.json` + 资源的文件夹复制进
`~/.quill/plugins/<id>/`。目前不支持 zip / tarball / npm-pack——zip 解压明确推迟。

今天分发插件的方式：发文件夹（自己 zip 给用户下载；用户解压到本地路径，通过文件夹
对话框安装）。

未来：`.quill-plugin` archive（文件夹的 zip）+ marketplace 下载会在签名链强制后上线。
ed25519 脚手架（见上）已为其就位。

---

## 参考：示例插件

- [`examples/plugins/hello-tool`](../examples/plugins/hello-tool) —— sandbox tier。
  贡献一个 command + 一个 tool。iframe 脚本把 `postMessage` 封装成 Promise 风格
  的 `rpc()` helper，演示 `clipboard:read` / `clipboard:write`。
- [`examples/plugins/markdown-todo`](../examples/plugins/markdown-todo) —— trusted
  tier。贡献一个 `:::todo` 容器指令（交互式 checkbox 列表）+ 一个
  **Todo: Insert Checklist** 命令。纯 ESM，无需 bundler（React + editor store 在
  函数内 lazy-import，blob-URL `import()` 能干净加载）。
- [`examples/plugins/markdown-table`](../examples/plugins/markdown-table) ——
  sandbox tier。端到端 fetch-RPC demo：textarea 输入 → 生成 markdown 表格 →
  Insert 按钮 → `vault:insert-content` → 表格追加进当前文档。
- [`examples/plugins/feature-panel-sample`](../examples/plugins/feature-panel-sample)
  —— trusted tier。贡献一个 `features` 侧边栏 panel（`notes-panel`，left slot，
  内联 SVG 图标 + `order` + `badge`）+ 一个 **Notes: Open Panel** 命令。演示
  数据驱动的 activity bar / 侧边栏挂载路径，以及 panel 组件内进程内 editor
  store 访问。
- [`examples/plugins/plugin-export-demo`](../examples/plugins/plugin-export-demo)
  —— trusted tier。在一个小插件里演练三个新贡献点：一个 `exporters`（当前
  文档 → 带表头的 `.txt`）、一个 `fileTemplates`（**New Meeting Notes** 面板
  命令）、一个 `keybindings`（`Cmd/Ctrl+Alt+Shift+T` → 一个 **Demo: Ping**
  命令）。纯 ESM，无 JSX、无 React。

任一都通过 Settings → Plugins → 从文件夹安装… 装，手动 QA 全流程。
