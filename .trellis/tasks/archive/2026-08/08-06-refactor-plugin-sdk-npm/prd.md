# refactor-plugin-sdk-npm

## Goal

重构插件能力，让插件通过 npm 包依赖实现。当前 `@folyn/plugin-host` 把 SDK 契约（manifest/贡献点/AI 能力类型）与运行时微内核（PluginHost/Loader）打包在一起，仅以 `workspace:*` 供内部插件依赖。需要拆出可发布的外部 SDK，并补齐用户列出的若干贡献能力。

## What I already know

- 现有 `packages/plugin-host`：PluginHost 微内核 + manifest schema + 5 个贡献点（commands / fileTypes / containers / features / tools）+ AI 能力（chat / agent）+ 双 tier（sandbox / trusted）+ Disposable。
- 现有插件依赖方式：`plugins/plugin-graphviz` 与 `examples/plugins/*` 均以 `@folyn/plugin-host: workspace:*` 依赖。
- 文档 `docs/plugin-development.md` 已记录 manifest schema、tier、贡献点、RPC 表、TOFU、打包。
- `FileTypeContribution` 已有 `extensions / handler / defaultViewMode`；但无「自定义 view mode 注册」「文件导出」「右键新建二级菜单」「AI 编辑文件」贡献点。
- 无独立 keybinding 贡献点（commands 存在但无快捷键绑定）。

## Decision (ADR-lite) — Q1

**Context**: `@folyn/plugin-host` 把 SDK 契约 + 运行时微内核打在一起，仅 `workspace:*` 内部可用，外部插件作者无法从 npm 安装。
**Decision**: 拆出 `@folyn/plugin-sdk`（manifest/贡献点/AI 能力类型 + dev helpers，不含 PluginHost/Loader 运行时），发布到 npm；运行时留在 `@folyn/plugin-host`。
**Consequences**: 现有 `plugin-host` 需 re-export SDK 类型以兼容既有 import；plugin-graphviz/examples 改依赖 `@folyn/plugin-sdk`；新增 dev helpers 需定义边界。

## Decision (ADR-lite) — Q2

**Context**: 用户列出「插件能力」含若干当前无贡献点的项（文件导出 / 右键新建二级菜单 / AI 编辑 / 快捷键 / 自定义 view mode）。
**Decision**: 全部纳入——SDK 定义这些新贡献点类型契约，并在本任务实现 host 侧 adapter。
**Consequences**: 任务体量较大；拆 PR 推进。`ViewMode` 已有 5 种（split/edit/preview/visual/source），「自定义 view mode」= 允许插件声明扩展模式名。

## Open Questions

- Q3: 契约类型（`FileTypeHandler`/`ContainerProps`/`PluginModule`/`ViewMode`）是否提到 SDK？

## Technical Approach (design)

### 1. SDK 拆分 — 新包 `packages/plugin-sdk`
- `src/types.ts`：manifest + 既有 5 贡献点 + 5 新贡献点 + AI 能力 + Disposable + Plugin/PluginContext/PluginLoader 接口（从 `plugin-host/src/types.ts` 迁入）。
- `src/contracts.ts`：`PluginModule` 导出契约 + （依 Q3）`FileTypeHandler`/`EditorProps`/`PreviewProps`/`ViewMode`/`ContainerProps`/`ContainerCategory`。
- `src/definePlugin.ts`：dev helper `definePlugin(manifest)` 类型守卫；`validateManifest`（从 PluginHost 抽出，host 复用）。
- `index.ts` re-export。React 作 peerDependency（契约类型引用 `ComponentType`）。

### 2. `@folyn/plugin-host` 瘦身
- 依赖 `@folyn/plugin-sdk`，re-export 其全部公共类型（兼容既有 `import from '@folyn/plugin-host'`）。
- 保留：`PluginHost` 类 + `pluginHost` 单例 + `Disposable`（re-export 自 sdk）。
- `validateManifest` 调用 sdk 实现。

### 3. 5 个新贡献点（SDK 类型 + host adapter）

| 贡献点 | manifest 字段 | adapter 接入点 |
|---|---|---|
| 文件导出 | `contributes.exporters[]` `{id,format,label,fileExtension,run}` | `exporterAdapter.ts` → exportService / 导出菜单 |
| 右键新建二级菜单 | `contributes.fileTemplates[]` `{id,label,fileName,template}` | `fileTemplateAdapter.ts` → 文件栏右键「新建」子菜单 / newItemBridge |
| 快捷键 | `contributes.keybindings[]` `{command,key,mac?,when?}` | `keybindingAdapter.ts` → commandRegistry / global-shortcut |
| 自定义 view mode | `contributes.fileTypes[].viewModes[]` 扩展 | file-types/registry（扩展 ViewMode 注册） |
| AI 编辑 | `permissions.ai.edit?: boolean` + `ctx.ai.editFile`/`ctx.ai.createFile` | `aiCapability.ts` 扩展（host 代理应用文件变更，gated by permission） |

`PluginModule` 增加可选导出：`exporters`/`fileTemplates`/`keybindings`。

### 4. 迁移 & 文档
- `plugins/plugin-graphviz` + `examples/plugins/*`：依赖改 `@folyn/plugin-sdk`；import 路径同步。
- `docs/plugin-development.md`：新增「npm 安装」+ 5 新贡献点章节。
- `pnpm-workspace`：新包注册。

## Acceptance Criteria

- [ ] `@folyn/plugin-sdk` 独立可 build/typecheck，无运行时依赖（types + dev helpers）。
- [ ] `@folyn/plugin-host` re-export 既有类型，既有插件/tests import 不破。
- [ ] 5 新贡献点各有：SDK 类型 + host adapter + 至少 1 个 sample + 单测。
- [ ] plugin-graphviz + examples 迁移到依赖 `@folyn/plugin-sdk`。
- [ ] plugin-development.md 同步。
- [ ] lint / typecheck / test 全绿。

## Definition of Done

- Tests added；lint/typecheck/CI green；docs 更新；既有插件不回归。

## Out of Scope (explicit)

- 沙箱 tier 新贡献点的 RPC 桥接（先做 trusted；sandbox RPC 扩展为后续）。
- 新贡献点的 i18n / 权限细化（exporters 写盘复用既有 `fs.scope`）。
- npm 实际 publish 流程（CI 发布脚本为后续）。

## Implementation Plan (small PRs)

- PR1: 拆 `@folyn/plugin-sdk` + `plugin-host` re-export + 迁移既有类型 + 既有插件改依赖（纯重构，不改行为）。
- PR2: 5 新贡献点 SDK 类型契约 + dev helpers（`definePlugin`/`validateManifest` 抽出）。
- PR3: trusted 侧 5 个 host adapter + 接入既有 registry。
- PR4: samples + 单测 + plugin-development.md 更新。

## Technical Notes

- 关键文件：`packages/plugin-host/src/{types,PluginHost,Disposable}.ts`、`packages/plugin-host/index.ts`、`plugins/plugin-graphviz/*`、`examples/plugins/*`、`docs/plugin-development.md`。
- 约束：pnpm workspace；React 18；Tauri；双 tier 隔离模型。
