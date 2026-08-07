# Plugin SDK Reference

Plugin SDK (`quill-plugin-sdk`) 类型契约与示例速查。运行时微内核（`PluginHost`）位于 `@quill/plugin-host`。

## 1. 安装

```bash
npm install quill-plugin-sdk
```

```ts
import type {
  PluginManifest,
  PluginModule,
  FileTypeHandler,
} from "quill-plugin-sdk";
import { definePlugin, validateManifest } from "quill-plugin-sdk";
```

内部 workspace 插件也可从 `@quill/plugin-host` 导入（re-export 全部 SDK 公共面）。SDK 无运行时依赖；React 仅作 peer 类型引用（构建时擦除）。

## 2. manifest.json 全字段表

| 字段                 | 类型                     | 必填         | 说明                                                        |
| -------------------- | ------------------------ | ------------ | ----------------------------------------------------------- |
| `id`                 | `string`                 | 是           | kebab-case `^[a-z0-9]+(-[a-z0-9]+)+$`，文件夹名须与 id 一致 |
| `name`               | `string`                 | 是           | 显示名                                                      |
| `version`            | `string`                 | 是           | 非空，推荐 semver                                           |
| `author`             | `string`                 | 否           | 作者                                                        |
| `quill`              | `string`                 | 否           | 引擎兼容性，如 `>=0.1.0`                                    |
| `tier`               | `'sandbox' \| 'trusted'` | 是           | 执行 tier                                                   |
| `main`               | `string`                 | 是           | 入口模块相对路径                                            |
| `html`               | `string`                 | sandbox 必填 | sandbox tier 的 HTML 入口                                   |
| `permissions`        | `PluginPermissions`      | 否           | 能力声明                                                    |
| `contributes`        | `ContributionPoints`     | 否           | 贡献点                                                      |
| `activation`         | `ActivationEvents`       | 否           | 懒激活触发                                                  |
| `signature`          | `string`                 | 否           | ed25519 签名（base64），MVP 可选                            |
| `publisherPublicKey` | `string`                 | 否           | 配对公钥（base64）                                          |

### permissions 子表

| 字段        | 类型                                                    | 说明                              |
| ----------- | ------------------------------------------------------- | --------------------------------- |
| `fs`        | `{ scope: string[] }`                                   | 文件读写 glob（相对插件数据目录） |
| `http`      | `{ origins: string[] }`                                 | 允许的 origin allowlist           |
| `clipboard` | `boolean`                                               | 剪贴板读写                        |
| `dialog`    | `boolean`                                               | 文件打开/保存对话框               |
| `window`    | `boolean`                                               | 打开 tool window                  |
| `vault`     | `{ readActive?: boolean; insertContent?: boolean }`     | 活动文档读写                      |
| `ai`        | `{ chat?: boolean; agents?: string[]; edit?: boolean }` | AI 能力，详见 §7                  |

### activation 子表

| 字段         | 类型       | 说明             |
| ------------ | ---------- | ---------------- |
| `onCommand`  | `string`   | 命令调用时激活   |
| `onFileType` | `string[]` | 匹配扩展名时激活 |
| `onLanguage` | `string[]` | 匹配语言时激活   |

## 3. 贡献点一览

| 贡献点                  | sandbox | trusted | manifest 字段                         | module map                       | 增加什么                                    |
| ----------------------- | ------- | ------- | ------------------------------------- | -------------------------------- | ------------------------------------------- |
| `commands`              | ✓       | ✓       | `contributes.commands[]`              | `module.commands`                | palette 条目（`plugin.<id>.<cmdId>`）       |
| `tools`                 | ✓       | ✓       | `contributes.tools[]`                 | sandbox HTML / trusted component | 独立 WebviewWindow                          |
| `fileTypes`             | ✗       | ✓       | `contributes.fileTypes[]`             | `module.handlers`                | 扩展名 → handler 映射                       |
| `containers`            | ✗       | ✓       | `contributes.containers[]`            | `module.containers`              | `:::name` Markdown 指令 → React 组件        |
| `features`              | ✗       | ✓       | `contributes.features[]`              | `module.features`                | 侧栏 panel                                  |
| `exporters`             | ✗       | ✓       | `contributes.exporters[]`             | `module.exporters`               | 自定义导出格式                              |
| `fileTemplates`         | ✗       | ✓       | `contributes.fileTemplates[]`         | （declarative，无 module map）   | 右键「新建」子菜单                          |
| `keybindings`           | ✗       | ✓       | `contributes.keybindings[]`           | （declarative，无 module map）   | 快捷键 → command id                         |
| `exportEnhancers`       | ✗       | ✓       | `contributes.exportEnhancers[]`       | `module.exportEnhancers`         | 导出时 DOM 后处理                           |
| `markdownCodeRenderers` | ✗       | ✓       | `contributes.markdownCodeRenderers[]` | `module.markdownCodeRenderers`   | fenced code block → React renderer          |
| `editorLanguages`       | ✗       | ✓       | `contributes.editorLanguages[]`       | `module.editorLanguages`         | fenced source 用的 CodeMirror language 扩展 |

