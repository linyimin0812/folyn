# Folyn Extension System 重构技术方案

> 状态：Draft / Implementation Ready  
> 目标仓库：`https://github.com/linyimin0812/folyn`  
> 目标：将现有 Plugin Host / SDK 演进为以 Extension Runtime 为核心的稳定插件系统，并完整支持 Tool Extension、File Type Extension、Service Extension、共享 Toolbar、可插拔 Editor/Preview、Export Service 与 Generic File Viewer。

---

## 1. 背景与当前现状

Folyn 当前已经具备一套插件基础设施，包括：

- `packages/plugin-sdk`
- `packages/plugin-host`
- Manifest / Permission / Plugin Tier
- Contribution Points
- Trusted / Sandbox 两种运行层级
- Disposable 生命周期清理
- AI / HTTP 等能力
- FileType / Container / Exporter / Feature / Tool 等贡献点

当前 SDK 已经定义了 `PluginManifest`、`PluginPermissions`、`PluginTier`、`PluginModule`、`PluginContext`，并且已有 `FileTypeContribution`、`ExporterContribution`、`FileTemplateContribution`、`ExportEnhancerContribution` 等贡献点。Trusted 插件使用 `import()` 进入宿主 Realm，Sandbox 插件则通过 iframe + RPC 运行。citehttps://github.com/linyimin0812/folyn/tree/master/packages/plugin-sdk

Folyn 产品本身已经将 Markdown、SVG、Drawio、Excalidraw、DBML、Mermaid、PlantUML、CSV、JSON 等作为多格式工作流，同时将 Office、音视频、归档等通用文件查看归入 Universal Preview；应用也有 In-app Terminal、AI 和 Plugin System。citehttps://github.com/linyimin0812/folyn

本次重构不应推倒现有实现，而应进行**概念重排与运行时重构**：

```text
Plugin Host / Plugin Context / Plugin Module
                 ↓
        Extension Host / Runtime
                 ↓
 ExtensionApi + ExtensionContext + ExtensionUIContext
                 ↓
 FileType / Workspace / Command / Exporter / Service
```

---

# 2. 设计目标

## 2.1 核心目标

1. 插件不得依赖 Folyn 内部 React、Zustand、CodeMirror、AppShell 实现。
2. `ExtensionApi` 是能力边界（Capability Boundary）。
3. `ExtensionContext` 是当前运行环境边界（Runtime Context）。
4. `ExtensionUIContext` 只暴露插件真正需要的 UI 能力。
5. ActivityBar 只服务于 Tool Extension，不为 FileType Extension 创建入口。
6. File Explorer 是统一文件生命周期入口：新建、打开、重命名、移动、复制、删除。
7. FileType Extension 可以提供完全自定义的 Editor / Preview / Split 实现。
8. Edit / Split / Preview 是统一 Presentation Mode 模型。
9. Terminal / AI / Export / Language / Mode 使用共享 Toolbar，由 Folyn Shell 统一呈现。
10. ExportService 由 Core 提供，具体 Exporter 由 Extension 提供。
11. Generic File Viewer 作为低优先级 fallback FileType Extension，负责 Office / PDF / Media / Archive 等通用格式。
12. Trusted 与 Sandbox 使用同一套 Extension API 合约。
13. Extension 生命周期、Disposable、AbortSignal、Registry Ownership 必须统一。
14. 单个插件失败不得影响整个应用或其他插件。

## 2.2 非目标

本阶段不做：

- 任意 DOM 注入。
- 任意修改 React Tree。
- 任意访问 Folyn 内部 Store。
- Plugin 自由重构 AppShell 布局。
- 强制所有 Extension 都拥有 ActivityBar。
- 把所有 UI 都 generic 化成字符串 Slot。
- 在生产 Tauri WebView 内强制使用 jiti。

---

# 3. 总体架构

```text
                           ┌────────────────────┐
                           │     Folyn App      │
                           │                    │
                           │  App Shell / Core  │
                           └─────────┬──────────┘
                                     │
                              Extension Host
                                     │
          ┌──────────────────────────┼──────────────────────────┐
          │                          │                          │
     ExtensionLoader          ExtensionRuntime           Registries
          │                          │                          │
    ┌─────┴─────┐          ┌─────────┴─────────┐      ┌─────────┴─────────┐
    │            │          │                   │      │                   │
 Trusted      Sandbox   ExtensionApi     ExtensionContext  Contribution Registries
 Loader        Loader        │                   │
    │            │           │                   │
    │            │      Capabilities             UI Context
    │            │           │                   │
    │            │      ┌────┼────┐              │
    │            │      │    │    │              │
    │            │    Vault Editor AI        Workspace / Views
    │            │                                      │
    └────────────┴──────────────────────────────────────┘
```

核心对象：

```text
ExtensionManifest
ExtensionDefinition
ExtensionHost
ExtensionRuntime
ExtensionLoader
ExtensionContext
ExtensionApi
ExtensionUIContext
ExtensionRegistry
UIContributionRegistry
FileTypeRegistry
ExporterRegistry
CommandRegistry
```

---

# 4. Extension 模型

## 4.1 Extension

Plugin 的运行时入口统一为 Extension：

```ts
export interface Extension {
  activate(
    api: ExtensionApi,
    ctx: ExtensionContext,
  ): Promise<void> | void;

  deactivate?(
    ctx: ExtensionContext,
  ): Promise<void> | void;
}
```

第一阶段可以兼容现有 `PluginModule`，通过 `LegacyPluginAdapter` 适配到该接口。

## 4.2 ExtensionManifest

建议保持现有 Manifest 思路，但减少运行时行为定义：

```ts
export interface ExtensionManifest {
  id: string;
  name: string;
  version: string;
  main: string;

  engines?: {
    folyn: string;
  };

  tier: "trusted" | "sandbox";

  activationEvents?: ActivationEvent[];

  permissions?: PermissionManifest;

  contributes?: DeclarativeContributions;
}
```

Manifest 只描述：

- 元数据
- 兼容版本
- Trusted / Sandbox
- Activation Events
- Permission
- 少量静态 Contribution Metadata

运行时行为由 `activate(api, ctx)` 注册。

---

# 5. ExtensionApi

`ExtensionApi` 是插件与 Folyn Core 唯一支持的能力接口。

```ts
export interface ExtensionApi {
  readonly vault: VaultApi;
  readonly files: FileApi;
  readonly editor: EditorApi;
  readonly workspace: WorkspaceContextApi;

  readonly commands: CommandRegistryApi;
  readonly events: EventApi;
  readonly storage: ExtensionStorageApi;

  readonly ai: AiApi;
  readonly terminal: TerminalApi;
  readonly export: ExportService;

  readonly fileTypes: FileTypeRegistryApi;
  readonly exporters: ExporterRegistryApi;
}
```

## 5.1 原则

禁止 Extension：

```ts
import { internalStore } from "@/stores/...";
import { appShell } from "@/ui/...";
import { codeMirrorView } from "@/editor/...";
```

禁止暴露：

```ts
api.react
api.zustand
api.dom
api.appShell
api.tauriInternals
```

## 5.2 VaultApi

所有路径都必须为 Vault-relative path：

```ts
interface VaultApi {
  readText(path: string): Promise<string>;
  readBinary(path: string): Promise<Uint8Array>;
  writeText(path: string, content: string): Promise<void>;
  writeBinary(path: string, data: Uint8Array): Promise<void>;
}
```

