# 翻译面板改为独立弹窗 + 桌宠搜索双结果

## Goal

把内置翻译面板从桌宠弹窗（pet-panel）的 Tab 形式重构为**独立浮动弹窗**（复用
`extension-tool-panel` 窗口机制），同时在桌宠弹窗搜索"翻译"时展示**两个结果**：

1. **主应用翻译** — 打开主窗口 ActivityBar 的翻译页（run-command `panel.translation`）
2. **弹窗翻译** — 打开独立的浮动翻译弹窗（不切换前台应用，浮在当前应用之上）

## What I already know

* 当前形态：`PetPanelApp.tsx` 有 `'chat' | 'translation' | 'inbox'` 三个 Tab，translation
  Tab 内嵌 `<TranslationPanel embedded />`（`PetPanelApp.tsx:1009`）。
* 搜索现状：`PetPanelSearchResults.tsx` 中 `builtin:translation` 扩展命中经
  `onActivateBuiltin` 回调切到 panel 内 Tab（`PetPanelApp.tsx:998`）。
* 已存在独立弹窗机制：`extension-tool-panel` 静态窗口（tauri.conf.json，NSPanel 化，
  可跨 Space 浮动）+ `ExtensionToolApp.tsx` 宿主（拖拽/置顶/放大/关闭/Esc/blur 自动
  隐藏，全部齐备）+ Rust `open_extension_tool_window` / `hide_extension_tool_window` /
  `get_last_extension_tool` / `extension_tool_start_drag` 命令。
* 第三方扩展工具的打开路径：搜索 → `emitOpenExtensionTool` → `pet://menu-action
  {action:'open-extension-tool'}` → 主窗口 `petHostRouter.ts:185` 查找
  `extension.openTool.<id>.<toolId>` 命令 → Rust 弹窗。
* `builtin:translation` 在 `BUILTIN_PANEL_DEFS`（extensionStore.ts:167）注册为内置面板
  行（nameKey `settings:appearance.panels.translation.label`），非磁盘扩展。
* `panel.translation` 命令已注册（commandRegistry.ts:208，`enabled: appearance()
  .enableTranslationPanel`），run → `nav().setCurrentPage('translation')`。
* 主窗口 ActivityBar：`ActivityBar.tsx:103` 由 `enableTranslationPanel` 门控，点击切到
  翻译页。
* TranslationPanel 依赖（跨窗口 realm 需镜像）：aiConfigStore providers（
  `pet://providers-updated` 广播模式）、translationStore（settings 持久化 slice，经
  `pet://settings-updated` 广播水合 + fs ACL 持久化写入）、`chat_stream`（自定义命令，
  绕过 ACL）、主题（useTheme + settings 广播）、locale（`locale://changed` 监听）。
* 次级窗口初始水合模式：监听 `pet://settings-updated` + 主动 emit
  `pet://settings-request`（主窗口 usePetHostBridge 应答全局广播）。
* `extension-tool.json` capability 目前无 fs 权限（iframe 内容经主窗口 RPC）。原计划
  补 pet-panel 同款 fs 块以支持弹窗内翻译偏好持久化——复核后更正（见 R5/ADR）：
  次级窗口的 `fs:scope-appdata-recursive` 解析为 `$APPDATA/**`，不覆盖
  `~/.folyn/storage`，直写本就被 ACL 拒绝；持久化走 `pet://settings-updated`
  广播 + 主窗口退出 flush（与 pet-panel 一致），无需 fs 块。

## Assumptions (temporary)

* 弹窗默认不置顶（与第三方扩展工具一致：点击外部隐藏、Pin 保持），可拖拽、可放大、
  Esc 关闭。
* 弹窗复用 `extension-tool-panel` 单例窗口（默认 800×600，记住上次位置）。
* 桌宠弹窗 Tab 移除翻译后只剩 chat + inbox。
* `enableTranslationPanel=false` 时两个搜索结果都不显示。

## Open Questions

*(none — design decision confirmed by user, see ADR below)*

## Decision (ADR-lite)

**Context**: 翻译弹窗可以复用现有 extension-tool-panel 窗口机制，也可以新建专用静态窗口。
**Decision**: 复用 `extension-tool-panel`（用户已确认 2026-09-18）。`ExtensionToolApp`
在 payload.extensionId === 'builtin:translation' 时渲染内置 `TranslationPanel`，
其余扩展保持 iframe 不变。
**Consequences**:
* 零新增窗口/Rust 命令，全套拖拽/置顶/关闭/Esc/blur 机制直接复用。
* ExtensionToolApp 增加 builtin 内容分支 + ~100 行 realm 接线（新文件
  `TranslationToolHost.tsx`，模式全部来自 PetPanelApp 已验证的镜像）。
* `extension-tool.json` capability 仅加 `opener:default`（外链）；不加 fs 权限——
  次级窗口直写本就被 scope 拒绝（`$APPDATA/**` 不覆盖 `~/.folyn/storage`），持久化
  走 `pet://settings-updated` 广播 + 主窗口退出 flush（与 pet-panel 一致）。

## Requirements (evolving)