## 4. 各贡献点字段表 + 片段

### commands

| 字段       | 类型       | 必填 | 说明                                           |
| ---------- | ---------- | ---- | ---------------------------------------------- |
| `id`       | `string`   | 是   | 本地 id；palette id = `plugin.<pluginId>.<id>` |
| `title`    | `string`   | 是   | palette 标签                                   |
| `icon`     | `string`   | 否   | emoji/icon                                     |
| `keywords` | `string[]` | 否   | 搜索关键词                                     |
| `run`      | `string`   | 是   | entry-ref，索引 `module.commands`              |

```jsonc
"commands": [{ "id": "greet", "title": "Greet", "icon": "👋", "keywords": ["hi"], "run": "greet" }]
```

### fileTypes

| 字段                 | 类型       | 必填 | 说明                                              |
| -------------------- | ---------- | ---- | ------------------------------------------------- |
| `id`                 | `string`   | 是   | 文件类型 id                                       |
| `extensions`         | `string[]` | 是   | 扩展名（含 `.`）                                  |
| `handler`            | `string`   | 是   | entry-ref，索引 `module.handlers`，或 `'default'` |
| `defaultViewMode`    | `string`   | 否   | 默认 view mode                                    |
| `supportedViewModes` | `string[]` | 否   | 内置 split/edit/preview/visual/source + 自定义 id |

```jsonc
"fileTypes": [{ "id": "json", "extensions": [".json"], "handler": "default", "defaultViewMode": "edit" }]
```

### containers

| 字段          | 类型     | 必填 | 说明                                  |
| ------------- | -------- | ---- | ------------------------------------- |
| `name`        | `string` | 是   | 指令名（`:::` 后）                    |
| `icon`        | `string` | 是   | 内联 `<svg>` 字符串 / `.svg` 文件路径（宿主 activate 时读取）/ emoji |
| `label`       | `string` | 是   | 显示标签                              |
| `category`    | `string` | 否   | `layout`/`media`/`ai`/`data`/`custom` |
| `component`   | `string` | 是   | entry-ref，索引 `module.containers`   |
| `template`    | `string` | 是   | slash 菜单插入模板                    |
| `description` | `string` | 否   | 描述                                  |

```jsonc
"containers": [{ "name": "callout", "icon": "💡", "label": "提示", "category": "layout", "component": "callout", "template": ":::callout{type=\"info\"}\n:::" }]
```

### features

| 字段        | 类型                            | 必填 | 说明                                                                         |
| ----------- | ------------------------------- | ---- | ---------------------------------------------------------------------------- |
| `id`        | `string`                        | 是   | panel 本地 id（不可与内置 `files`/`wiki`/`clips`/`analyze`/`calendar` 冲突） |
| `panel`     | `'left' \| 'right' \| 'bottom'` | 是   | MVP 仅 `left`；`right`/`bottom` 跳过                                         |
| `component` | `string`                        | 是   | entry-ref，索引 `module.features`                                            |
| `icon`      | `string`                        | 是   | 内联 SVG 字符串或 ThemeIcon 名                                               |
| `title`     | `string`                        | 否   | tooltip；缺省 `pluginId/id`                                                  |
| `order`     | `number`                        | 否   | 内置 files=0,wiki=10,clips=20,analyze=30,calendar=40；省略 ≥100              |
| `badge`     | `string \| number`              | 否   | 角标                                                                         |

```jsonc
"features": [{ "id": "my-panel", "panel": "left", "component": "my-panel", "icon": "<svg/>", "title": "My Panel", "order": 50, "badge": "NEW" }]
```

### tools

| 字段     | 类型      | 必填 | 说明                         |
| -------- | --------- | ---- | ---------------------------- |
| `id`     | `string`  | 是   | 工具 id                      |
| `title`  | `string`  | 是   | 窗口标题                     |
| `icon`   | `string`  | 否   | emoji                        |
| `window` | `boolean` | 是   | `true` → Tauri WebviewWindow |
| `entry`  | `string`  | 是   | sandbox：HTML 入口           |

