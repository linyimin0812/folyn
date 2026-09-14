# 富文本HTML导出支持远程与本地选择

## Goal

让 `.richtext` 文件导出 HTML 时弹出选择对话框，让用户选择"下载到本地"或"上传到远程存储"。当前扩展贡献的导出器直接下载、无弹窗，与内置导出器重复且缺失远程选项。

## What I already know

- **两条平行的 rich-text → HTML 导出路径，目前共存：**
  1. **内置路径**（host）：`apps/desktop/src/services/export/exporterRegistry.ts` 中注册了 `rich-text.html`，调用 `apps/desktop/src/services/export/richtext.ts` 的 `richTextToHtmlBlob`。在 `ExportMenu.tsx` 中通过 `FormatExportDialog` 弹窗，已支持本地下载 / 远程上传二选一。✅
  2. **扩展贡献路径**：`extensions/rich-text/src/manifest.json` 的 `contributes.exporters` 声明了 `rich-text-html`，由 `apps/desktop/src/services/extension-host/exporterAdapter.ts` 注册为命令 `extension.folyn-rich-text.export.html`。命令直接调用 `downloadBlob`，**无弹窗、无远程选项**。❌
- 结果：在 `.richtext` 文件的导出菜单中，用户会看到**两条 HTML 条目**，其中扩展那条缺失弹窗。
- `services/export/richtext.ts`（host）与 `extensions/rich-text/src/exporters/richtextHtml.ts`（extension）是几乎逐字相同的两份实现。
- Phase 3 relocate commit (`7280442a`) 显式留注："Phase 4 will collapse the duplicate export pipeline"。
- `FormatExportDialog` 已是成熟的"本地/远程"选择弹窗：复用 `ProviderPicker`、storage provider 配置、上传后回写剪贴板等。任何走 `exportService.runExporter` → `FormatExportDialog` 的路径都自动获得弹窗。

## Assumptions (temporary)

- 用户希望保留扩展作为 rich-text HTML 导出逻辑的"规范归属"（与 Phase 3 relocate 方向一致）。
- 用户希望菜单中只出现**一条** HTML 条目，避免重复。

## Decision (ADR-lite)

**Context**: 用户决策——rich-text HTML 导出由扩展自己实现，删除 host 内置实现。理由：内置无法感知扩展具体实现，重复实现是反模式。

**Decision**: Approach B（refined）——保留 manifest `contributes.exporters` 作为声明式来源；改造 `exporterAdapter.ts` 把 manifest 贡献的导出器注册进 host 的 `exportService`（`exporterRegistry`），而非注册命令 + 直接 `downloadBlob`。删除 host 内置 `rich-text.html` 注册和重复文件 `services/export/richtext.ts`。`FormatExportDialog` 已支持本地/远程弹窗，扩展导出器自动走该弹窗。

**Consequences**:
- 菜单只剩一条 HTML 入口（来自扩展），自动弹窗选择本地/远程。✅
- 删除重复实现 + 测试 + 死代码菜单循环。净删除。
- `exporterAdapter.ts` 的命令注册路径删除——`activeExporters` map / `getExtensionExportersForFileType` / `clearExtensionExporters` 一并删除。
- 未来若其他扩展使用 `contributes.exporters`，同样自动走弹窗——generic、无特例。

## Technical Approach

**改造 `exporterAdapter.ts`**：`registerExtensionExporters(manifest, module)` 现把每个 `contributes.exporters[]` 项映射成 `ExporterRegistration`：
- `id`: `${manifest.id}.${contrib.id}`（命名空间，避免与 builtin 冲突）
- `title`: `contrib.label`
- `fileTypes`: `[contrib.fileType]`
- `formats`: `[{ id: contrib.format, title: contrib.label, extension: contrib.fileExtension, mimeType: 'text/html;charset=utf-8' }]`（mimeType 从 handler 返回值推断；rich-text 是 text/html）
- `export(ctx)`: 调用 `module.exporters[contrib.run](content, ctx)`，把返回的 `Blob | string` 包成 `ExportResult`（`{ data, mimeType, suggestedName }`）。`suggestedName` = `<baseName>.<fileExtension>`。