插件永远不能通过公开 SDK 获取其他 Vault 的物理路径。

---

# 6. ExtensionContext

`ExtensionContext` 描述“插件当前处于什么环境”。

```ts
export interface ExtensionContext {
  readonly extensionId: string;
  readonly extensionPath: string;
  readonly manifest: ExtensionManifest;

  readonly vault: VaultContext;
  readonly ui: ExtensionUIContext;

  readonly signal: AbortSignal;
  readonly logger: ExtensionLogger;

  addDisposable(disposable: Disposable): void;
}

export interface ExtensionLogger {
  debug(message: string, ...args: unknown[]): void;
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, error?: Error): void;
}

export interface VaultContext {
  readonly name: string;
  readonly path: string;  // 逻辑标识，不暴露物理路径
}
```

## 6.1 AbortSignal

所有长任务都必须可取消：

```ts
await expensiveOperation({
  signal: ctx.signal,
});
```

### AbortSignal 传播机制

```ts
class ExtensionRuntime {
  private abortController = new AbortController();
  
  async activate(api: ExtensionApi, baseCtx: ExtensionContext) {
    const ctx: ExtensionContext = {
      ...baseCtx,
      signal: this.abortController.signal,
    };
    
    await this.extension.activate(api, ctx);
  }
  
  async deactivate() {
    // 1. abort 所有进行中的操作
    this.abortController.abort();
    
    // 2. 调用 extension.deactivate
    await this.extension.deactivate?.(ctx);
    
    // 3. dispose 所有 disposables
    await this.reapDisposables();
  }
}

// VaultApi 自动传播 signal
class VaultApiImpl implements VaultApi {
  constructor(private signal: AbortSignal) {}
  
  async readText(path: string, userSignal?: AbortSignal): Promise<string> {
    const combined = this.combineSignals(this.signal, userSignal);
    if (combined.aborted) throw new Error('Operation aborted');
    return await readFile(path, { signal: combined });
  }
  
  private combineSignals(...signals: (AbortSignal | undefined)[]): AbortSignal {
    const controller = new AbortController();
    for (const signal of signals) {
      if (!signal) continue;
      if (signal.aborted) {
        controller.abort();
        break;
      }
      signal.addEventListener('abort', () => controller.abort(), { once: true });
    }
    return controller.signal;
  }
}
```

Vault 切换 / Extension unload / reload 时：

```text
abort (取消所有进行中操作)
  ↓
deactivate (调用插件清理钩子)
  ↓
dispose (清理 disposables)
  ↓
remove contributions (清理 Registry)
```

---

# 7. ExtensionUIContext

UI Context 不应该暴露整个 Folyn UI，而只暴露插件真正拥有的 UI 表面。

按 Extension 类型分层：

```ts
// 基础 UI Context，所有 Extension 可用
export interface ExtensionUIContext {
  readonly dialogs: DialogApi;
  readonly notifications: NotificationApi;
}

// Tool Extension 专用
export interface ToolExtensionUIContext extends ExtensionUIContext {
  readonly workspace: WorkspaceApi;
}

// FileType Extension 专用
export interface FileTypeExtensionUIContext extends ExtensionUIContext {
  readonly presentation: PresentationApi;
}

// Service Extension 只使用基础 ExtensionUIContext
```

这样可以在类型层面防止 FileType Extension 注册 Workspace，Tool Extension 访问 Presentation API。

## 7.1 Workspace

Workspace 只面向 Tool Extension。

```ts
interface WorkspaceApi {
  register(
    contribution: WorkspaceContribution,
  ): WorkspaceHandle;

  open(id: string): void;
  close(id: string): void;
  toggle(id: string): void;
}
```

Workspace 自动关联：

```text
Workspace
  ├── ActivityBar Item
  ├── Main View
  └── Workspace Commands
```

这样 Tool Extension 不需要分别操作 ActivityBar 和 Main View。

## 7.2 View

```ts
interface ViewContribution {
  id: string;
  title: string;
  icon?: IconRef;

  render: ViewRenderer;
}
```

基础 SDK 不强制 React。

React 实现放在可选的：

```text
@folyn/extension-ui-react
```

---

# 8. UI Shell 与插件的边界

Folyn Core 拥有：

```text
ActivityBar
FileExplorer
Main Workspace Shell
Global Toolbar
StatusBar
Window/Layout
```

Extension 拥有：

```text
Workspace
View
Command
FileType
Exporter
Service
```

不允许：

```text
Extension → replace AppShell
Extension → get DOM node
Extension → get ReactRoot
Extension → modify Zustand
Extension → arbitrary CSS injection
```

允许：

```text
Extension → register Workspace
Extension → register View
Extension → register Command
Extension → register FileType
Extension → register Exporter
```

核心原则：

> Core controls the Shell; Extension controls its contribution.

---

# 9. Extension 类型

逻辑上分为三类，不一定需要在 Manifest 中硬编码 `type`：

## 9.1 Tool Extension

例如：

- AI
- Git
- Calendar
- Wiki
- Project Analysis

能力：

```text
ActivityBar
Workspace
Main View
Commands
Shared Toolbar Actions
```

## 9.2 File Type Extension

例如：

- Markdown
- DBML
- Drawio
- Excalidraw
- CSV
- JSON

能力：

```text
FileType
Editor
Preview
Split
Presentation Modes
Template
Exporter
Container
File Actions
```

不得自动创建 ActivityBar。

## 9.3 Service Extension

例如：

- Formatter
- Linter
- AI Completion
- Search Indexer

能力：

```text
Commands
Events
Services
Editor hooks
```

不需要 ActivityBar。

---

# 10. File Explorer 模型

File Explorer 是 Core-owned。

它不理解具体文件类型的实现细节，只使用 Registry。

```text
                       File Explorer
                             │
          ┌──────────────────┼──────────────────┐
          │                  │                  │
     FileSystem        FileTypeRegistry   FileActionRegistry
          │                  │                  │
 create/rename/move     .md → Markdown       actions
 delete/copy/open       .dbml → DBML
                        .docx → File Viewer
```

## 10.1 Core 文件操作

这些永远由 Core 执行：

```text
create
rename
move
copy
delete
```

Extension 不能绕过 Core 文件服务。

## 10.2 FileType Extension

负责：

```text
“我是什么文件”
“怎么编辑”
“怎么预览”
“支持哪些 Mode”
“有哪些类型特有的操作”
```

不负责直接实现基础文件系统操作。

---

# 11. FileTypeProvider

推荐接口：

```ts
interface FileTypeProvider {
  id: string;

  extensions: string[];
  mimeTypes?: string[];

  icon?: IconRef;

  modes: FilePresentationModeRegistration[];

  template?: FileTemplateProvider;

  actions?: FileTypeActionProvider;
}
```

核心概念不是“Text Editor”，而是：

> File Presentation Provider

因此可以支持：

```text
Markdown → CodeMirror + HTML
DBML → Text Editor + ER Diagram
Drawio → Canvas
Excalidraw → Canvas
Image → ImageViewer
PDF → PDFViewer
DOCX → Office Renderer
Audio → Audio Player
Video → Video Player
```

---

# 12. Presentation Mode

统一定义：

```ts
type BuiltinPresentationMode =
  | "edit"
  | "split"
  | "preview";
```

未来可以加入：

```text
diagram
diff
source
readonly
outline
compare
```