* R1: `PetPanelApp` 移除 translation Tab（类型、按钮、渲染分支、import）。
* R2: 搜索结果中 `builtin:translation` 不再切 Tab；改为两条结果（弹窗在前、主应用
  在后，用户新增要求 2026-09-19）：
  * "翻译（弹窗）" → `emitOpenExtensionTool('builtin:translation')`（主窗口特殊路由）
  * "翻译（主应用）" → `emitRunCommand('panel.translation')`（主窗口切页 + 聚焦）
  * 两条结果带 i18n 标签（pet.json，zh/en/ja/de/es/fr）与翻译图标，按
    `enableTranslationPanel` 门控。
* R3: `ExtensionToolApp` 在 payload.extensionId === 'builtin:translation' 时渲染
  `<TranslationToolHost />`（内嵌 TranslationPanel + realm 镜像接线）而非 iframe。
* R4: `petHostRouter` `open-extension-tool` 分支对 `builtin:translation` 直接 invoke
  `open_extension_tool_window`（builtin payload），不再查找 `extension.openTool.*` 命令。
* R5: `extension-tool.json` capability 增加 `opener:default`（外部链接）；不加 fs
  权限——次级窗口的直写本就被 scope 拒绝，持久化走 `pet://settings-updated` 广播 +
  主窗口退出 flush（与 pet-panel 一致）。
* R6: 移除 `onActivateBuiltin` prop 及 pet-panel 侧特殊分支（无其他内置面板使用）。
* R7: 移除 `pet:tabs.translation` i18n key（所有 locale）；新增
  `pet:search.translationMain` / `pet:search.translationPopup`。
* R8: 弹窗翻译与主应用一致：原文/译文左右双栏（flex-row + border-r），
  不再用窄面板时代的上下堆叠布局（pet-panel Tab 已移除，embedded 布局仅服务弹窗）。
  （用户新增要求 2026-09-19）

## Acceptance Criteria (evolving)

* [x] 桌宠弹窗无"翻译"Tab，仅剩"对话 / 收件箱"。（PetPanelApp.test.tsx：2 tabs + 切 Inbox/Chat 回切用例）
* [x] 桌宠弹窗搜索"翻译"出现两条结果：弹窗翻译在前、主应用翻译在后（弹窗在前，
  用户新增要求 2026-09-19）。（PetPanelApp.test.tsx：exactly-two-rows 用例）
* [x] 选"主应用翻译"：主窗口激活并切到翻译页。（emit run-command panel.translation → commandRegistry 既有命令；focusMain 既有路径）
* [ ] 选"弹窗翻译"：浮动弹窗出现（不切换前台应用），内含完整 TranslationPanel，
  可翻译（模型选择可用）、语言/输入/结果状态持久化。（实现完成；需真实 Tauri 环境手动验收）
* [x] 弹窗支持拖拽、置顶 Pin、放大/还原、Esc 关闭、点击外部自动隐藏（未 Pin 时）。（零代码改动，复用 ExtensionToolApp 既有机制）
* [x] 弹窗内翻译为左右双栏（与主应用翻译页一致：输入左、译文右，中间 border-r 分隔）。（TranslationPanel 两栏容器改为无条件 flex-row + border-r；embedded 保留但仅驱动紧凑 chrome）
* [x] `enableTranslationPanel=false` 时搜索不显示这两条结果。（PetPanelApp.test.tsx：gating 用例）
* [x] 相关测试更新（PetPanelApp.test.tsx / petHostRouter.test.ts）且通过。（26 + 20 用例全绿）

## Definition of Done (team quality bar)

* Tests added/updated (PetPanelApp.test.tsx / PetPanelSearchResults 相关)
* Lint / typecheck 绿（仅目标文件级检查，按项目规则不跑全量构建）
* 行为变化在 PRD/spec 中记录

## Out of Scope (explicit)

* 不把翻译做成磁盘扩展包（保持内置 React 组件形态）。
* 不新增专用 Rust 窗口/命令（复用 extension-tool-panel 全套机制）。
* 不改主窗口 ActivityBar 翻译页行为。
* 不做弹窗位置记忆增强（沿用 extension-tool-panel 现状）。

## Technical Notes

* 关键文件：
  * `apps/desktop/src/components/pet/PetPanelApp.tsx`（去 Tab）
  * `apps/desktop/src/components/pet/PetPanelSearchResults.tsx`（双结果 + 路由）
  * `apps/desktop/src/components/pet/ExtensionToolApp.tsx`（builtin 分支）
  * `apps/desktop/src/components/translation/TranslationToolHost.tsx`（新建：realm 接线）
  * `apps/desktop/src/services/petHostRouter.ts`（builtin 路由）
  * `apps/desktop/src-tauri/capabilities/extension-tool.json`（opener:default，无 fs 权限）
  * `apps/desktop/src/i18n/locales/{zh,en,ja,de,es,fr}/pet.json`（i18n）
* realm 接线清单（TranslationToolHost）：providers 镜像（listen + request）、
  settings-updated 水合 + settings-request、useTheme()、locale://changed、
  useDisableAutoCapitalize、installExternalLinkInterceptor、markSettingsHydrated。
* 弹窗内容获得键盘输入的前提：`surface_extension_tool_panel` 使 panel key 并温和激活
  Folyn（现有机制，与第三方工具一致）。
