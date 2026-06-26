# Configurable ActivityBar Features

## Goal

允许用户在设置中启用/禁用 Clips、Daily、Wiki、项目分析四个特性。启用时对应按钮显示在 ActivityBar 中;禁用时隐藏。`files` 为主面板,始终显示。

## What I already know

- `ActivityBar.tsx` 渲染 5 个面板按钮:`files` / `wiki` / `clips` / `analyze` / `calendar`。`files` 始终保留,其余 4 个为可配置项。
- `settingsStore.ts` 已有同类开关先例:`showAiPanel` / `showStatusBar` / `showHiddenFiles`,均为布尔值,通过 `updateSettings` 持久化到 `settings:all`,启动时回读。
- `SettingsPage.tsx` 的 `appearance` Tab 已渲染同类 Toggle 行(`showAiPanel` / `showStatusBar` / `showHiddenFiles`),新增 4 个开关可复用同形态。
- `editorStore.ts` 持有 `activePanel: ActivityPanel`、`setActivePanel(panel)`;`Sidebar.tsx` 根据 `activePanel` 切换 `WikiFileTree` / `ClipsPanel` / `AnalysisPanel` / `CalendarPanel` / 文件树。
- Daily note 另有入口:`App.tsx` 全局快捷键 `⌘D` → `editorStore.openDailyNote()`;`ActivityBar` 中 `calendar` 按钮也会调用 `openDailyNote()`。
- Wiki / Clips / Analyze / Daily 的数据目录 `__wiki__` / `__clips__` / `__reports__` / `__daily__` 已在 `excludePatterns` 默认值中(隐藏在文件树里)。

## Assumptions (temporary)

- 禁用 = 仅 UI 层隐藏,后端目录与已采集数据保留(不删数据、不卸载 store)。
- 默认全部启用(保持当前行为,不打破现有用户)。
- 4 个开关独立,不做"全选/全不选"快捷操作。

## Open Questions

- (resolved) 见 Decision 区。

## Requirements

- 新增 4 个布尔设置:`enableWikiPanel` / `enableClipsPanel` / `enableAnalyzePanel` / `enableDailyPanel`,默认 `true`。
- `ActivityBar.tsx` 根据这 4 个开关条件渲染对应按钮;`files` 与 `settings` 按钮始终保留。
- `SettingsPage.tsx` 外观 Tab 新增 4 个 Toggle 行,文案:"Wiki 面板" / "Clips 面板" / "项目分析面板" / "今日笔记面板",副标题简述用途。放在现有 3 个 Toggle(`showAiPanel`/`showStatusBar`/`showHiddenFiles`)之后,可视为同一组连续行。
- 禁用语义 = 不可用(选项 2):
  - 禁用 `enableDailyPanel` 时,`App.tsx` 中 `⌘D` 快捷键不再触发 `openDailyNote()`(读 settings 判断)。
  - Wiki / Clips / Analyze 无独立外部入口,禁用即等同于隐藏 ActivityBar 按钮 + 不可切换到该面板。
- 若用户禁用时其对应面板正处于 `activePanel`,自动回落到 `files`(在 `App.tsx` 加一个 effect,监听 4 个开关,任一从 true→false 且匹配当前 `activePanel` 时调用 `setActivePanel('files')`)。
- 持久化与回读复用 `settings:all` 现有机制(更新 `debouncedPersist` 字段提取 + 启动回读)。
- 已打开的、属于被禁用特性的 Tab 不主动关闭(保留用户数据);只是无法再通过 ActivityBar 切入,重新启用后恢复。

## Decision (ADR-lite)

**Context**: 禁用某特性时,非 ActivityBar 入口是否一并禁用?Daily 有独立快捷键 `⌘D`,Wiki/Clips/Analyze 无外部入口。

**Decision**: 选项 2 — 连带禁用所有入口。语义统一:"禁用 = 不可用",符合用户心智。具体落地:`App.tsx` 的 `⌘D` 监听内读取 `enableDailyPanel`,为 false 时不调用 `openDailyNote()`。

**Consequences**: 实现上多一处 settings 读取(`App.tsx` 已有 `useSettingsStore` 用法,改动小)。若未来新增其他特性的外部入口(如 Wiki 的快捷键、命令面板),需同样接入对应 enable flag。

## Requirements (evolving)

- 新增 4 个布尔设置:`enableWikiPanel` / `enableClipsPanel` / `enableAnalyzePanel` / `enableDailyPanel`,默认 `true`。
- `ActivityBar.tsx` 根据这 4 个开关条件渲染对应按钮;`files` 与 `settings` 按钮始终保留。
- `SettingsPage.tsx` 外观 Tab 新增 4 个 Toggle 行,文案:"Wiki 面板" / "Clips 面板" / "项目分析面板" / "今日笔记面板",副标题简述用途。
- 若用户禁用时其对应面板正处于 `activePanel`,自动回落到 `files`。
- 持久化与回读复用 `settings:all` 现有机制(更新 `debouncedPersist` 字段提取)。

## Acceptance Criteria

- [ ] 默认安装下,4 个特性全部启用,ActivityBar 行为与现状一致。
- [ ] 在设置中关闭"Wiki 面板"后,ActivityBar 不再显示 Wiki 按钮,且原 Wiki 按钮被选中时会回落到 `files`。
- [ ] 关闭"今日笔记面板"后,`⌘D` 快捷键不再打开今日笔记(无任何反应或仅触发浏览器默认行为)。
- [ ] 关闭后再启用,按钮重新出现,`⌘D` 恢复响应,可正常切换。
- [ ] 重启应用后,4 个开关状态被保留。
- [ ] `files` 与 `settings` 按钮不受任何开关影响。
- [ ] 已打开的 Wiki/Clips/Daily/Analyze Tab 在禁用特性后仍保留在 Tab 列表(不主动关闭)。

## Definition of Done

- 类型 / lint / 既有测试通过。
- 设置页外观 Tab 视觉与同类开关(`showAiPanel` 等)一致。
- 手动验证:关闭某特性时,`activePanel` 回落到 `files`,不出现空面板。

## Out of Scope (explicit)

- 不删除/迁移已存在的 `__wiki__` / `__clips__` / `__daily__` / `__reports__` 目录与数据。
- 不做特性级"卸载"(不卸载 wikiStore、clipStore 等 store)。
- 不引入新设置 Tab;开关放在现有"外观"Tab。
- 不做导入/导出预设。

## Technical Notes

- 关键文件:
  - `apps/desktop/src/store/settingsStore.ts` — 新增 4 字段 + 持久化
  - `apps/desktop/src/components/shell/ActivityBar.tsx` — 条件渲染按钮
  - `apps/desktop/src/components/pages/SettingsPage.tsx` — 外观 Tab 新增 4 个 Toggle
  - `apps/desktop/src/store/editorStore.ts` — 处理 activePanel 回落(可选,见 Open Questions)
- 回落策略:`setActivePanel` 入口在 ActivityBar 点击,若禁用则不会触发;但用户可能在某面板激活时去设置里关掉它,需要监听并回落。