更通用的模型：

```ts
interface PresentationModeRegistration {
  id: string;
  title: string;
  icon?: IconRef;
  create(context: FilePresentationContext): PresentationView;
}
```

---

# 13. Edit / Preview / Split

## 13.1 Edit

```ts
edit: {
  renderer: MarkdownEditor,
}
```

## 13.2 Preview

```ts
preview: {
  renderer: MarkdownPreview,
}
```

## 13.3 Split

Split 不建议简单理解为一个 Renderer，而应建模为多个 Presentation 的布局组合：

```ts
split: {
  orientation: "horizontal",
  left: "edit",
  right: "preview",
}
```

因此：

```text
Markdown
├── Edit
├── Preview
└── Split
    ├── Edit
    └── Preview
```

这也适合 Markdown 光标同步等 FileType-specific 行为。

---

# 14. 自定义 Editor / Preview

这是新架构的一级能力。

插件可以完全提供：

```text
Custom Editor
Custom Preview
Custom Split Layout
```

例如 DBML：

```text
DBML Editor
      +
ER Diagram Preview
```

Drawio：

```text
Drawio Canvas Editor
      +
Readonly Canvas Preview
```

插件不需要使用 Folyn 默认文本编辑器。

---

# 15. Editor API 与 Editor Renderer 的区别

必须区分：

```text
EditorApi
    = 操作当前编辑器

EditorProvider
    = 提供具体文件类型的编辑器 UI
```

例如：

```ts
api.editor.getSelection();
api.editor.replaceSelection(text);
```

而：

```ts
fileType.editor = MarkdownEditor;
```

Core 不应该暴露内部 CodeMirror 实例。

如果未来确实需要 CodeMirror 特定能力，单独提供：

```text
@folyn/extension-editor-codemirror
```

---

# 16. Shared Toolbar

Toolbar 属于 Folyn Shell，而不是 Plugin Workspace。

统一 Toolbar：

```text
Terminal | AI | Export | Language | Mode
```

这些按钮由 Core 统一渲染。

Extension 只提供它们所依赖的能力。

## 16.1 Terminal

Core Service：

```ts
api.terminal
```

## 16.2 AI

Core Service：

```ts
api.ai
```

## 16.3 Export

Core UI Entry：

```text
Export Button
```

Core Service：

```ts
api.export
```

插件提供：

```ts
api.exporters.register(...)
```

## 16.4 Language

当前 FileType / Language Provider 提供语言元数据，Toolbar 负责统一展示。

## 16.5 Mode

当前 FileType 提供可用 Presentation Modes，Toolbar 根据当前文件动态显示：

```text
Markdown → Edit | Split | Preview
DBML     → Edit | Split | Preview
Drawio   → Edit | Preview
DOCX     → Preview
PNG      → Preview
```

### Toolbar 状态缓存

```ts
class ToolbarResolver {
  private cache = new Map<string, ToolbarState>();
  
  resolve(context: ToolbarContext): ToolbarState {
    const key = context.fileType?.id ?? 'no-file';
    if (this.cache.has(key)) return this.cache.get(key)!;
    
    const state = this.computeToolbarState(context);
    this.cache.set(key, state);
    return state;
  }
  
  invalidate(fileTypeId: string) {
    this.cache.delete(fileTypeId);
  }
}
```

触发更新：文件切换、Extension reload、Mode 切换。**不触发**：光标移动、文本编辑、滚动。

---

# 17. Context-driven Toolbar

Toolbar 根据当前上下文计算。

```ts
interface ToolbarContext {
  activeFile: FileRef | null;
  fileType: ResolvedFileType | null;
  activeMode: string | null;
  activeWorkspace: string | null;
  selection: EditorSelection | null;
}
```

计算过程：

```text
Current File
     ↓
Resolve FileType
     ↓
Capabilities
     ↓
ToolbarResolver
     ↓
Terminal / AI / Export / Language / Mode
```

Toolbar 不应包含：

```ts
if (file.extension === ".md")
```

---

# 18. Command 模型

Command 是 UI 操作的统一动作模型。

```ts
interface CommandContribution {
  id: string;
  title: string;
  icon?: IconRef;
  execute(context: CommandContext): Promise<void> | void;

  availability?: AvailabilityRule;
}
```

同一个 Command 可以拥有多个入口：

```text
Command
├── Toolbar
├── Command Palette
├── Context Menu
├── Shortcut
└── ActivityBar / Workspace
```

不要让 Toolbar / Context Menu / Shortcut 分别绑定插件 callback。

---

# 19. Context Keys / When Clause

为 Toolbar、Context Menu、Command Palette 提供统一 Context Evaluation。

例如：

```text
editor.hasSelection
editor.language == "markdown"
file.type == "markdown"
file.readonly == false
workspace.id == "git"
```

建议：

```ts
interface WhenContext {
  get(key: string): unknown;
}
```

第一阶段可以先使用类型化谓词对象：

```ts
{
  fileType: "markdown",
  hasSelection: true,
}
```

避免过早实现字符串表达式语言。

---

# 20. Export Service

Export 必须是一等服务。

```ts
interface ExportService {
  getAvailableExporters(
    context: ExportContext,
  ): ExporterDescriptor[];

  export(
    request: ExportRequest,
  ): Promise<ExportResult>;
}
```

而插件提供：

```ts
api.exporters.register(...)
```

---

# 21. Exporter

```ts
interface ExporterRegistration {
  id: string;
  title: string;
  fileTypes: string[];
  formats: ExportFormat[];
  priority?: number;

  supports?(context: ExportContext): boolean;
  export(context: ExportContext, options?: ExportOptions): Promise<ExportResult>;
  
  // 可选：导出前配置（PDF页面大小、图片质量等）
  configure?(context: ExportContext): Promise<ExportOptions | null>;
  
  // 可选：导出预览（如PDF第一页缩略图）
  preview?(context: ExportContext, options?: ExportOptions): Promise<PreviewResult>;
  
  capabilities?: {
    streaming?: boolean;  // 支持流式导出（大文件）
    preview?: boolean;    // 支持预览
    configure?: boolean;  // 需要配置
  };
}

interface ExportOptions { [key: string]: unknown; }
interface PreviewResult { type: 'image' | 'html'; data: string; }
```

例如：

```ts
api.exporters.register({
  id: "markdown.pdf",
  title: "PDF",
  fileTypes: ["markdown"],
  formats: [
    {
      id: "pdf",
      title: "PDF",
      extension: ".pdf",
      mimeType: "application/pdf",
    },
  ],
  export: async (context) => {
    // Markdown -> PDF
  },
});
```

---

# 22. ExportService 与 Exporter 的职责

```text
ExportService
├── 查询可用 Exporter
├── 选择 Exporter
├── 执行
├── 进度
├── 取消
├── 错误规范化
└── 保存输出文件

Exporter
└── source / model / rendered representation → output
```

Exporter 不直接：

```ts
fs.writeFile(...)
```

Exporter 返回：

```ts
interface ExportResult {
  data: Uint8Array | string;
  mimeType: string;
  suggestedName: string;
}
```

然后由 Core File Service / Save Dialog 保存。

---

# 23. Preview 与 Export 共享 Document Model

强烈推荐 FileType 内部采用：

```text
Source
  ↓
Parser
  ↓
Document Model
  ├── Editor
  ├── Preview
  └── Exporter
```

例如 Markdown：

