# Folyn 插件开发指南

Folyn 的微内核让你可以在运行时扩展编辑器：装一个插件文件夹，它的文件类型、命令、
容器指令、功能面板或工具窗口立刻可用——无需重新编译、无需重新打包。

本指南覆盖：manifest schema、两种执行 tier、contribution 点位、权限模型、生命周期、
TOFU 审批流程、本地开发、打包。示例插件位于
[`examples/extensions/`](../examples/extensions/)。

- [快速开始](#快速开始)
- [一览：host 对外提供什么](#一览host-对外提供什么)
- [两种 tier](#两种-tier)
- [manifest.json schema](#manifestjson-schema)
- [Contribution 点位](#contribution-点位)
- [ExtensionModule 导出契约（trusted tier）](#extensionmodule-导出契约trusted-tier)
- [Sandbox RPC 协议（sandbox tier）](#sandbox-rpc-协议sandbox-tier)
- [权限模型](#权限模型)
- [生命周期：activate / deactivate / dispose](#生命周期activate--deactivate--dispose)
- [TOFU 审批流程](#tofu-审批流程)
- [本地开发](#本地开发)
- [打包](#打包)
- [采集器（活动采集）](#采集器活动采集)
- [参考：示例插件](#参考示例插件)

---

## 快速开始

最快路径：把 [`examples/extensions/markdown-todo`](../examples/extensions/markdown-todo)
复制到一个文件夹，然后通过 **Settings → Extensions → 从文件夹安装…** 安装。
文件夹名必须是插件的 kebab-case id（如 `markdown-todo`），插件就会出现在列表里。
Trusted tier 插件还需额外点一次 **批准并授权**（见 [TOFU](#tofu-审批流程)）。

安装 + 启用后：

- `markdown-todo` 插件贡献一个 `:::todo` 容器指令（在 `/` 菜单输入 `/todo`）
  和一个 **Todo: Insert Checklist** 命令（⌘P → "Todo: Insert Checklist"）。
- `hello-tool` 插件（sandbox tier）贡献一个 **Hello: Greet** 命令，通过 host RPC
  桥写入剪贴板。

### 安装 SDK

用 `folyn-extension-sdk` 给你的 manifest 做类型守卫——已发布在
[npm](https://www.npmjs.com/package/folyn-extension-sdk) 上的类型包
（manifest schema、贡献点、`ExtensionModule`、AI 能力类型，以及 `defineExtension`/
`validateManifest` 等 dev helper）。它无运行时依赖；React 仅作 peer 类型
（type-only 消费者在构建时被擦除）。

```bash
npm install folyn-extension-sdk
```

```ts
// index.ts —— trusted tier 插件入口模块
import type { ExtensionModule, ExporterHandler } from "folyn-extension-sdk";

const exportTxt: ExporterHandler = async (content, ctx) =>
  `# ${ctx.filePath}\n\n${content}`;

export const exporters: Record<string, ExporterHandler> = {
  "txt-with-header": exportTxt,
};
export const commands = { ping: () => console.info("pong") };
```

内部 workspace 插件依赖 `@folyn/extension-host`（它 re-export 了完整 SDK 面）——
从两边 import 都可以。运行时微内核（`ExtensionHost`、`extensionHost` 单例）留在
`@folyn/extension-host`；SDK 保持可发布、无运行时。

---

## 一览：host 对外提供什么

一个 Folyn 插件是 `~/.folyn/extensions/<id>/` 下的一个文件夹，包含 `manifest.json`

- 资源文件。host 给你五样东西：

### 1. 两种执行 tier

| Tier      | 隔离                                                                 | 能力面                                  | 信任门槛                        |
| --------- | -------------------------------------------------------------------- | --------------------------------------- | ------------------------------- |
| `sandbox` | 独立 `WebviewWindow` 或 iframe，origin 为 `folyn-extension://localhost` | 仅能用 host RPC 桥，无 Tauri API        | 无（sandbox 本身就是边界）      |
| `trusted` | 主 webview realm（进程内）                                           | 完整 host realm + Zustand store + Tauri | TOFU：用户必须点 **批准并授权** |

### 2. Contribution 点位

在 manifest 的 `contributes` 中声明；activate 时由 host 接入对应注册表；deactivate
时自动注销。

| 点位                      | Sandbox | Trusted | 作用                                                        |
| ------------------------- | ------- | ------- | ----------------------------------------------------------- |
| `commands`                | ✓       | ✓       | 命令面板入口（⌘P）—— 注册 id 为 `extension.<extensionId>.<id>`    |
| `tools`（`window: true`） | ✓       | ✓       | "Open: <title>" 命令 → 弹出 Tauri WebviewWindow             |
| `fileTypes`               | ✗       | ✓       | 文件扩展名 → handler 映射                                   |
| `containers`              | ✗       | ✓       | `:::name` Markdown 指令 → React 组件                        |
| `features`                | ✗       | ✓       | 侧边栏 panel slot（activity bar 图标 + 组件）—— MVP 仅 left |
| `exporters`               | ✗       | ✓       | 自定义导出格式 → "Export as <label>" 面板命令               |
| `fileTemplates`           | ✗       | ✓       | 新建文件模板 → "New <label>" 面板命令                       |
| `keybindings`             | ✗       | ✓       | Tauri accelerator → 命令 id（app 级 keydown）               |
| `exportEnhancers`         | ✗       | ✓       | 导出 HTML/PDF 时对已渲染 DOM 的后处理变异                   |
| `markdownCodeRenderers`   | ✗       | ✓       | 带语言标签的 fenced code block → React 渲染器               |
| `editorLanguages`         | ✗       | ✓       | 编辑器内 fenced source 用的 CodeMirror language 扩展        |
| `highlightGrammars`      | ✗       | ✓       | 预览与 CodeFileViewer 里 fenced code 用的 highlight.js 语法 |
| `storageProviders`       | ✗       | ✓       | Settings → Storage & Sharing 里的云对象存储提供者           |
| `collectors`             | ✗       | ✓       | 活动采集器（poll / webhook）→ 活动时间线事件                |
| `activityDisplay`        | ✗       | ✓       | 事件类型的图标/颜色/详情字段/指标卡（声明式）                |
| `entityTypes`            | ✗       | ✓       | 实体图谱的自定义实体类型（声明式）                           |

### 3. RPC 方法表（sandbox tier —— host 中介）

Sandbox 插件通过 `postMessage`（iframe 传输）或
`fetch('folyn-extension://localhost/<id>/rpc', ...)`（工具窗口传输）调用 host 能力。
两者都走同一个 `dispatchExtensionRpc` 表——同样的权限校验、同样的路径解析。

| 方法                    | 参数                | 所需权限                    | 返回值                                       |
| ----------------------- | ------------------- | --------------------------- | -------------------------------------------- |
| `fs:read`               | `{ path }`          | `fs.scope`（glob）          | `string`（文件内容）                         |
| `fs:write`              | `{ path, content }` | `fs.scope`                  | `void` → `{ ok: true }`                      |
| `fs:list`               | `{ path }`          | `fs.scope`                  | `DirEntry[]`                                 |
| `http:fetch`            | `{ url, init? }`    | `http.origins`（白名单）    | `{ status, headers, body }`                  |
| `clipboard:read`        | `{}`                | `clipboard: true`           | `string \| null`                             |
| `clipboard:write`       | `{ text }`          | `clipboard: true`           | `void` → `{ ok: true }`                      |
| `dialog:open`           | `{}`                | `dialog: true`              | `string \| null`（文件路径）                 |
| `dialog:save`           | `{ content }`       | `dialog: true`              | `string \| null`                             |
| `vault:read-active-doc` | `{}`                | `vault.readActive: true`    | `{ path, content } \| null`                  |
| `vault:insert-content`  | `{ content }`       | `vault.insertContent: true` | `{ ok: true }`                               |
| `window:open`           | `{ toolId }`        | `window: true`              | `{ opened: true, toolId }`                   |
| `ai:chat`               | `{ sessionId, prompt, provider?, model?, images? }` | `ai.chat: true` | iframe：推 `ai-stream` 事件 + 最终 `response`；工具窗口：`{ jobId }`（用 `ai:chat-poll` 轮询） |
| `ai:chat-poll`          | `{ jobId }`         | `ai.chat: true`             | 仅工具窗口：`{ done, error?, text, thinking }`（自上次轮询以来的增量） |
| `storage:get`           | `{ key }`           | _（无——自命名空间）_        | 存储值或 `null`——与 trusted `api.storage` 同 key 空间            |
| `storage:set`           | `{ key, value }`    | _（无——自命名空间）_        | `{ ok: true }`——与 trusted `api.storage` 共用后端              |
| `env:get`               | `{}`                | _（无——env 非敏感）_        | `{ theme: 'light'\|'dark', locale: string }` |

**Host 主动推送的 env 事件**（无需请求;用户切换 theme 或 locale 时 host 推送到 iframe）:

```jsonc
{ "type": "env-event", "event": "theme",  "value": "dark" }
{ "type": "env-event", "event": "locale", "value": "zh" }
```

插件应在 `activate` 时调用 `env:get` 拿初值,然后监听 `env-event` 消息以就地更新。

**响应契约**：成功 → 按"返回值"列的 JSON 对象；失败 → `{ "error": "<msg>" }`
（HTTP 200）；超时 30s → HTTP 504 + `{ "error": "rpc timeout" }`。读取返回字段前
务必先检查 `json.error`。

### 4. manifest 校验规则（开发者必须遵守的规范）

- `id`：kebab-case，`^[a-z0-9]+(-[a-z0-9]+)+$`（至少一个连字符）。
  `~/.folyn/extensions/` 下的文件夹名必须等于 `id`。
- `version`：非空字符串（建议 semver）。
- `tier`：`"sandbox"` 或 `"trusted"`。
- `main`：非空字符串（入口模块的相对路径）。
- `sandbox` tier 必须有 `html`（加载进 iframe/窗口的 HTML 入口）。
- 文件完整性：安装时计算每个文件的 SHA-256；trusted tier 在 `import()` 前再次校验
  `main` 的哈希。被篡改则拒绝激活。

### 5. sandbox 插件的 CSP（HTML/JS 能做什么）

每个 `folyn-extension://localhost/<id>/<file>` 响应都带这个 CSP header：

```
default-src 'none';
  script-src 'unsafe-inline' folyn-extension:;
  style-src  'unsafe-inline';
  connect-src folyn-extension:;
```

对开发者意味着：

- ✓ HTML 中可内联 `<script>` 和 `<style>`。
- ✓ `<script src="index.js">`（同 scheme，来自插件自己的文件）。
- ✓ `fetch('folyn-extension://localhost/<id>/rpc', ...)`（RPC 桥）。
- ✗ 不能加载任何远程 script、style、font、image；也不能 `connect-src` 到其他 origin。
  需要网络访问就声明 `http.origins` 并调 `http:fetch` —— host 在 Rust 中发请求
  （不受 CSP 限制）。
- ✗ 不能嵌入 iframe、不能用 blob: 启 web worker（只允许 `folyn-extension:`）。
- ✗ 没有 `default-src` 兜底——每个 directive 都显式声明。

注：故意不用 `'self'`。Chromium 对 `folyn-extension://` 这类 custom scheme 不会把
`'self'` 解析为文档 origin，必须显式写 scheme source `folyn-extension:`。

---

## 两种 tier

每个插件在 manifest 里声明 `tier: "sandbox" | "trusted"`。tier 决定 loader、隔离
边界、能力面、可用的 contribution 点位。

|                   | **sandbox**                                                                                                       | **trusted**                                                                                                 |
| ----------------- | ----------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Loader            | 隐藏 `<iframe sandbox="allow-scripts">`（无 `allow-same-origin`），从 `folyn-extension://localhost/<id>/<html>` 加载 | `import(/* @vite-ignore */ blobUrl)` 进 **主 webview realm**                                                |
| 隔离              | 跨 origin opaque origin；无父 DOM、无 Tauri API、无 localStorage                                                  | 无——运行在 host realm；可读 Zustand store、调 Tauri、操作 DOM                                               |
| 能力面            | 仅 host RPC 桥（`postMessage`）；manifest 的 `permissions` 把守每一调用                                           | 完整 host realm 访问；无逐插件运行时 ACL，`permissions` 仅供信息（见 [权限模型](#权限模型)）        |
| 信任门槛          | 无（sandbox 本身就是边界）                                                                                        | TOFU：激活前必须 **批准并授权**                                                                             |
| 可用 contribution | `commands`、`tools`（window）                                                                                     | `commands`、`fileTypes`、`containers`、`features`、`tools`、`markdownCodeRenderers`、`editorLanguages`、`highlightGrammars`、`storageProviders`、`collectors`      |
| 热卸载            | 销毁 iframe 元素                                                                                                  | `dispose()` adapter + `URL.revokeObjectURL(blobUrl)`                                                        |
| 打包要求          | HTML + JS 由 iframe 通过 `folyn-extension://` 加载                                                                   | 自包含 ESM bundle（eval 时不能有相对/远程 import——blob URL 解析不了）                                       |

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
  // ~/.folyn/extensions/ 下的文件夹名必须等于此 id。
  "id": "my-extension",
  // 必填。人类可读的显示名。
  "name": "My Extension",
  // 必填。semver 风格的版本字符串。
  "version": "1.0.0",
  "author": "Jane Doe",
  // 引擎兼容性，如 ">=0.1.0"。可选但建议。
  "folyn": ">=0.1.0",
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
    "fs": { "scope": ["data/**", "vault:read-active"] },
    "http": { "origins": ["https://api.example.com"] },
    "clipboard": true,
    "dialog": true,
    "window": true,
    "vault": { "readActive": true, "insertContent": true },
    "ai": { "chat": true, "agents": ["study"], "edit": true },
  },

  // 可选。本插件添加到 app 的 contribution 点位。
  "contributes": {
    "commands": [
      {
        "id": "greet",
        "title": "Greet",
        "icon": "👋",
        "keywords": ["hi"],
        "run": "greet",
      },
    ],
    "fileTypes": [
      {
        "id": "json",
        "extensions": [".json"],
        "handler": "default",
        "defaultViewMode": "edit",
      },
    ],
    "containers": [
      {
        "name": "callout",
        "icon": "💡",
        "label": "Callout",
        "category": "layout",
        "component": "callout",
        "template": ":::callout\n:::",
        "description": "A callout",
      },
    ],
    "features": [
      {
        "id": "my-panel",
        "panel": "left",
        "component": "my-panel",
        "icon": "<svg>...</svg>",
        "title": "My Panel",
        "order": 50,
        "badge": "NEW",
      },
    ],
    "tools": [
      {
        "id": "my-tool",
        "title": "My Tool",
        "icon": "🛠",
        "window": true,
        "entry": "index.html",
      },
    ],
    "exporters": [
      {
        "id": "txt",
        "format": "txt-header",
        "label": "Text with header",
        "fileExtension": "txt",
        "run": "txt-with-header",
      },
    ],
    "fileTemplates": [
      {
        "id": "meeting-notes",
        "label": "Meeting Notes",
        "fileName": "meeting-notes.md",
        "template": "# Meeting Notes\n\n",
        "icon": "📝",
      },
    ],
    "keybindings": [
      {
        "command": "extension.my-extension.greet",
        "key": "Control+Alt+Shift+T",
        "mac": "Cmd+Alt+Shift+T",
      },
    ],
  },
}
```

### 校验规则

manifest 在安装时校验（Rust `validate_manifest` + TS `ExtensionHost.validateManifest`）。
规则：

- `id` 必须是 kebab-case（`^[a-z0-9]+(-[a-z0-9]+)+$`）——至少一个连字符，仅小写
  字母数字。`my-extension` ✓；`MyExtension` ✗；`myextension` ✗。
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

- `id` 是命令的本地 id；注册的 palette id 为 `extension.<extensionId>.<id>`
  （如 `extension.hello-tool.greet`）。
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
- `icon` 接受三种形式：内联 `<svg>...</svg>` 字符串（由宿主 `IconFromSvg` 原样渲染）；`.svg` 文件路径，相对于插件安装目录（宿主在 activate 时通过 `read_extension_file` 读取；文件缺失则告警并回退为空）；emoji 或短字符串，作为纯文本渲染（内置惯例，如 `💡`）。
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

- `id` 是 panel 的本地 id；不得与保留的内置 id（`files` / `wiki` /
  `calendar`）冲突。冲突（与内置 id 或已注册的插件 panel）会打
  warning 并拒绝第二次注册。
- `panel` 取 `left` / `right` / `bottom`。**MVP 仅实现 `left`**——`right` 和
  `bottom` 会打 warning 并跳过（right/bottom shell slot 是后续任务）。
- `component` 是模块 `features` map 的 **entry-ref**（见下方 `ExtensionModule`
  导出契约）。必须是 React 组件（渲染时包在 `PanelErrorBoundary` 内，插件
  panel 抛错不会白屏整个侧边栏）。
- `icon` **必填**。可以是原始内联 SVG 字符串（`<svg ...>...</svg>`），或
  `ThemeIcon` 名（解析 host 的 `assets/icons/*.svg`）。内联 SVG 是插件作者
  的自包含路径。
- `title` 是 tooltip + 无障碍标签。缺省时为 `<extensionId>/<id>`。
- `order` 可选。内置 id 占用 0（files）、10（wiki）、20（clips）、
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

- [`examples/extensions/feature-panel-sample`](../examples/extensions/feature-panel-sample)
  —— 最小的 trusted-tier 插件，贡献一个 left 侧边栏 panel（`notes-panel`，
  内联 SVG 图标 + `order` + `badge`）+ 一个 **Notes: Open Panel** 命令（⌘P）。
  panel 是个临时文本框，"Insert into doc" 按钮通过进程内 editor store 把内容
  追加到当前 markdown 文档（trusted tier = 直接访问 store）。

### tools

```jsonc
"tools": [{ "id": "hello", "title": "Hello Tool", "icon": "🛠", "window": true, "entry": "index.html" }]
```

- `window: true` 把工具放进独立的 Tauri `WebviewWindow`，从
  `folyn-extension://localhost/<id>/<entry>` 加载 HTML。窗口 origin 为
  `folyn-extension://localhost`（macOS/Linux）/ `http://folyn-extension.localhost`（Windows）
  ——与主 app 隔离。`window: false` 会内联渲染（MVP：仅支持 `window: true`；
  内联 panel 是后续工作）。
- `entry` 是 HTML 入口文件（sandbox tier）。trusted tier 用 component entry-ref
  （推迟——本 MVP 仅出 sandbox 工具窗口）。
- host 为每个 tool 注册一个 "Open: <title>" 命令，⌘P → "Open: Hello Tool"
  就能创建新窗口。多实例：每次调用开一个新窗口，label 唯一。
- 插件 HTML 通过 `folyn-extension://` scheme 的 **fetch-RPC** 访问 host 能力：

  ```js
  // POST folyn-extension://localhost/<extension-id>/rpc
  // body: { "method": "<rpc-method>", "params": { ... } }
  // 响应: 成功 → 200 + <返回值>（按方法不同，对象/string/null）；
  //       失败 → 200 + { "error": "<msg>" }；
  //       超时 30s → 504 + { "error": "rpc timeout" }。
  const res = await fetch("folyn-extension://localhost/<extension-id>/rpc", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      method: "vault:insert-content",
      params: { content: "\nhello\n" },
    }),
  });
  const json = await res.json(); // 成功为 { ok: true }
  if (!res.ok || json?.error) {
    // null-safe：成功 body 可能是原始值
    throw new Error(json?.error || `HTTP ${res.status}`);
  }
  ```

  Rust URI handler 发 `extension-rpc-request` 事件，主 webview 通过共享的
  `dispatchExtensionRpc` dispatch（与 iframe 桥相同的权限校验 + 路径解析）。见上方
  "一览" 中的方法表，下方 "Sandbox RPC 协议" 看协议细节。插件 bundle 不依赖
  Tauri SDK——只用纯 `fetch()`。

- 关闭 WebviewWindow（用户 OS 关闭或插件 deactivate）即销毁窗口。插件 deactivate
  会关闭该插件所有打开的工具窗口，与注销命令在同一 dispose pass 中完成。

#### 参考：示例工具插件

- [`examples/extensions/hello-tool`](../examples/extensions/hello-tool) —— 最小 sandbox
  工具，通过 RPC 桥写剪贴板。
- [`examples/extensions/markdown-table`](../examples/extensions/markdown-table) —— 端到端
  demo：textarea → markdown 表格 → Insert 按钮 → `vault:insert-content` RPC →
  表格被追加进当前文档。

### exporters（仅 trusted）

```jsonc
"exporters": [
  { "id": "txt-with-header", "format": "txt-header", "label": "Text with header", "fileExtension": "txt", "run": "txt-with-header" }
]
```

- `format` 是输出格式 id（插件内唯一）；palette 命令 id 为
  `extension.<extensionId>.export.<format>`。
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
  （key 为 `<extensionId>.<templateId>`）并暴露 palette 命令
  `extension.<extensionId>.new.<templateId>`，标题 `New <label>`。运行命令会弹保存
  对话框（默认路径在当前 vault root 下），把 `template` 原样写入，再刷新文件树。
- ponytail：文件树右键「新建」子菜单暂未接入——其内联重命名流程按扩展名从
  `prefsStore.fileTemplates` 取内容，无法承载任意 body。palette 命令是 MVP 的
  用户入口；子菜单分组是升级路径（读 `getExtensionFileTemplates()`）。

### keybindings（仅 trusted）

```jsonc
"keybindings": [
  { "command": "extension.my-extension.greet", "key": "Control+Alt+Shift+T", "mac": "Cmd+Alt+Shift+T", "when": "..." }
]
```

- `command` 是命令 id——可以是插件贡献的命令（`extension.<extensionId>.<id>`）或
  内置命令（如 `action.toggle-theme`）。按键触发时 host 在 `commandRegistry`
  里查并运行它。
- `key` 是 Tauri accelerator（`Cmd+Shift+K`、`Control+Alt+T`）。
- `mac` 覆盖 macOS。`when` 是可选的激活子句（opaque 字符串，预留——MVP 全局注册）。
- ponytail：项目未装 `@tauri-apps/extension-global-shortcut`，所以绑定是 app 级
  `keydown` 监听器——只在 app 窗口聚焦时触发，后台不触发。OS 全局的升级路径是
  `extension-global-shortcut` 的 `register(accelerator, handler)` + dispose 里
  `unregister(accelerator)`。

### exportEnhancers（仅 trusted）

```jsonc
"exportEnhancers": [
  { "name": "quote", "run": "enhance-quote" }
]
```

- `name` 是 enhancer 匹配的 key：一个 `:::` 容器指令 `name`，**或**一个
  文件扩展名（不含点）。host 两种查找都试，所以一个 enhancer 可以同时
  服务容器与文件预览。
- `run` 是模块 `exportEnhancers` map 的 **entry-ref**。handler 签名为
  `(body: HTMLElement, ctx: ExporterContext) => Promise<void>`——在已渲染的
  DOM 元素上原地变异，使其导出时自包含（如 canvas→SVG 捕获、内联异步
  内容、剥离 action 按钮）。
- handler 在 in-DOM 渲染稳定后（`renderMarkdownToHtmlViaDom` 中
  `processFilePreviews` 之后）于 **host realm** 运行，可直接使用
  `body.querySelector` / `body.appendChild`——插件模块作为 trusted blob-URL
  `import()` 运行在 host realm。
- 传给 enhancer 的 `body` 是 `[data-container]` 元素本身；若其内含
  `[data-file-preview-body]` 子元素（容器指令内渲染的文件预览），则用内层
  body。调用前会剥离 action 按钮。
- ponytail：enhancer 失败被 best-effort 吞掉（`.catch(() => {})`）——一个
  enhancer 挂了不能中断整个导出。多个插件注册同一 key → last-registered-wins；
  升级路径是 per-extension 优先级列表（若需要组合）。

### markdownCodeRenderers（仅 trusted）

```jsonc
"markdownCodeRenderers": [
  { "language": "plantuml", "aliases": ["puml", "pu"], "component": "PlantUmlMarkdownBlock" }
]
```

- `language` 是此 renderer 处理的 fenced code block 语言标签（开头 ` ``` ` 后的字符串）。host 的 `MarkdownPreview` 在渲染后的 `<pre>` 上找
  `language-*` class，命中注册表就 dispatch 给插件组件，否则走默认的
  `CodeBlockWrapper`。
- `aliases`（可选）是解析到同一 renderer 的备选语言标签（如 PlantUML 的
  `puml` / `pu`）。
- `component` 是模块 `markdownCodeRenderers` map 的 **entry-ref**。组件接收
  `MarkdownCodeRendererProps`（`{ source, language, resolvedLanguage, filePath }`），
  负责渲染该 block（通常是把 `source` 转成预览/图）。
- 内置 `mermaid` 在 app 启动时先于插件注册，所以插件对同一 `language` 的
  注册是 first-registered-wins。未命中则回退到 `CodeBlockWrapper`
  （默认的语法高亮 `<pre>`）。
- ponytail：renderer 是 host-realm React（trusted blob `import()` 共用 host 的
  Reactor）；自带 React bundle 会触发 "Invalid hook call" 双 React 错误。用
  `window.React` 经 `resolveReact()` helper 拿（与下方 `resolveCodemirror()` 同
  形）。规范形态见 `folyn-extension-sdk/folyn-extension-plantuml/src/index.ts` 的
  `PlantUmlMarkdownBlock`。

### editorLanguages（仅 trusted）

```jsonc
"editorLanguages": [
  { "id": "plantuml", "aliases": ["puml", "pu"], "entry": "plantumlLanguage" }
]
```

- `id` 是 markdown 编辑器喂给 CodeMirror `codeLanguages` 查找的语言 id，
  让 fenced ` ```lang ` block 拿到正确的 `LanguageSupport` 扩展。host
  遍历 `editorLanguageRegistry`（含 aliases），未命中再回退到
  `@codemirror/language-data`。
- `aliases`（可选）是解析到同一 `LanguageSupport` factory 的备选 id
  （让 ` ```puml ` 和 ` ```plantuml ` 都点亮编辑器）。
- `entry` 是模块 `editorLanguages` map 的 **entry-ref**。factory 类型为
  `EditorLanguageFactory = () => unknown`；host 会把返回值窄化成 CodeMirror 6
  的 `LanguageSupport`。
- **Trusted tier 的 `window.codemirrorLanguage` 要求**：trusted 插件经 blob URL
  加载，`import '@codemirror/language'` 会解析到 _第二个_ module 实例，其
  `LanguageSupport` 在 host 的 `EditorState` 中不一定生效（module-instance
  mismatch——和自带 React bundle 是同一种失败）。用 `resolveCodemirror()` helper
  懒加载 host 的 `@codemirror/language`，从 `window.codemirrorLanguage` 拿
  （host 在 `main.tsx` 中于任何 trusted 插件 `import()` 前赋值）。规范形态见
  `folyn-extension-sdk/folyn-extension-plantuml/src/codemirror.ts`——与 `resolveReact()` 对
  `window.React` 的处理镜像。

### highlightGrammars（仅 trusted）

注册一个 highlight.js 语法，让预览里的 fenced ` ```lang ` 代码块和
`CodeFileViewer` 在内置 `hljs` 不自带的语言上也能高亮。与 `editorLanguages`
是分工关系：`editorLanguages` 点亮 **CodeMirror 编辑器**（就地编辑），
`highlightGrammars` 点亮 **渲染后的预览 / 文件查看器**（只读
`<pre><code>`，走 highlight.js）。

```jsonc
"highlightGrammars": [
  { "name": "plantuml", "aliases": ["puml", "pu"], "entry": "plantumlGrammar" }
]
```

- `name` 是要注册的 highlight.js 语言名（如 `plantuml`），作为规范 id；
  `aliases` 经 hljs 自身的别名机制注册为额外查找键。
- `aliases`（可选）是解析到同一语法的备选 fence 语言 / 文件扩展名
  （让 ` ```puml ` 与 ` ```plantuml ` 命中同一语法）。
- `entry` 是模块 `highlightGrammars` map 的 **entry-ref**。factory 类型为
  `HighlightGrammarFn = (hljs: unknown) => unknown`；收到 host 的 `hljs`
  实例，返回一个语言定义，host 经 `hljs.registerLanguage(name, fn)` 注册。
  类型标 `unknown` 是因为 SDK 不依赖 `highlight.js`——host 窄化。

### storageProviders（仅 trusted）

为 **Settings → Storage & Sharing** 增加一个云对象存储提供者
（图床 + HTML 分享），与内置的 R2 / 七牛 / OSS 并列。

```jsonc
"storageProviders": [
  {
    "id": "smms",
    "labelKey": "ext.smms.label",
    "icon": "🖼️",
    "capabilities": { "image": true, "html": false },
    "configForm": "form",
    "isConfigured": "isConfigured",
    "uploadImage": "uploadImage",
    "defaultConfig": { "token": "" }
  }
]
```

- `id` 在内置 + 扩展间全局唯一。它作为磁盘配置文件
  （`~/.folyn/image-hosts/<id>.json`）与 store 条目的 key。
- `labelKey` 是一个 i18n key，设置选择器用 host 的 `t()` 解析；自带你的
  i18n bundle（host **不**暴露它的 message catalog），在表单里用 `useTranslation()`。
- `icon` 是 emoji、内联 `<svg>`、`.svg` 路径或 host `ThemeIcon` 名
  （设置 UI 在名称已知时渲染 `ThemeIcon`，否则按文本显示）。
- `capabilities.image` / `capabilities.html` 声明本提供者服务哪些上传路径。
  只有提供了 `uploadImage` 才声明 `image: true`；只有提供了 `uploadHtml` 才声明
  `html: true`。
- `configForm` 是模块 `storageProviders` map 的 **entry-ref**，指向形状为
  `ComponentType<StorageConfigFormProps>` 的 React 组件——
  `{ config: unknown; onSave: (cfg) => Promise<void>; onRemove: () => Promise<void> }`。
  自管 draft 状态；在边界处把不透明的 `config` 窄化成你自己的类型。host 用
  error boundary 包裹表单，渲染抛错会被隔离。
- `isConfigured` 是 `(config: unknown) => boolean` 的 **entry-ref**——已存配置
  是否足够发起上传。决定选择器是否把该提供者显示为已配置。
- `uploadImage` / `uploadHtml` 是 `(bytes, ext, config) => Promise<publicUrl>` 与
  `(html, config) => Promise<publicUrl>` 的 **entry-ref**。config 是你表单存的
  任意值（host 视为不透明）。trusted 代码在 realm 内，可直接 `fetch()` 你的云
  API 并自己签名。
- `defaultConfig` 在首次选中该提供者时 seed 进 store。

host 把设置 UI 与图片粘贴 / markdown→HTML 分享流都走同一个
`StorageProviderRegistry`；内置与扩展提供者是同类东西，卸载会干净移除你的
条目，已存配置重置为你的 `defaultConfig`。

### 采集器（活动采集，仅 trusted）

采集器从一个数据源拉取/接收数据，转换成标准活动事件（活动时间线 + 实体
图谱）。采集器只做「拉取/接收 + 转换」——存储、去重、实体解析全由 host 的
ingest 管道负责。完整字段表（`contributes.collectors[]`、`activityDisplay[]`、
`entityTypes[]`、`CollectorEvent`、`CollectorContext`）见
`extension-sdk-reference.md` 的 "Collectors (activity collection)" 一节。规范示例：
[`extensions/file-collector`](../../extensions/file-collector)（poll 模式、快照
diff 游标、`authSchema` 含 `excludeDirs` + `allowAiSummary`）。

#### 模式

- **`poll`**——host 调度器按间隔调你的 `collect(ctx)`。声明的默认
  `pollIntervalMs` 被 host 压到 **60 s 下限**（任何采集器都不能快于 60s）；
  用户可以调大、按采集器关掉轮询、或手动「立即采集」——手动与定时走完全相同
  的 collect→push→cursor 路径。
- **`webhook`**——host 跑一个本地 webhook server（127.0.0.1），把入站 payload
  路由到你的 `onWebhook(payload, config)`。无游标；产出的事件直接 push。

#### 游标黄金规则

`collect()` 返回 `{ events, nextCursor }`。**游标只在 push 成功后才会持久化**——
失败的周期（collect 抛错、push 被拒、无打开的 vault）下次会重新读完全相同的
窗口，因此永远不会漏采或重复推进。把游标设计为 host 替你存储的不透明字符串
（文件采集器用 JSON 快照 blob；单调递增源用时间戳或 commit hash 也行）。没有
产出事件时**原样返回**旧游标。

#### 隐私（host 侧，每次 push 前）

- 事件的 `raw` 字段**在用户 keepRaw 开关关闭时被剥离**——把 `raw` 当作可能
  消失的调试数据，不要让 UI 依赖它。
- 用户的 redact 正则会应用到 `title` 和 `summary` 上。**别把敏感信息放进
  title/summary**——它们是时间线里展示的字段。

#### host 注入的 `ctx` 能力（各自强制什么）

`exec`/`http`/`frontWindow`/`scanVault`/`readVaultFile` 在测试与嵌入 host 中
不存在——务必先做特性检测。

| 能力 | host 强制什么 |
| --- | --- |
| `ctx.exec(program, args, cwd)` | Rust `activity_exec`：**程序白名单**（目前仅 `git`）。参数分离、无 shell → 无注入。需要别的二进制必须 host 侧扩列表。 |
| `ctx.http(url, init)` | URL 的 **origin 必须与** manifest `hostAllowlist` 条目**精确匹配**——否则请求发出前就抛错。这是安装时权限确认的运行时对应物。 |
| `ctx.frontWindow()` | Rust `activity_front_window`：**固定平台脚本**，无采集器可控参数。不可用返回 `null`。 |
| `ctx.scanVault({ excludeDirs })` | Rust `activity_scan_vault`：对当前 vault 的固定递归遍历；**`.git` 恒跳过**；路径为 vault 相对路径；采集器永远不知道 vault 绝对根路径。 |
| `ctx.readVaultFile(path, maxBytes?)` | Rust `activity_read_text_file`：**遍历安全**（`..`/绝对路径拒绝）、二进制与 >1MB 文件返回 `null`、输出截断（上限钳制 1 B–64 KB，默认 8 KB）。 |

#### `authSchema` → 设置页配置表单

`authSchema`（JSON-schema 风格 `{ type: 'object', properties }`，string 与
boolean 类型）会在**采集器设置页自动渲染为该采集器的配置表单**。保存的值在每次
collect/webhook 调用时通过 `ctx.config` 送达。文件采集器的惯例：`boolean` 的
`allowAiSummary` 控制详情面板 AI 事件摘要块是否出现。

#### 声明的 `activityTypes` 会被校验

每个事件的 `type` 必须在该采集器声明的 `contributes.collectors[].activityTypes`
内——Rust ingest 会拒绝未声明类型的事件（并且用采集器 id 自己盖章 `source`，
覆盖事件携带的任何值）。`id` 是去重键：惯例 `${source}:${externalId}`；稳定
id 重复 push 会被静默去重，这也是你的崩溃/重启安全网。

#### 最小接线

```jsonc
"contributes": {
  "collectors": [{ "id": "my-source", "activityTypes": ["my_event"], "mode": "poll", "pollIntervalMs": 300000, "hostAllowlist": [] }],
  "activityDisplay": [{ "type": "my_event", "icon": "star", "color": "blue" }],
  "entityTypes": [{ "id": "my_thing", "label": "Thing", "color": "green" }]
}
```

```ts
import type { ExtensionModule } from 'folyn-extension-sdk';

const module: ExtensionModule = {
  collectors: {
    'my-source': {
      id: 'my-source',
      async collect(ctx) {
        const cursor = ctx.cursor ?? '';
        // 经 ctx.exec / ctx.http / ctx.scanVault 自游标拉数据 …
        return { events: [], nextCursor: cursor };
      },
    },
  },
};
export default module;
```

`module.collectors` 的 key 是采集器 **id**（不是 entry-ref 字符串）。冲突规则：
第二个插件注册相同 `entityTypes` id 会被跳过并打日志 + 商店条目显示冲突徽标。

---

## ExtensionModule 导出契约（trusted tier）

Trusted 插件的 `main` 是一个 ESM 模块。host `import()` 后读取其 **named exports**
作为 `ExtensionModule`：

```ts
// index.js —— 自包含的 ESM bundle
export const handlers: Record<string, FileTypeHandler> = { 'default': { ... } };
export const containers: Record<string, ComponentType<ContainerProps>> = { 'todo': TodoComp };
export const commands: Record<string, () => void | Promise<void>> = { 'greet': () => {} };
export const features: Record<string, ComponentType<unknown>> = { 'my-panel': Panel };
export const exporters: Record<string, ExporterHandler> = { 'txt-with-header': exportTxt };
export const exportEnhancers: Record<string, ExportEnhancerHandler> = { 'enhance-quote': enhanceQuote };
export const markdownCodeRenderers: Record<string, ComponentType<MarkdownCodeRendererProps>> = { 'PlantUmlMarkdownBlock': PlantUmlBlock };
export const editorLanguages: Record<string, EditorLanguageFactory> = { 'plantumlLanguage': () => plantumlLanguage() };
export const highlightGrammars: Record<string, HighlightGrammarFn> = { 'plantumlGrammar': (hljs) => plantumlGrammar(hljs) };
export const storageProviders: Record<string, unknown> = {
  form: SmmsForm,                 // ComponentType<StorageConfigFormProps>
  isConfigured: (cfg: unknown) => !!(cfg as { token?: string }).token,
  uploadImage: async (bytes, ext, cfg) => { /* fetch 你的 API，私有签名 */ return url; },
};
export function activate(ctx: ExtensionContext) { /* 可选 */ }
export function deactivate(ctx: ExtensionContext) { /* 可选 */ }
```

各个 map **以 entry-ref 为 key**——即 manifest `contributes.*[].run` / `.handler`
/ `.component` / `.entry` 中填的字符串。模块 export 中找不到的 entry-ref 会被跳过
并打 console 警告（best-effort：部分插件仍能加载其他 contribution）。
`fileTemplates` 与 `keybindings` 是声明式的——无模块 map。

`markdownCodeRenderers` 的 key 对应 manifest 的 `component` 字符串；
`editorLanguages` 与 `highlightGrammars` 的 key 都对应 `entry`。完整示例（`handlers`、
`exporters`、`markdownCodeRenderers`、`containers`、`exportEnhancers`、
`editorLanguages`、`highlightGrammars`、`storageProviders`）见
`folyn-extension-sdk/folyn-extension-plantuml`。

也接受 default-export 工厂 `(ctx) => ExtensionModule`（loader 会归一两种形态）。详见
`contributionAdapters.ts` 的具体解析规则。

### Trusted tier 打包

Trusted loader 把你的 `main` 包成 **blob URL** 再 `import()`。Blob URL 没有路径，
所以：

- **相对 import 解析不了**（`./utils.js` 会失败）
- **远程 import 被 `folyn-extension://` CSP 拦截**
- **bare specifier**（`react`、`@/store/...`）只有在 Vite 让其作为运行时 `import()`
  时，才能解析到 host realm 已加载的模块。保险起见，**打包你的依赖**（Vite/Rollup/
  esbuild），让 blob-URL `import()` 完全自包含。

`markdown-todo` 样本绕开这点的方法是把所有 bare-specifier import 放 **函数内部**
（懒加载，不在 module-eval 时执行），且用变量 specifier 让 Vite 不静态解析。
demo 能跑；真实插件应该 bundle。

### 访问远程资源（trusted tier）

主窗口的 CSP 在 `tauri.conf.json` 构建时写死，**不包含第三方 origin**。
trusted 插件里直接 `fetch()` 或 `<img src=remote>` 在打包构建下会被 CSP 拦截
（dev 模式不强制 CSP，掩盖了 bug）。需要访问远程 origin 的插件必须走
`ctx.http.fetch` —— 该方法把请求路由到 Rust 的 `extension_http_fetch` 命令
（reqwest，在 webview 之外执行，不受 CSP 约束），并强制校验 manifest 中的
`permissions.http.origins`。

**第 1 步 —— 在 manifest 声明 origin：**

```jsonc
{
  "permissions": {
    "http": { "origins": ["https://www.example.com"] }
  }
}
```

**第 2 步 —— 在 `activate()` 缓存 `ctx.http`，到处复用：**

```ts
import type { ExtensionContext, ExtensionHttpCapability } from "folyn-extension-sdk";

let hostHttp: ExtensionHttpCapability | undefined;
export async function activate(ctx: ExtensionContext) { hostHttp = ctx.http; }
function http(): ExtensionHttpCapability {
  if (!hostHttp) throw new Error("extension: activate() not called");
  return hostHttp;
}

// 渲染场景：fetch → data URL → <img>
async function renderDiagram(source: string) {
  const { body, status } = await http().fetch(`https://www.example.com/svg/${encode(source)}`);
  if (status !== 200) throw new Error(`HTTP ${status}`);
  // base64 编码 UTF-8 SVG 文本，给 <img src>
  const dataUrl = `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(body)))}`;
  return dataUrl;
}

// 数据场景：fetch → JSON
const { body } = await http().fetch("https://api.example.com/data.json");
const data = JSON.parse(body);
```

**为什么这么设计**：manifest 是单一真相源——新增远程 origin 不需要改
Folyn 源码或主窗口 CSP。Host 在两处强制校验 allowlist（JS 侧快失败 + Rust 侧
从磁盘 manifest 二次校验）。

**渲染格式**：优先 `data:image/svg+xml;base64,...` URL，不要用 `blob:` URL
（需要 revoke 生命周期）或 inline `<svg>`（带 script 注入面）。

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

| 方法                    | 参数                | 权限                                  |
| ----------------------- | ------------------- | ------------------------------------- |
| `fs:read`               | `{ path }`          | `fs.scope`（glob，相对插件 data dir） |
| `fs:write`              | `{ path, content }` | `fs.scope`                            |
| `fs:list`               | `{ path }`          | `fs.scope`                            |
| `http:fetch`            | `{ url, init? }`    | `http.origins`（白名单）              |
| `clipboard:read`        | `{}`                | `clipboard: true`                     |
| `clipboard:write`       | `{ text }`          | `clipboard: true`                     |
| `dialog:open`           | `{}`                | `dialog: true`                        |
| `dialog:save`           | `{ content }`       | `dialog: true`                        |
| `vault:read-active-doc` | `{}`                | `vault.readActive: true`              |
| `vault:insert-content`  | `{ content }`       | `vault.insertContent: true`           |
| `window:open`           | `{ toolId }`        | `window: true`                        |

完整示例见 `examples/extensions/hello-tool/index.js`——iframe 脚本把 `postMessage`
封装成 Promise 风格的 `rpc()` helper。

#### `http:fetch` 路由（CSP 旁路）

`http:fetch` 不在 host webview 跑 `fetch()`。Host webview 的 CSP
`connect-src 'self' ipc: http://ipc.localhost` 不包含插件声明的 origin，直接
`fetch()` 在 release 会被拦（dev 不注入 CSP 掩盖了 bug）。RPC 桥改为调用 Rust
命令 `extension_http_fetch(extension_id, url, method?, headers?, body?)`，用 `reqwest`
发请求（无 CSP），返回 buffered `{ status, headers, body }`，与旧 `fetch()` 形状
一致。

origin 校验双层：

1. **JS 快速失败**——`rpcBridge` 在 IPC 前调 `isOriginAllowed(url, manifest.permissions.http.origins)`；
   不在白名单的 origin 根本到不了 Rust。
2. **Rust 纵深防御**——`extension_http_fetch` 重新读磁盘上 `manifest.json` 的
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

### trusted tier —— TOFU + 完整 host realm（明确模型）

Trusted 插件运行在 **主 webview realm**，本身已有 `capabilities/default.json`
赋予的完整 Tauri 能力（`fs:scope: [{"path":"**"}]`、`shell:allow-spawn`、dialog、
clipboard…）。**无逐插件运行时 ACL。** `grant_extension_capabilities` /
`add_capability` 不存在、未接线——它本该用的范围化权限条目格式会破坏 Tauri
的运行时 ACL（后续每次 fs 检查都报 `error deserializing scope: … EntryRaw`），
故从未连接。manifest 的 `permissions` 块**对 trusted tier 仅供信息**：运行时
不强制，因为 trusted 插件能直接访问 host realm 的完整面（如直接
`import('@tauri-apps/api/core')` 用主窗口已有能力）。

**Trusted 代码的唯一边界是 TOFU 门槛**（用户 pin + `main` 的 SHA-256 完整性
匹配，由 trusted loader 在 `import()` 前校验）。一旦你批准了一个 trusted
插件，它就有完整权限。这是 VSCode "in-process host = 软同意门" 的权衡，
trusted tier 明确接受：

> TOFU-pinned = 用户显式信任 = 完整权限。

需要给第三方插件硬的、范围化的边界？用 **sandbox tier**——那才是
`permissions` 真正被强制的 tier（每次 RPC 调用都按 manifest 校验）。

---

## AI 能力（`permissions.ai`）

Folyn 的 AI 面（chat 走 `runRigChat`、feature agent 走 `runFeatureAgent`）以
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

### Trusted tier —— `ExtensionContext.ai`

```ts
ctx.ai.chat({
  sessionId: "my-extension-session", // 插件自管；rig 按 id 持久化历史
  prompt: "用 3 个要点总结当前文档",
  onEvent: (e) => {
    /* e.type ∈ 'text'|'thinking'|'error'|'done' */
  },
  useSharedSession: true, // 可选：同时在 aiPanel 里露出
});

ctx.ai.agent({
  feature: "study", // 必须在 permissions.ai.agents 里
  instruction: "复习我的笔记",
  onEvent: (e) => {
    /* 'done' | 'error' */
  },
});

// AI 驱动的文件编辑（仅 trusted，需 permissions.ai.edit）。host 通过 vault
// manager 读写文件；插件只表达意图 + 收流式进度。
await ctx.ai.editFile({
  path: "notes/summary.md", // vault 相对路径
  instruction: "总结成 3 个要点",
  onEvent: (e) => {
    /* 'text' | 'error' | 'done' */
  },
});
await ctx.ai.createFile({
  path: "notes/new-note.md",
  instruction: "起草一个会议纪要骨架",
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

**工具窗口**（fetch 传输，无 postMessage）：`ai:chat` 立即返回 `{ jobId }`，
对话通过轮询流式呈现：

```js
const { jobId } = await rpc("ai:chat", { sessionId: "s", prompt: "hello" });
for (;;) {
  await sleep(150);
  const p = await rpc("ai:chat-poll", { jobId });
  // p: { done: boolean, error?: string, text: string, thinking: string }
  // text/thinking 是自上次轮询以来的新增量——追加渲染，不要整体替换。
  appendToBubble(p.text, p.thinking);
  if (p.error) throw new Error(p.error);
  if (p.done) break;
}
```

观察到 `done` 的那次轮询会在 host 侧删除 job；即使最后一次轮询的响应丢了，
下次轮询也返回 `{ done: true }`，循环总会终止。这也避开了 30s fetch 超时——
长对话不再长时间占住单个请求。

---

## Host 环境（theme + locale）

渲染 UI 的插件需要追踪 host 的 resolved theme（明亮/暗黑）和用户 locale，
并在用户运行时切换时跟随变化。Host 推送当前值 + 变更事件；**插件自带
i18n bundle**——host 的 `t()` 不暴露，只传 locale 字符串（如 `'zh'`、`'en'`）。

### Trusted tier —— `ExtensionContext.env`

```ts
import type { ExtensionContext } from "folyn-extension-sdk";

export function activate(ctx: ExtensionContext) {
  console.log("theme:", ctx.env?.theme, "locale:", ctx.env?.locale);

  ctx.addDisposable(
    ctx.env!.onThemeChange((t) => {
      // 用新 theme 重渲染
    }),
  );

  ctx.addDisposable(
    ctx.env!.onLocaleChange((l) => {
      // 切换 i18n bundle
    }),
  );
}
```

- `env.theme`:已 resolve 的 `'light' | 'dark'`——host 在交付前把 `'system'`
  解析为具体值，插件不会看到 `'system'`。
- `env.locale`:当前 locale 字符串。
- `env.onThemeChange(cb)` / `env.onLocaleChange(cb)`:订阅运行时变更;
  返回 `Disposable` 用于清理（推入 `ctx.addDisposable`）。

### Sandbox tier —— `env:get` RPC + `env-event` 推送

Sandbox 插件在 `activate` 时调 `env:get` 拿初值,然后监听 `env-event` 消息就地更新:

```js
// 在 sandbox iframe 内
window.parent.postMessage(
  {
    type: "request",
    id: "env-seed",
    method: "env:get",
    params: {},
  },
  "*",
);

window.addEventListener("message", (e) => {
  const msg = e.data;
  if (msg.type === "response" && msg.id === "env-seed") {
    applyEnv(msg.result.theme, msg.result.locale);
  }
  if (msg.type === "env-event") {
    if (msg.event === "theme") applyTheme(msg.value);
    if (msg.event === "locale") applyLocale(msg.value);
  }
});
```

无需声明权限——env 非敏感（无文件系统、无网络、无凭证;仅 theme + locale 字符串）。

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
- **uninstall** → deactivate（如激活中）+ 从 `extensions.json` 移除 + 删插件文件夹。

激活/ deactivate 失败会把状态置为 `failed`，错误在 Settings → Extensions UI 显示。

---

## TOFU 审批流程

Sandbox 插件安装即自动激活（其边界是 iframe，无需审批）。Trusted 插件需要显式
批准：

1. 安装 trusted 插件（Settings → Extensions → 从文件夹安装…）。列表中出现，状态为
   "已安装"，带一个 **批准并授权** 按钮。
2. 点 **批准并授权**。弹出同意 modal，列出声明的 permissions + contributions，
   并警告 trusted 插件拥有完整 host 权限。
3. 确认 → `approve_extension(id)` 在 `extensions.json` 中设 `trusted: true`，并 emit
   `extension://approved`。host 的 listener 激活插件。
4. 取消 → 插件保持已安装但未批准。仍可卸载。

批准后插件立刻激活，且之后每次 app 启动都会激活（`App.tsx` 的 hydrate 循环看到
`trusted: true` 即激活）。

---

## 完整性模型

每文件 SHA-256 完整性（安装时计算，加载时由 trusted loader 校验）是**唯一篡改门槛**：
证明磁盘上的字节与被批准时一致。**无签名验证**——ed25519 脚手架是推测性的（没有任何
插件携带过签名），已按 YAGNI 删除。publisher 身份认证超出范围，直到出现真实 marketplace
产生具体需求。

---

## 本地开发

### 把文件夹丢进 ~/.folyn/extensions/

最简单的 dev loop：把插件文件夹复制到 `~/.folyn/extensions/<extension-id>/`。下次 app
启动时 `App.tsx` 的 hydrate 循环读 `extensions.json` + 各 manifest 安装/激活。Sandbox
插件的 HTML/JS 改动通过重载 app 即可生效（iframe 重新从 `folyn-extension://` fetch）。
Trusted 插件则 deactivate → activate 拿新代码（loader 每次激活创建新 blob URL）。

### 从文件夹安装的 UI

用 Settings → Extensions → 从文件夹安装…，选你的 dev 文件夹。文件夹名必须是插件
kebab-case id。会把文件夹复制进 `~/.folyn/extensions/<id>/` 并安装。

### Dev server（sandbox tier）

因为 `html` 从 `folyn-extension://localhost/<id>/<html>` 加载，不能直接指向
`http://localhost:5173`（跨 origin）。热重载方案：

- 每次改动后重装（小插件最快），或
- 跑 dev server 并通过 `folyn-extension://` scheme 代理（未来增强——MVP 没有）。

### Trusted tier + Vite

使用 JSX/TSX 的 trusted 插件需要构建步骤。最小 `vite.config.ts`：

```ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  extensions: [react()],
  build: { lib: { entry: "index.tsx", formats: ["es"], fileName: "index" } },
});
```

输出 `dist/index.js`，manifest 设 `main: "dist/index.js"`。bundle 必须自包含
（内联 React 或标记为 external 依赖 host realm——见上方"Trusted tier 打包"）。

---

## 打包

MVP：**未打包的文件夹**。安装命令把包含 `manifest.json` + 资源的文件夹复制进
`~/.folyn/extensions/<id>/`。目前不支持 zip / tarball / npm-pack——zip 解压明确推迟。

今天分发插件的方式：发文件夹（自己 zip 给用户下载；用户解压到本地路径，通过文件夹
对话框安装）。

未来：`.folyn-extension` archive（文件夹的 zip）+ marketplace 下载会在出现真实 marketplace
产生具体 publisher 身份需求时上线。

---

## 参考：示例插件

- [`examples/extensions/hello-tool`](../examples/extensions/hello-tool) —— sandbox tier。
  贡献一个 command + 一个 tool。iframe 脚本把 `postMessage` 封装成 Promise 风格
  的 `rpc()` helper，演示 `clipboard:read` / `clipboard:write`。
- [`examples/extensions/markdown-todo`](../examples/extensions/markdown-todo) —— trusted
  tier。贡献一个 `:::todo` 容器指令（交互式 checkbox 列表）+ 一个
  **Todo: Insert Checklist** 命令。纯 ESM，无需 bundler（React + editor store 在
  函数内 lazy-import，blob-URL `import()` 能干净加载）。
- [`examples/extensions/markdown-table`](../examples/extensions/markdown-table) ——
  sandbox tier。端到端 fetch-RPC demo：textarea 输入 → 生成 markdown 表格 →
  Insert 按钮 → `vault:insert-content` → 表格追加进当前文档。
- [`examples/extensions/feature-panel-sample`](../examples/extensions/feature-panel-sample)
  —— trusted tier。贡献一个 `features` 侧边栏 panel（`notes-panel`，left slot，
  内联 SVG 图标 + `order` + `badge`）+ 一个 **Notes: Open Panel** 命令。演示
  数据驱动的 activity bar / 侧边栏挂载路径，以及 panel 组件内进程内 editor
  store 访问。
- [`examples/extensions/extension-export-demo`](../examples/extensions/extension-export-demo)
  —— trusted tier。在一个小插件里演练各贡献点：一个 `exporters`（当前
  文档 → 带表头的 `.txt`）、一个 `fileTemplates`（**New Meeting Notes** 面板
  命令）、一个 `keybindings`（`Cmd/Ctrl+Alt+Shift+T` → 一个 **Demo: Ping**
  命令）、一个 `containers`（`:::quote` 引用块，经 `window.React` +
  `createElement`）、一个 `exportEnhancers`（导出时的后渲染 DOM 变异）。
  纯 ESM，无 JSX、无打包步骤。

任一都通过 Settings → Extensions → 从文件夹安装… 装，手动 QA 全流程。