```jsonc
"tools": [{ "id": "hello", "title": "Hello Tool", "icon": "🛠", "window": true, "entry": "index.html" }]
```

### exporters

| 字段            | 类型     | 必填 | 说明                                                                                                        |
| --------------- | -------- | ---- | ----------------------------------------------------------------------------------------------------------- |
| `id`            | `string` | 是   | 导出器 id                                                                                                   |
| `format`        | `string` | 是   | 输出格式 id（插件内唯一）；palette id = `plugin.<pluginId>.export.<format>`                                 |
| `label`         | `string` | 是   | 菜单标签；命令标题 `Export as <label>`                                                                      |
| `fileExtension` | `string` | 是   | 输出扩展名（不含 `.`）                                                                                      |
| `run`           | `string` | 是   | entry-ref，索引 `module.exporters`；签名 `(content, ctx: {filePath, vaultRoot}) => Promise<Blob \| string>` |

```jsonc
"exporters": [{ "id": "txt-with-header", "format": "txt-header", "label": "Text with header", "fileExtension": "txt", "run": "txt-with-header" }]
```

### fileTemplates（declarative，无 module map）

| 字段       | 类型     | 必填 | 说明                                                       |
| ---------- | -------- | ---- | ---------------------------------------------------------- |
| `id`       | `string` | 是   | 模板 id；palette id = `plugin.<pluginId>.new.<templateId>` |
| `label`    | `string` | 是   | 子菜单标签                                                 |
| `fileName` | `string` | 是   | 默认文件名                                                 |
| `template` | `string` | 是   | 初始文件内容                                               |
| `icon`     | `string` | 否   | emoji/ThemeIcon                                            |

```jsonc
"fileTemplates": [{ "id": "meeting-notes", "label": "Meeting Notes", "fileName": "meeting-notes.md", "template": "# Meeting Notes\n", "icon": "📝" }]
```

### keybindings（declarative，无 module map）

| 字段      | 类型     | 必填 | 说明                               |
| --------- | -------- | ---- | ---------------------------------- |
| `command` | `string` | 是   | command id（插件贡献或内置）       |
| `key`     | `string` | 是   | Tauri accelerator                  |
| `mac`     | `string` | 否   | macOS 覆盖                         |
| `when`    | `string` | 否   | 激活条件（保留字段，MVP 全局注册） |

> app-scope keydown 监听；非 OS 全局快捷键（仅 app 窗口获焦时触发）。

```jsonc
"keybindings": [{ "command": "plugin.my-plugin.greet", "key": "Control+Alt+Shift+T", "mac": "Cmd+Alt+Shift+T" }]
```

### exportEnhancers

| 字段   | 类型     | 必填 | 说明                                                                                                                                                    |
| ------ | -------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `name` | `string` | 是   | 容器指令 `name` 或文件扩展名（不含 `.`）；host 两种查找都试                                                                                             |
| `run`  | `string` | 是   | entry-ref，索引 `module.exportEnhancers`；签名 `(body: HTMLElement, ctx: ExporterContext) => Promise<void>`；host-realm 在渲染稳定后对真实 DOM 原地修改 |

```jsonc
"exportEnhancers": [{ "name": "quote", "run": "enhance-quote" }]
```

### markdownCodeRenderers（仅 trusted）