```text
Markdown
  ↓
AST / Document Model
  ├── Editor
  ├── Preview
  ├── HTML Export
  └── PDF Export
```

DBML：

```text
DBML
  ↓
Schema Model
  ├── Editor
  ├── ER Diagram
  ├── SVG Export
  └── PNG Export
```

这样不同 Exporter 不需要重复解析源文件。

---

# 24. Generic File Viewer Extension

## 24.1 定位

`File Viewer` 是：

> Fallback FileType Extension / Generic File Presentation Extension

不是 Folyn Core 的巨型模块。

它负责 Folyn 没有专门实现的文件格式。

例如：

```text
DOCX
PPTX
XLSX
PDF
Image
Audio
Video
Archive
Ebook
```

具体支持范围以 File Viewer 自身版本为准。

Office Viewer 类产品已经验证将 Word / PowerPoint / Excel / PDF 等统一成一个 Viewer Extension 是可行的；现有开源实现也采用了 Office 多格式统一预览方式。citeturn942185search2

## 24.2 不重复接管 First-class FileTypes

Core / 专用 Extension 已经拥有的类型：

```text
Markdown
SVG
Drawio
Excalidraw
DBML
Mermaid
PlantUML
CSV
JSON
...
```

File Viewer 不应覆盖这些类型。

---

# 25. FileType Resolution

解决文件打开时使用哪个 Provider：

```text
Open File
   ↓
FileTypeResolver
   ↓
collect matching providers
   ↓
priority / specificity / user preference
   ↓
select default provider
```

建议：

```ts
interface FileTypeMatch {
  providerId: string;
  priority: number;
  specificity: number;
}
```

例如：

```text
Markdown Provider      priority 1000
Generic Viewer         priority -1000
```

因此：

```text
README.md
→ Markdown

README.unknown
→ File Viewer
```

---

# 26. Open With

Registry 必须支持：

```ts
resolveDefault(file)
listProviders(file)
```

用户右键：

```text
Open With
├── Markdown Editor
├── File Viewer
└── External Application
```

未来可以支持用户保存默认 Provider：

```text
.docx → Office Advanced Viewer
```

---

# 27. File Viewer 的内部设计

不要让 File Viewer 自身变成 God Object。

推荐：

```text
file-viewer extension
├── RendererRegistry
│   ├── docx
│   ├── pptx
│   ├── xlsx
│   ├── pdf
│   ├── image
│   ├── audio
│   ├── video
│   └── archive
│
├── Presentation Providers
├── Binary File Readers
└── Renderer Error Boundaries
```

Office 等复杂 renderer 应按需加载，以减少启动开销和内存占用。现有独立 file-viewer 项目也采用“renderer plugin + on-demand loading”的拆分方式，Word/Presentation 等 renderer 与底层解析引擎解耦。citeturn942185search0

---

# 28. File Viewer 的运行方式

推荐第一阶段：

```text
File Viewer
  ↓
Sandbox Extension（优先）
```

如果现有 Sandbox UI / binary capability 尚不足，则允许：

```text
Trusted Extension
```

后续逐步迁移到 Sandbox。

原因：DOCX / PPTX / XLSX 的复杂解析器攻击面大于普通 Markdown Preview，应尽量避免不必要的宿主权限。

---

# 29. Generic Viewer 的权限

推荐最小权限：

```text
vault.read
ui
```

如果不需要网络：

```text
network = false
```

如果需要 WASM / Worker，提供明确的 Runtime Capability，而不是 raw Tauri API。

---

# 30. File Actions

File Explorer Core 提供：

```text
New
Open
Rename
Move
Duplicate
Delete
```

FileType Extension 可以提供额外动作：

```text
Export
Open With
Convert
Format
Generate Preview
```

建议：

```ts
interface FileActionContribution {
  id: string;
  title: string;
  command: string;

  when?: FileWhenContext;
}
```

这样 FileType Extension 不直接修改 FileExplorer，而是贡献 File Actions。

---

# 31. New File / File Template

```ts
interface FileTemplateContribution {
  id: string;
  title: string;
  extension: string;

  create(context: CreateFileContext): Promise<CreateFileResult>;
}
```

例如 Markdown：

```text
File Explorer
  ↓
New
  ├── Markdown
  ├── DBML
  ├── Drawio
  └── ...
```

创建后由 FileTypeResolver 打开。

---

# 32. ActivityBar / Workspace

只有 Tool Extension 默认进入 ActivityBar：

```ts
ctx.ui.workspace.register({
  id: "git",
  title: "Git",
  icon: "git-branch",
  view: GitView,
});
```

UI 自动形成：

```text
ActivityBar
    🌿 Git
        ↓
Main Workspace
        ↓
Git View
```

FileType Extension 不注册 Workspace：

```text
Markdown ❌ ActivityBar
DBML     ❌ ActivityBar
Drawio   ❌ ActivityBar
CSV      ❌ ActivityBar
```

---

# 33. Workspace 与 Main View

Workspace 是 Tool Extension 的一个“应用内小应用”，但只控制自己的区域：

```text
Workspace
├── title
├── icon
├── main view
├── optional subviews
└── optional local state
```

它不能控制整个 Folyn Shell。

---

# 34. UI Registry

所有 UI 注册都必须记录 ownership：

```ts
interface Registration {
  id: string;
  ownerExtensionId: string;
  dispose(): void;
}
```

支持：

```ts
registry.removeByExtension(extensionId);
```

这样 Reload / Deactivate 不需要遍历插件逻辑。

---

# 35. ExtensionRuntime

Runtime 是整个重构的核心对象：

```ts
class ExtensionRuntime {
  readonly abortController: AbortController;
  readonly disposables: DisposableStore;
  readonly api: ExtensionApi;
  readonly context: ExtensionContext;

  async activate(extension: Extension): Promise<void>;
  async dispose(): Promise<void>;
}
```

创建流程：

```text
create Runtime
   ↓
create AbortController
   ↓
create Capability APIs
   ↓
create UI Context
   ↓
create registries scoped to extension
   ↓
extension.activate(api, ctx)
```

---

# 36. Disposable

所有注册都必须归属于当前 Runtime：

```text
Runtime
├── Event subscriptions
├── Commands
├── Workspace
├── Views
├── FileTypes
├── Exporters
├── Timers
└── UI registrations
```

`Runtime.dispose()` 时全部释放。

Reload：

```text
old Runtime
   ↓
abort
   ↓
deactivate
   ↓
dispose
   ↓
new Runtime
   ↓
activate
```

Reload 的语义不是“重新 import 一次”，而是“重建 Runtime”。

---

# 37. Activation State Machine

推荐状态：

```ts
type ExtensionState =
  | "discovered"
  | "validated"
  | "disabled"
  | "waiting"
  | "loading"
  | "activating"
  | "active"
  | "deactivating"
  | "failed";
```

流程：

```text
DISCOVERED
   ↓
VALIDATED
   ↓
WAITING
   │
   │ activation event
   ↓
LOADING
   ↓
ACTIVATING
   ↓
ACTIVE
  /   \
 /     \
deactivate crash
 ↓       ↓
DEACTIVATING  FAILED
 ↓
DISABLED
```

---

# 38. Trust / Permission / Integrity

Trust 和 Runtime State 分离：

```ts
type TrustLevel =
  | "builtin"
  | "trusted"
  | "untrusted"
  | "blocked";
```

加载 pipeline：