通过 `exporterRegistry.register(reg, manifest.id)` 注册，返回 `Disposable` 在扩展 deactivate 时移除。

**删除 host 重复**：
- `apps/desktop/src/services/export/richtext.ts`（整文件）。
- `exporterRegistry.ts`: 删 `richTextHtmlExporter` 块 (line 139-150)、`register(richTextHtmlExporter, ...)` (line 198)、`import { richTextToHtmlBlob } from './richtext'` (line 28)。
- `apps/desktop/src/services/export/richtext.test.ts`（扩展侧 `extensions/rich-text/src/exporters/richtextHtml.test.ts` 已覆盖）。

**清理 ExportMenu**：
- 删除 `getExtensionExportersForFileType` 循环 (line 162-171) 与 import (line 14)。
- 扩展导出器现在经由 `getAvailableExporters` 循环 (line 132-158) 出现，点击触发 `FormatExportDialog`——已实现本地/远程弹窗。

**更新测试**：
- `exporterAdapter.test.ts`: 改为断言注册后能在 `exporterRegistry.getForFileType(...)` 找到、`export(...)` 调用 handler、disposable 移除生效。
- 删除 `clearExtensionExporters` 测试（函数已删）。

## Implementation Plan (single PR)

1. 重写 `exporterAdapter.ts`（注册进 registry 而非 command）。
2. 更新 `exporterAdapter.test.ts`。
3. 删除 `services/export/richtext.ts` + `richtext.test.ts`。
4. 清理 `exporterRegistry.ts`（删 rich-text 内置 exporter + import + register 调用）。
5. 清理 `ExportMenu.tsx`（删 extension exporters 循环 + import）。
6. 运行 `pnpm typecheck` + `pnpm test` 验证。

## Requirements (evolving)

- `.richtext` 文件导出 HTML 时弹出对话框，让用户选择"下载到本地"或"上传到远程存储提供商"。
- 远程选项需复用现有 storage provider 配置（r2/qiniu/oss/local）。
- 导出菜单中 rich-text → HTML 只出现一条入口。

## Acceptance Criteria (evolving)

- [ ] 在 `.richtext` 文件激活时，Export 菜单点击 HTML 入口后弹出"本地/远程"选择弹窗。
- [ ] 选择"本地"时下载 `.html` 文件到磁盘。
- [ ] 选择"远程"并配置好 storage provider 时，上传 HTML 文件并返回可分享 URL。
- [ ] 导出菜单中 rich-text → HTML 仅一条入口，无重复。

## Definition of Done

- Tests 覆盖弹窗路由（已有 FormatExportDialog 测试可复用 / 扩展）。
- Lint / typecheck / CI 绿。
- 不留死代码（删除冗余实现）。

## Out of Scope (explicit)

- 其他文件类型的导出弹窗（已是现状）。
- 新增 storage provider。
- 导出 HTML 内容本身（样式、KaTeX、代码高亮）的改动。

## Technical Notes

- 关键文件：
  - `extensions/rich-text/src/manifest.json` — 扩展贡献的导出器声明。
  - `extensions/rich-text/src/index.tsx` — 扩展侧 ExporterHandler。
  - `extensions/rich-text/src/exporters/richtextHtml.ts` — 扩展侧 HTML 生成实现。
  - `apps/desktop/src/services/export/exporterRegistry.ts` — 内置 `rich-text.html` 注册（line 140-150）。
  - `apps/desktop/src/services/export/richtext.ts` — host 侧重复实现（与扩展版几乎相同）。
  - `apps/desktop/src/services/extension-host/exporterAdapter.ts` — 扩展贡献路径的命令执行体（直接 `downloadBlob`）。
  - `apps/desktop/src/components/editor/ExportMenu.tsx` — 菜单装配，line 132 起 `getAvailableExporters`，line 162 起 `getExtensionExportersForFileType`。
  - `apps/desktop/src/components/editor/FormatExportDialog.tsx` — 已有"本地/远程"弹窗。