| 字段        | 类型       | 必填 | 说明                                                                             |
| ----------- | ---------- | ---- | -------------------------------------------------------------------------------- |
| `language`  | `string`   | 是   | fenced code block 的语言标签（` ```lang `）                                      |
| `aliases`   | `string[]` | 否   | 备选语言标签，解析到同一 renderer                                                |
| `component` | `string`   | 是   | entry-ref，索引 `module.markdownCodeRenderers`；接收 `MarkdownCodeRendererProps` |

```jsonc
"markdownCodeRenderers": [{ "language": "plantuml", "aliases": ["puml", "pu"], "component": "PlantUmlMarkdownBlock" }]
```

> host-realm React（用 `window.React` + `resolveReact()`）。未命中回退到 `CodeBlockWrapper`。规范形态见 `plugins/quill-plugin-plantuml/src/index.ts`。

### editorLanguages（仅 trusted）

| 字段      | 类型       | 必填 | 说明                                                                                                                          |
| --------- | ---------- | ---- | ----------------------------------------------------------------------------------------------------------------------------- |
| `id`      | `string`   | 是   | markdown 编辑器喂给 CodeMirror `codeLanguages` 的语言 id                                                                      |
| `aliases` | `string[]` | 否   | 备选 id，解析到同一 `LanguageSupport` factory                                                                                 |
| `entry`   | `string`   | 是   | entry-ref，索引 `module.editorLanguages`；factory 类型 `EditorLanguageFactory = () => unknown`，host 窄化为 `LanguageSupport` |

```jsonc
"editorLanguages": [{ "id": "plantuml", "aliases": ["puml", "pu"], "entry": "plantumlLanguage" }]
```

> trusted 插件经 blob URL 加载，需通过 `window.codemirrorLanguage`（host 在 `main.tsx` 中赋值）+ `resolveCodemirror()` helper 拿 `@codemirror/language`，避免 module-instance mismatch。规范形态见 `plugins/quill-plugin-plantuml/src/codemirror.ts`。

## 5. PluginModule 导出契约（trusted）

```ts
export interface PluginModule {
  handlers?: Record<string, FileTypeHandler>;
  containers?: Record<string, ComponentType<ContainerProps>>;
  features?: Record<string, ComponentType>;
  commands?: Record<string, () => void | Promise<void>>;
  exporters?: Record<string, ExporterHandler>;
  exportEnhancers?: Record<string, ExportEnhancerHandler>;
  markdownCodeRenderers?: Record<
    string,
    ComponentType<MarkdownCodeRendererProps>
  >;
  editorLanguages?: Record<string, EditorLanguageFactory>;
  activate?: (ctx: PluginContext) => void | Promise<void>;
  deactivate?: (ctx: PluginContext) => void | Promise<void>;
}
```

entry-ref key 与 manifest 中 `run`/`handler`/`component`/`entry` 字符串对应。缺失 key 跳过并告警（其它贡献仍加载）。`fileTemplates` + `keybindings` 无 module map（declarative）。默认导出工厂 `(ctx) => PluginModule` 也被接受。

### trusted 导出骨架（无 JSX，用 `window.React` + `createElement`）

```ts
// index.ts — self-contained ESM bundle
import type { PluginModule, ExporterHandler } from "quill-plugin-sdk";

function loadReact() {
  if (typeof window !== "undefined" && window.React) return window.React;
  throw new Error("[my-plugin] window.React not available");
}

export const containers = {
  quote: function QuoteContainer(props) {
    const R = loadReact();
    return R.createElement("div", null, props.children);
  },
};
export const exporters: Record<string, ExporterHandler> = {
  "txt-with-header": async (content, ctx) => `# ${ctx.filePath}\n\n${content}`,
};
export const exportEnhancers = {
  "enhance-quote": async (body) => {
    body.classList.add("exported");
  },
};
export const commands = { ping: () => console.info("pong") };
export function activate() {}
export function deactivate() {}
```

## 6. 契约类型速查

```ts
export type ViewMode =
  "split" | "edit" | "preview" | "visual" | "source" | (string & {});

export interface EditorProps {
  content: string;
  tabId: string;
  filePath: string;
  onChange: (content: string) => void;
  onSave: () => void;
}

export interface PreviewProps {
  content: string;
  filePath: string;
  vaultRoot: string;
  onChange?: (content: string) => void;
}

export interface FileTypeHandler {
  id: string;
  extensions: string[];
  icon?: ReactNode;
  supportedViewModes: ViewMode[];
  defaultViewMode?: ViewMode;
  needsFileContent: boolean;
  useCodeMirror?: boolean;
  Editor?: ComponentType<EditorProps>;
  Preview?: ComponentType<PreviewProps>;
  serialize?: (content: string) => string;
  deserialize?: (raw: string) => string;
}

export interface ContainerProps {
  children?: ReactNode;
  attributes?: Record<string, string>;
  name?: string;
}

export type ContainerCategory = "layout" | "media" | "ai" | "data" | "custom";

export interface ExporterContext {
  filePath: string;
  vaultRoot: string;
}

export type ExporterHandler = (
  content: string,
  ctx: ExporterContext,
) => Promise<Blob | string>;

export type ExportEnhancerHandler = (
  body: HTMLElement,
  ctx: ExporterContext,
) => Promise<void>;

export interface MarkdownCodeRendererProps {
  source: string;
  language: string;
  resolvedLanguage: string;
  filePath: string;
}

export type EditorLanguageFactory = () => unknown;