```text
Discover
 ↓
Read Manifest
 ↓
Validate Manifest
 ↓
Engine Compatibility
 ↓
Trust Check
 ↓
Integrity Check
 ↓
Permission Resolution
 ↓
Create Runtime
 ↓
Load Module
 ↓
Activate
```

绝不能先执行代码再判断是否 trusted。

---

# 39. Trust Record

建议记录：

```ts
interface TrustRecord {
  extensionId: string;
  version: string;
  contentHash: string;
  permissions: GrantedPermissions;
  grantedAt: string;
}
```

插件代码 Hash 改变：

```text
hash changed
   ↓
trust invalidated
   ↓
user approval required
```

---

# 40. Trusted Loader 与 jiti

这是一个重要实现决策：

## 40.1 不建议

在生产 Tauri WebView 内直接依赖：

```text
jiti
Node runtime
```

## 40.2 推荐

Trusted Extension：

```text
TypeScript source
     ↓
Build / Bundle
     ↓
Self-contained ESM
     ↓
Blob URL / import()
     ↓
Trusted Realm
```

现有 Folyn SDK 已采用 Trusted 插件 `import()`、自包含 ESM bundle 的路线，这与 Tauri WebView runtime 更匹配。citeturn727804view0

## 40.3 jiti 的定位

jiti 可以用于：

```text
Node CLI
Plugin dev tool
Prototype loader
Build tooling
```

但不要让 `jiti` 成为生产 Extension ABI。

Pi 采用 jiti 的前提是其 Extension Runtime 运行于 Node 环境；Folyn 应复制其 Extension 模型，而不必复制 Loader 实现。

---

# 41. Sandbox / Trusted 统一 Contract

```text
             ExtensionApi
                   │
        ┌──────────┴──────────┐
        │                     │
     Trusted               Sandbox
        │                     │
    direct calls             RPC
        │                     │
        └──────────┬──────────┘
                   ↓
               Folyn Core
```

这样未来 Sandbox 可以逐步支持：

- File Viewer
- Office Renderer
- Third-party Preview
- Untrusted community extension

---

# 42. Error Isolation

## 42.1 Extension activation

```ts
try {
  await extension.activate(api, ctx);
} catch (error) {
  await runtime.dispose();
  state = "failed";
}
```

## 42.2 UI rendering

每个 Extension View 必须具有独立 Error Boundary：

```text
Extension A ❌
Extension B ✅
Extension C ✅
```

### Error Boundary 降级策略

```tsx
<ExtensionBoundary extensionId={id} fallback={<ErrorFallback />}>
  <ExtensionView />
</ExtensionBoundary>
```

**FileType Extension 失败：**
```tsx
function FileTypeErrorFallback({ file }: { file: FileRef }) {
  const content = useFileContent(file);
  return (
    <div className="error-fallback">
      <ErrorIcon />
      <h3>无法渲染文件</h3>
      <p>插件 {extensionId} 渲染失败</p>
      {content && <pre>{content}</pre>}
      {!content && <FileInfo path={file.path} size={file.size} />}
      <button onClick={reloadExtension}>重新加载插件</button>
    </div>
  );
}
```

**Tool Extension 失败：**
```tsx
function ToolErrorFallback({ extensionId }: { extensionId: string }) {
  return (
    <div className="error-fallback">
      <ErrorIcon />
      <h3>工具加载失败</h3>
      <p>插件 {extensionId} 无法启动</p>
      <button onClick={reloadExtension}>重新加载</button>
      <button onClick={disableExtension}>禁用插件</button>
      <button onClick={viewLogs}>查看日志</button>
    </div>
  );
}
```

## 42.3 Renderer

File Viewer 的 DOCX renderer 崩溃不能导致整个 File Viewer 或 Folyn 崩溃。

---

# 43. File Presentation Context

```ts
interface FilePresentationContext {
  readonly file: FileRef;
  readonly fileType: FileTypeInfo;
  readonly mode: string;

  readonly document?: DocumentModel;

  readonly readonly: boolean;
  readonly signal: AbortSignal;

  readonly commands: ScopedCommandApi;
  readonly theme: ThemeContext;
}
```

插件拿到的是逻辑上下文，不是物理 UI 实例。

---

# 44. React UI Adapter

建议拆包：

```text
@folyn/extension-sdk
    ↓
framework-agnostic API

@folyn/extension-ui-react
    ↓
React View / Panel API

@folyn/extension-editor-codemirror
    ↓
CodeMirror-specific API
```

这样未来内部 UI Framework 变化不会直接破坏 Extension SDK。

---

# 45. Folyn UI Shell 重构

最终 Shell：

```text
<AppShell>
  <GlobalToolbar />

  <ActivityBar />

  <MainWorkspace>
    <FileExplorer />
    <CurrentPresentation />
    <CurrentToolWorkspace />
  </MainWorkspace>

  <StatusBar />
</AppShell>
```

`CurrentPresentation`：

```text
FileTypeResolver
    ↓
PresentationResolver
    ↓
Editor / Split / Preview
```

`CurrentToolWorkspace`：

```text
WorkspaceRegistry
    ↓
Active Workspace
    ↓
Plugin View
```

---

# 46. Main Workspace 路由

Main 区域实际上有两类内容：

```text
File Presentation
    ├── Edit
    ├── Split
    └── Preview

Tool Workspace
    ├── Git
    ├── AI
    ├── Calendar
    └── ...
```

推荐定义：

```ts
type MainContent =
  | { type: "file"; fileId: string; mode: string }
  | { type: "workspace"; workspaceId: string };
```

这样 Shell 不需要关心具体插件。

---

# 47. 示例：Markdown Extension

```ts
export default function activate(api, ctx) {
  api.fileTypes.register({
    id: "markdown",
    extensions: [".md", ".markdown"],
    modes: [
      {
        id: "edit",
        title: "Edit",
        create: MarkdownEditor,
      },
      {
        id: "preview",
        title: "Preview",
        create: MarkdownPreview,
      },
      {
        id: "split",
        title: "Split",
        create: MarkdownSplitView,
      },
    ],
  });

  api.exporters.register({
    id: "markdown.pdf",
    fileTypes: ["markdown"],
    title: "PDF",
    export: exportMarkdownToPdf,
  });
}
```

用户看到：

```text
File Explorer
├── README.md

Toolbar
Terminal | AI | Export | Language | Edit | Split | Preview
```

无 Markdown ActivityBar。

---

# 48. 示例：DBML Extension

```ts
export default function activate(api, ctx) {
  api.fileTypes.register({
    id: "dbml",
    extensions: [".dbml"],
    modes: [
      { id: "edit", title: "Edit", create: DBMLEditor },
      { id: "preview", title: "Preview", create: ERDiagram },
      { id: "split", title: "Split", create: DBMLSplitView },
    ],
  });

  api.exporters.register({
    id: "dbml.svg",
    fileTypes: ["dbml"],
    title: "SVG",
    export: exportDbmlToSvg,
  });
}
```

Toolbar 自动显示：

```text
Edit | Split | Preview
```

---

# 49. 示例：Git Tool Extension

```ts
export default function activate(api, ctx) {
  const workspace = ctx.ui.workspace.register({
    id: "git",
    title: "Git",
    icon: "git-branch",
    view: GitView,
  });

  api.commands.register({
    id: "git.open",
    title: "Open Git",
    execute: () => workspace.open(),
  });
}
```

