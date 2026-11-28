# 打开已有 md 文件用 preview 模式，新建 md 文档才用 split 模式

## Goal

Markdown 打开体验以「读」为先：任何入口打开一个**已存在**的 md 文件（vault 内、外部文件、拖拽、
搜索、链接跳转、重启恢复会话）默认进入 preview（纯阅读）模式；只有**新建** md 文档时才默认
split（编辑+预览）模式，因为新建后马上要写内容。

## What I already know (from repo)

* 打开文件的唯一入口是 `apps/desktop/src/services/editorIoService.ts` 的 `openFile()`：
  新标签的 `viewMode` 取 `getDefaultMode(handler)`（registry.ts:78 → handler 声明的
  `defaultMode`，否则第一个 mode）。
* Markdown handler（`apps/desktop/src/components/file-types/markdown/index.ts`）声明
  `defaultMode: 'split'`，modes = edit / split / preview。
* 重新激活已打开的标签：`existing.viewMode ?? getDefaultMode(handler)`（editorIoService.ts:168）；
  `setActiveTab` 恢复 tab 上保存的模式；`WorkArea.tsx` L154-160 在切换到无保存模式的 md 标签时，
  会把全局 viewMode 重置为 handler 默认（兼容逻辑，改默认后自动跟随）。
* 会话恢复（`restoreOpenTabs` / `restoreExternalTabs`）恢复 tab 上保存的 `viewMode`；
  无保存模式的旧标签由 WorkArea 兼容逻辑落到新的 handler 默认。
* 外部文件（`openExternalPaths` / 拖拽 / Open With / 单实例二次启动）最终也走 `openFile()`，
  所以改默认值后自动生效。
* 新建文件的所有 UI 入口（侧边栏按钮、右键菜单、命令面板 `action.new-file`）都汇聚到
  `SidebarActions.confirmNewItem`：`vaultCreateFile()` 后调 `handleFileClick(fullPath, finalName)`
  （FilesPanel.tsx:104 → `openFile`）。文件创建后已存在于磁盘，所以 openFile 内部无法区分
  「新建后打开」与「打开已有」——必须由调用方显式传入初始 viewMode。
* `ViewMode` 类型：`file-types/types.ts`（经 editorStore re-export）。

## Requirements (evolving)

1. Markdown handler `defaultMode` 由 `'split'` 改为 `'preview'`（只改 markdown，markmap 等其他
   handler 不动）。
2. `openFile()` 增加 `options.viewMode?: ViewMode`：新标签的初始 viewMode =
   `options.viewMode ?? getDefaultMode(handler)`；激活时的全局 viewMode 同样用该值。
   background 打开不触碰全局模式（现状保持）。
3. `handleFileClick`（FilesPanel）透传该参数；`confirmNewItem` 在新建文件的类型为
   markdown（`detectFileType(fullPath) === 'markdown'`，尊重 Open-With 偏好）时传
   `{ viewMode: 'split' }`。其他类型不传，走各自 handler 默认。
4. 用户手动切换过的模式仍按现状持久化在 tab 上（`setViewMode` 写入 activeTab），重新激活/
   重开该标签恢复用户选择，不被新默认覆盖。

## Decision (ADR-lite)

**Context**: 「打开已有 md」覆盖哪些入口、手动模式是否保留，存在两种读法。
**Decision**（用户确认 2026-11-28）：
* 所有打开入口（文件树、全局搜索、文档内链接、拖拽 / Open With / 外部选择器、重启恢复的
  无保存模式旧标签）统一默认 preview；仅新建 md 文档用 split。
* 保留手动切换模式的 per-tab 持久化（现状行为）；新默认只影响从未手动切换过的标签。
**Consequences**: 规则无例外分支，实现只在 handler 默认值 + 新建流程透传两处；未来若要
区分入口，需在 openFile 增加 per-call 默认，成本局部。

## Acceptance Criteria (evolving)

* [ ] 从文件树点击已有 .md → 打开即 preview。
* [ ] 拖拽 / Open With / 外部选择器打开外部 .md → preview。
* [ ] 侧边栏新建 .md（含模板、右键新建、命令面板新建）→ split。
* [ ] 用户手动切换某标签为 edit/split 后切走再切回 → 恢复手动选择的模式。
* [ ] 非 markdown 类型打开行为不变（markmap 仍 split、图片仍 preview 等）。
* [ ] 重启恢复会话：有保存模式的标签恢复保存值；无保存模式的旧 md 标签激活时落到 preview。
* [ ] 相关单测覆盖 openFile 的 viewMode 决策与 confirmNewItem 的透传。

## Definition of Done

* 单测新增/更新并通过（vitest 定向跑，不做全项目构建）。
* lint / typecheck 定向通过。
* 行为变更若有文档面（无 UI 文案变更，预计无）则同步。

## Out of Scope (explicit)

* 其他文件类型（markmap / excalidraw / rich-text …）的默认模式。
* 新增用户设置项（默认打开模式偏好）。
* 移动端布局强制模式逻辑（useIsMobile）。

## Technical Notes

* 涉及文件：
  * `apps/desktop/src/components/file-types/markdown/index.ts`
  * `apps/desktop/src/services/editorIoService.ts`
  * `apps/desktop/src/components/sidebar/FilesPanel.tsx`
  * `apps/desktop/src/components/sidebar/SidebarActions.tsx`
* `detectFileType` 已导出于 editorStore；SidebarActions 引入不会成环。
* `WorkArea.tsx` L158-160 的默认模式回写逻辑无需改动，语义自动跟随新默认。
* 遵循 AGENTS.md：不做整项目编译；用定向 tsc/vitest 验证。