export interface PluginContext {
  readonly pluginId: string;
  readonly manifest: PluginManifest;
  addDisposable(d: Disposable): void;
  readonly ai?: PluginAiCapability;
  readonly env?: PluginEnv;
}

export interface PluginEnv {
  readonly theme: "light" | "dark";
  readonly locale: string;
  onThemeChange(cb: (t: "light" | "dark") => void): Disposable;
  onLocaleChange(cb: (l: string) => void): Disposable;
}
```

## 7. AI 能力

provider/model/apiKey 由 host 持有，绝不暴露给插件。

| 方法         | 参数                                                | 所需 permission          | tier              |
| ------------ | --------------------------------------------------- | ------------------------ | ----------------- |
| `chat`       | `{ sessionId, prompt, onEvent, useSharedSession? }` | `ai.chat: true`          | sandbox + trusted |
| `agent`      | `{ feature, instruction, onEvent }`                 | `ai.agents` 含 `feature` | trusted           |
| `editFile`   | `{ path, instruction, onEvent }`                    | `ai.edit: true`          | trusted           |
| `createFile` | `{ path, instruction, onEvent }`                    | `ai.edit: true`          | trusted           |

`onEvent` 收到 `{ type: 'text' \| 'thinking' \| 'error' \| 'done', content? }`（host 过滤掉 tool/file_change 事件）。

```ts
// trusted tier — ctx.ai 在 activate 时由 host 注入
await ctx.ai.chat({
  sessionId: "my-plugin",
  prompt: "Summarize",
  onEvent: (e) => {},
});
await ctx.ai.agent({
  feature: "study",
  instruction: "Review",
  onEvent: (e) => {},
});
await ctx.ai.editFile({
  path: "notes/summary.md",
  instruction: "Summarize as 3 bullets",
  onEvent: (e) => {},
});
await ctx.ai.createFile({
  path: "notes/new.md",
  instruction: "Draft skeleton",
  onEvent: (e) => {},
});
```

## 8. dev helpers

```ts
import { definePlugin, validateManifest } from "quill-plugin-sdk";

export const manifest = definePlugin({
  id: "my-plugin",
  version: "1.0.0",
  tier: "trusted",
  main: "index.js",
});
// validateManifest(manifest) — 非法时 throw，可在 test 步骤调用
```

`definePlugin` 类型守卫 + 运行时校验；`validateManifest` 校验 id 格式、`version`、`tier`、`main`、sandbox 的 `html`、`permissions.ai` 形状。host 的 `PluginHost.validateManifest` 复用同一实现。

## 9. trusted 打包约束

trusted 加载器把 `main` 包成 blob URL 后 `import()`，blob URL 无路径：

| 约束                               | 后果                                                                          |
| ---------------------------------- | ----------------------------------------------------------------------------- |
| 相对 import（`./utils.js`）        | 解析失败，加载失败                                                            |
| 远程 import                        | 被 `quill-plugin://` CSP 阻断                                                 |
| bare specifier（`react`、`@/...`） | 仅当 Vite 留作运行时 `import()` 且 host realm 已加载时解析；否则失败          |
| bundle 自带 React                  | hooks 抛 `Invalid hook call`（两份 React 实例）                               |
| JSX（自动 runtime）                | 构建产物 `import { jsx } from 'react/jsx-runtime'` → blob import 失败，不可用 |

**正确做法**：用 Vite/Rollup/esbuild bundle 真实运行时依赖；React 通过 `window.React`（host 暴露）+ `createElement`（无 JSX）；bare specifier 放进函数体内懒加载（demo 用法，见 `markdown-todo`）。

参考：`../examples/plugins/plugin-export-demo`（纯 ESM 无 JSX，window.React）、`../examples/plugins/markdown-todo`（懒加载 bare specifier）、`../plugins/plugin-graphviz`（Vite bundle + window.React）。

## 10. 示例插件索引

- `../examples/plugins/plugin-export-demo` — trusted；演示 `exporters` + `fileTemplates` + `keybindings` + `containers` + `exportEnhancers` 五项。
- `../examples/plugins/markdown-todo` — trusted；`containers`（`:::todo`）+ `commands`。
- `../examples/plugins/feature-panel-sample` — trusted；`features` 侧栏 panel。
- `../examples/plugins/hello-tool` — sandbox；`tools` + 剪贴板 RPC。
- `../examples/plugins/markdown-table` — sandbox；`tools` + `vault:insert-content` RPC。
- `../plugins/plugin-graphviz` — trusted；`fileTypes` + `containers`，Vite 打包。