结果：

```text
ActivityBar
├── Files
├── Search
└── Git

点击 Git
  ↓
Main → GitView

Global Toolbar 仍然是统一 Toolbar
```

---

# 50. 示例：File Viewer Extension

Manifest：

```json
{
  "id": "folyn.file-viewer",
  "name": "File Viewer",
  "version": "1.0.0",
  "tier": "sandbox",
  "activationEvents": ["onFileType"],
  "permissions": ["vault.read", "ui"]
}
```

运行时：

```ts
api.fileTypes.register({
  id: "generic.docx",
  extensions: [".docx"],
  priority: -1000,
  modes: [
    {
      id: "preview",
      title: "Preview",
      create: DocxPreview,
    },
  ],
});
```

没有：

```text
ActivityBar icon
```

---

# 51. File Viewer 的 Fallback 机制

```text
Open report.docx
      ↓
FileTypeResolver
      ↓
Specialized Office Provider?
      │
      ├── yes → use it
      │
      └── no
           ↓
      Generic File Viewer
           ↓
        DOCX Preview
```

因此 Generic File Viewer 不会抢占 First-class Extension。

---

# 52. 文件类型优先级

建议：

```text
Priority

10000  Core / First-party First-class Provider
 5000  Installed specialized Extension
 1000  User configured Provider
    0  Generic Provider
-1000  Fallback File Viewer
```

但最终应综合：

```text
priority
specificity
user default
availability
trust
```

---

# 53. Open With

File Explorer 右键：

```text
Open With
├── Markdown Editor
├── File Viewer
└── External Application
```

对应 API：

```ts
api.files.open(file, {
  providerId: "markdown",
  mode: "preview",
});
```

### 用户偏好持久化

```ts
interface FileTypePreference {
  extension: string;          // ".docx"
  defaultProviderId: string;  // "office-viewer"
  timestamp: number;
}

class FileTypePreferenceStore {
  private preferences = new Map<string, FileTypePreference>();
  
  setPreference(extension: string, providerId: string) {
    this.preferences.set(extension, {
      extension, defaultProviderId: providerId, timestamp: Date.now(),
    });
    this.persist();
  }
  
  getPreferredProvider(extension: string): string | null {
    return this.preferences.get(extension)?.defaultProviderId ?? null;
  }
}
```

FileType 解析优先级：1. 用户偏好 (Open With) → 2. Extension priority → 3. 安装顺序 → 4. Fallback File Viewer。

---

# 54. Shared Export UI

当前文件：`schema.dbml`

Toolbar：

```text
Terminal | AI | Export | Language | Edit | Split | Preview
```

点击 Export：

```text
Export
├── SVG
├── PNG
└── PDF
```

这些菜单项由：

```text
ExportService
   ↓
ExporterRegistry
   ↓
Current FileType
```

动态计算。

---

# 55. Export Preview

后续可以支持：

```ts
interface ExporterRegistration {
  preview?(context: ExportContext): Promise<PreviewResult>;
}
```

流程：

```text
Export
 ↓
Prepare
 ↓
Preview
 ↓
Confirm
 ↓
Export
```

第一期不是必须，但 API 应预留。

---

# 56. Renderer On-demand Loading

File Viewer 特别需要按需加载：

```text
Folyn startup
   ↓
File Viewer manifest only

open docx
   ↓
load DOCX renderer

open pptx
   ↓
load PPTX renderer
```

不要启动时把：

```text
DOCX engine
PPTX engine
XLSX engine
PDF engine
```

全部载入内存。

已有独立 file-viewer 架构也采用 renderer plugin + on-demand loading，并将 Presentation / Word renderer 与 Core 解耦。citeturn942185search0

---

# 57. Renderer Sandbox 边界

复杂 renderer：

```text
Plugin
  ↓
Worker / OffscreenCanvas / WASM
  ↓
Presentation Result
```

不要：

```text
Plugin → raw Tauri API
```

这尤其适合：

```text
DOCX
PPTX
XLSX
PDF
Archive
```

---

# 58. Registry 设计

建议所有 Registry 都具备：

```ts
interface Registry<T> {
  register(value: T): Disposable;
  get(id: string): T | undefined;
  list(): T[];
  remove(id: string): void;
  removeByOwner(ownerId: string): void;
}
```

具体：

```text
ExtensionRegistry
CommandRegistry
FileTypeRegistry
ExporterRegistry
WorkspaceRegistry
ViewRegistry
```

---

# 59. Transactional Registration

Activation 期间使用事务式注册，详细实现：

```ts
class ExtensionRuntime {
  private registrations: Disposable[] = [];
  private committed = false;
  
  async activate(api: ExtensionApi, baseCtx: ExtensionContext) {
    try {
      const scopedCtx = this.createTransactionalContext(baseCtx);
      await this.extension.activate(api, scopedCtx);
      this.committed = true;
    } catch (error) {
      await this.rollback();
      throw error;
    }
  }
  
  private createTransactionalContext(baseCtx: ExtensionContext): ExtensionContext {
    return {
      ...baseCtx,
      addDisposable: (d: Disposable) => {
        this.registrations.push(d);
        if (this.committed) baseCtx.addDisposable(d);
      },
    };
  }
  
  private async rollback() {
    for (const d of this.registrations.reverse()) {
      try { await d.dispose(); }
      catch (err) { console.error('[extension-runtime] rollback failed:', err); }
    }
    this.registrations = [];
  }
}
```

流程：create Runtime → begin transaction (缓存 registrations) → activate() → 成功 commit | 失败 rollback。

这样可以杜绝"插件激活失败但部分 UI/Command 残留"的问题。

---

# 60. ExtensionHost 责任边界

ExtensionHost 只负责：

```text
Discovery
Lifecycle
Trust
Permission
Loader
Runtime
Error Isolation
```

不负责：

```text
Markdown rendering
React layout
File Explorer layout
Export PDF internals
```

后者属于对应 Service / Provider / Adapter。

---

# 61. ExtensionManager 与 ExtensionHost

二者分离：

```text
ExtensionManager
├── install
├── uninstall
├── enable
├── disable
├── update
└── metadata

ExtensionHost
├── load
├── activate
├── deactivate
├── reload
└── runtime
```

---

# 62. 推荐目录结构

```text
packages/
├── extension-sdk/
│   └── src/
│       ├── api/
│       │   ├── vault.ts
│       │   ├── files.ts
│       │   ├── editor.ts
│       │   ├── ai.ts
│       │   ├── terminal.ts
│       │   ├── export.ts
│       │   └── events.ts
│       │
│       ├── ui/
│       │   ├── context.ts
│       │   ├── workspace.ts
│       │   ├── view.ts
│       │   ├── dialog.ts
│       │   └── notification.ts
│       │
│       ├── file-type.ts
│       ├── exporter.ts
│       ├── command.ts
│       ├── manifest.ts
│       ├── lifecycle.ts
│       ├── disposable.ts
│       └── types.ts
│
├── extension-host/
│   └── src/
│       ├── ExtensionHost.ts
│       ├── ExtensionRuntime.ts
│       ├── ExtensionManager.ts
│       ├── ExtensionRegistry.ts
│       │
│       ├── loaders/
│       │   ├── TrustedExtensionLoader.ts
│       │   └── SandboxExtensionLoader.ts
│       │
│       ├── capabilities/
│       │   ├── createVaultApi.ts
│       │   ├── createFileApi.ts
│       │   ├── createEditorApi.ts
│       │   ├── createAiApi.ts
│       │   ├── createTerminalApi.ts
│       │   └── createExportService.ts
│       │
│       ├── registries/
│       │   ├── CommandRegistry.ts
│       │   ├── FileTypeRegistry.ts
│       │   ├── ExporterRegistry.ts
│       │   ├── WorkspaceRegistry.ts
│       │   └── ViewRegistry.ts
│       │
│       ├── activation/
│       │   └── ActivationManager.ts
│       │
│       └── security/
│           ├── TrustStore.ts
│           └── PermissionResolver.ts
│
├── extension-ui/
│   ├── UIContributionRegistry.ts
│   ├── ToolbarResolver.ts
│   ├── ContextKeyService.ts
│   └── PresentationResolver.ts
│
└── create-folyn-extension/
```

现有 `plugin-sdk` / `plugin-host` 可以逐步迁移，不需要一次性 rename 全部包。

---

# 63. 推荐的迁移策略

## Phase 0：建立测试基线

在修改运行时之前，补齐：

- Plugin Host lifecycle tests
- Disposable tests
- Permission tests
- FileType resolution tests
- Exporter resolution tests
- UI contribution disposal tests
- Trusted / Sandbox smoke tests

验收目标：现有插件全部可以跑通。

## Phase 1：Extension Runtime

新增：

```text
ExtensionHost
ExtensionRuntime
ExtensionContext
```

兼容：

```text
PluginModule
PluginContext
```

通过 Adapter 运行现有插件。

## Phase 2：ExtensionApi

逐步把：

```text
PluginContext.ai
PluginContext.env
PluginContext.http
```

迁移到：

```text
ExtensionApi.ai
ExtensionApi.network
ExtensionApi...
```

## Phase 3：Registry Ownership

把所有 Contribution Registry 统一成：

```text
ownerExtensionId
Disposable
removeByOwner()
```

## Phase 4：FileType / Presentation

重构：

```text
FileTypeContribution
ContainerContribution
Editor related contribution
```

形成：

```text
FileTypeProvider
PresentationMode
EditorProvider
PreviewProvider
```

## Phase 5：Shared Toolbar

从插件 UI 中移除：

```text
Plugin Toolbar
```

改成：

```text
Global Toolbar
CurrentContext → ToolbarResolver
```

## Phase 6：ExportService

统一：

```text
ExportService
ExporterRegistry
Exporter
```

## Phase 7：Generic File Viewer

将 DOCX / PPTX / XLSX / PDF / Media 等迁出 Core。

实现：

```text
file-viewer
```

作为 fallback Extension。

## Phase 8：Sandbox File Viewer

先完成：

```text
Binary File API
Presentation RPC
Worker / WASM support
```

然后让 File Viewer 逐步运行在 Sandbox。

---

# 64. 迁移兼容层

建议增加：

```ts
class LegacyPluginAdapter implements Extension {
  constructor(private legacy: PluginModule) {}

  activate(api, ctx) {
    return legacy.activate(createLegacyContext(api, ctx));
  }
}
```

这样旧插件可以继续运行。

迁移完成后再删除：

```text
LegacyPluginAdapter
PluginModule
PluginContext
```

---

# 65. 第一阶段不要重写所有插件

迁移顺序建议：

```text
1. 一个最简单 Service Plugin
2. Markdown FileType
3. DBML FileType
4. Git Tool Workspace
5. Exporter
6. File Viewer
```

每迁移一个类型就建立对应 Contract Test。

---

# 66. Contract Tests

Extension SDK 应提供测试工具：

```ts
createExtensionTestHost()
createMockVault()
createMockEditor()
createMockFile()
```

例如：

```ts
it("registers markdown file type", async () => {
  const host = createExtensionTestHost();
  await host.activate(markdownExtension);
  expect(host.fileTypes.resolve("test.md").id).toBe("markdown");
});
```

### Phase 0 测试覆盖率目标

在修改任何运行时代码前，必须达到以下测试基线：

**Critical Path（必须 100% 覆盖）：**
- Disposable cleanup：所有 dispose 路径
- Permission enforcement：所有权限检查
- AbortSignal propagation：取消传播机制
- Transactional registration rollback：失败回滚

**Core Lifecycle（≥90% 分支覆盖）：**
- PluginHost state machine：install → activate → deactivate → uninstall
- Extension activation error handling
- Extension deactivation error handling
- Registry ownership tracking

**Resolution Logic（≥85% 覆盖）：**
- FileType resolution（extension, priority, user preference）
- Exporter resolution（fileType, priority, supports()）
- Toolbar resolution（context-driven）

**验收标准：**

```bash
pnpm test packages/extension-host
pnpm test packages/extension-sdk

# 覆盖率必须满足：
# - Critical path: 100%
# - Core lifecycle: ≥90%
# - Resolution: ≥85%
# - Overall: ≥85%
```

只有测试基线达标后，才能开始 Phase 1（ExtensionRuntime 重构）。

---

# 67. FileType Contract Test

至少覆盖：

```text
.md
.markdown
DBML
Drawio
unknown extension
missing extension
binary file
```

同时验证：

```text
edit
split
preview
```

是否正确解析。

---

# 68. Export Contract Test

例如：

```text
Markdown
  → HTML
  → PDF

DBML
  → SVG
  → PNG

DOCX
  → no exporter
```

验证：

```text
correct exporter
priority
supports()
output metadata
error
cancel
```

---

# 69. UI Contract Test

验证：

```text
register workspace
ActivityBar appears
click workspace
main view appears
reload
old view disappears
new view appears
extension fail
other UI unaffected
```

---

# 70. File Viewer Contract Test

必须验证：

```text
README.md
    → Markdown

test.drawio
    → Drawio

test.dbml
    → DBML

test.docx
    → File Viewer

test.pptx
    → File Viewer

test.unknown
    → fallback / unsupported state
```

如果安装 specialized provider：

```text
test.docx
    → specialized provider
    ≠ File Viewer
```

---

# 71. 性能要求

Extension 系统必须支持 Lazy Activation：

```text
Folyn startup
  ↓
read manifests
  ↓
register metadata
  ↓
no activation unless needed
```

File Viewer：

```text
startup
  ↓
no Office renderer

open DOCX
  ↓
load DOCX renderer
```

Tool Extension：

```text
startup
  ↓
no Git / Calendar / Wiki UI until needed
```

---

# 72. 内存与生命周期要求

关闭文件后：

```text
Editor / Preview
   ↓
dispose
   ↓
listeners removed
worker terminated
large buffers released
```

切换 Vault：

```text
Abort current operations
↓
Dispose file presentations
↓
Switch Vault
↓
Re-resolve providers
```

---

# 73. Security Requirements

Trusted Plugin：

```text
full trust
```

所以用户安装前必须明确知道：

- Plugin ID
- Version
- Source
- Permission
- Trust state
- Integrity state

Sandbox Plugin：

```text
RPC only
no raw Tauri APIs
scoped file access
```

文件 Viewer 优先考虑 Sandbox。

---

# 74. API Versioning

SDK 应有稳定版本：

```ts
manifest.engines.folyn
```

同时建议：

```text
@folyn/extension-sdk v1
```

破坏性 API 变化：

```text
v1 → v2
```

而不是随着 Folyn 版本随意变化。

---

# 75. 推荐的第一版稳定 API

第一阶段 SDK 只承诺：

```ts
Extension
ExtensionManifest
ExtensionApi
ExtensionContext
ExtensionUIContext

api.files
api.vault
api.editor
api.commands
api.events
api.storage
api.ai
api.terminal
api.export
api.fileTypes
api.exporters

ctx.ui.workspace
ctx.ui.views
ctx.ui.dialogs
ctx.ui.notifications
```

不要一次公开：

```text
DOM
React internals
CodeMirror internals
Layout internals
Zustand
Tauri internals
```

---

# 76. 最终产品模型

整个 Folyn 插件系统可以统一为：

```text
                         Extension
                              │
          ┌───────────────────┼───────────────────┐
          │                   │                   │
      File Type            Tool                Service
          │                   │                   │
   ┌──────┼──────┐      ActivityBar          Commands
   │      │      │           │                Events
 Editor Preview Modes     Workspace           AI/Other
   │      │      │           │
   └──────┼──────┘           │
          │                  │
       Exporter              │
          │                  │
          └──────────┬───────┘
                     ↓
               Extension Runtime
                     ↓
                  Folyn Core
```

Folyn Core：

```text
ActivityBar
FileExplorer
Main Shell
Global Toolbar
ExportService
FileSystem
Presentation Host
```

Extension：

```text
FileType
Editor
Preview
Mode
Exporter
Workspace
Command
Service
```

---

# 77. 最终关键规则

### Rule 1

> Extension 不修改 Folyn UI 内部实现，只向 Folyn UI Shell 提供语义化贡献。

### Rule 2

> ActivityBar 是 Tool Workspace 的入口，不是所有 Plugin 的入口。

### Rule 3

> FileType Plugin 融入 FileExplorer，不创建 ActivityBar。

### Rule 4

> File Explorer 负责文件生命周期；FileType 负责文件语义和呈现。

### Rule 5

> Editor / Preview / Split 是 FileType 的 Presentation Modes。

### Rule 6

> Toolbar 是 Folyn Core-owned，但其内容由当前 Context + Extension Capabilities 动态决定。

### Rule 7

> ExportService 属于 Core；Exporter 属于 Extension。

### Rule 8

> Generic File Viewer 是低优先级 fallback Extension，不应该与 First-class FileType 竞争。

### Rule 9

> 每个注册项必须有 owner，所有 Runtime 资源必须 Disposable。

### Rule 10

> Reload = destroy Runtime + create Runtime，不是简单重新 import。

### Rule 11

> Trusted 与 Sandbox 使用同一套 Extension Contract。

### Rule 12

> Production Tauri runtime 不以 jiti 为核心 ABI；jiti 仅属于 Node-side tooling / development。

---

# 78. 建议的实施优先级

按照风险从低到高：

```text
P0  ExtensionRuntime / Disposable / Error Boundary
P0  ExtensionApi / ExtensionContext
P0  Registry ownership
P1  FileTypeProvider / PresentationMode
P1  Shared Toolbar / Context Resolver
P1  ExportService / ExporterRegistry
P1  Workspace / ActivityBar integration
P2  Generic File Viewer
P2  File Viewer on-demand renderer loading
P2  Sandbox File Viewer
P3  Open With / Provider override persistence
P3  Advanced When Clause / Context Key DSL
P3  Extension Marketplace / Update / Signature
```

---

# 79. 第一阶段完成标准

当以下流程全部成立时，认为 Extension Runtime 基础重构完成：

```text
启动 Folyn
  ↓
Discover extensions
  ↓
Manifest validation
  ↓
Trust / Permission
  ↓
Lazy activation
  ↓
ExtensionRuntime
  ↓
ExtensionApi + ExtensionContext
  ↓
Disposable lifecycle
  ↓
Error isolation
```

且以下插件模型全部可以实现：

```text
Tool Extension
    ActivityBar → Workspace → Main View

FileType Extension
    FileExplorer → FileType → Edit/Split/Preview

Service Extension
    Commands / Events / Services

Exporter Extension
    ExportService → Exporter

Generic File Viewer
    unknown/common file → fallback Preview
```

---

# 80. 第二阶段完成标准

Folyn Core 能做到：

```text
File Explorer
    ↓
FileTypeResolver
    ↓
PresentationResolver
    ↓
Current Main Content
```

Global Toolbar 能做到：

```text
Current Context
    ↓
Terminal
AI
Export
Language
Mode
```

并且不包含任何：

```text
Markdown-specific if/else
DBML-specific if/else
Drawio-specific if/else
DOCX-specific if/else
```

---

# 81. 第三阶段完成标准

最终达到：

```text
Markdown
  edit / split / preview

DBML
  edit / split / preview

Drawio
  edit / preview

DOCX
  preview via File Viewer

PPTX
  preview via File Viewer

XLSX
  preview via File Viewer

Git
  ActivityBar + Workspace

AI
  ActivityBar + Workspace

Export
  shared Toolbar + ExportService
```

且安装新插件后，无需修改 Folyn Core。

---

# 82. 最终架构判断

这套架构的核心不是“让插件修改 UI”，而是把 Folyn UI 做成一个稳定的 Host Shell：

```text
                   Folyn Shell
                       │
     ┌─────────────────┼─────────────────┐
     │                 │                 │
ActivityBar       FileExplorer       Toolbar
     │                 │                 │
Tool Extensions   FileType Plugins   Capabilities
     │                 │                 │
Workspace         Editor/Preview     Export/AI/etc.
     │                 │                 │
     └─────────────────┼─────────────────┘
                       ↓
                Extension Runtime
```

最终达到的产品语义：

```text
FileType
    我是什么

Editor
    如何编辑我

Preview
    如何查看我

PresentationMode
    当前如何呈现我

Exporter
    如何输出我

Command
    我能做什么

Workspace
    我是否需要一个独立工具入口

FileViewer
    如果没有专用呈现器，我仍然可以查看它

Toolbar
    Folyn 提供统一操作入口

ExtensionRuntime
    Folyn 负责插件生命周期与隔离
```

这套模型既保留当前 Folyn 已有的 Contribution / Permission / Trust / Sandbox 基础，又将它们收敛到一个明确的 Extension Runtime 中，并为后续 File Viewer、复杂文件格式、工具型 Workspace 和第三方插件生态留下稳定扩展点。

---

## 参考资料

- Folyn Repository：`https://github.com/linyimin0812/folyn`  
  当前仓库已经包含 Plugin SDK、Plugin Host、Trusted/Sandbox 双层插件模型、多格式编辑与 Universal Preview。citehttps://github.com/linyimin0812/folyn
- Folyn Plugin SDK：`https://github.com/linyimin0812/folyn/tree/master/packages/plugin-sdk`  
  当前 SDK 已包含 Manifest、Permission、Contribution Point、PluginModule 与 PluginContext 等基础。citehttps://github.com/linyimin0812/folyn/tree/master/packages/plugin-sdk
- File Viewer renderer architecture example：`https://github.com/flyfish-dev/file-viewer/blob/main/docs/zh/guide/on-demand-renderers.md`  
  其架构采用 renderer plugin / on-demand loading 拆分复杂 Word、Presentation 等格式。citeturn942185search0
- VSCode Office：`https://github.com/cweijan/vscode-office`  
  展示了将 Word / PowerPoint / Excel / PDF 等通用格式统一为 Office Viewer Extension 的可行性。citeturn942185search2

