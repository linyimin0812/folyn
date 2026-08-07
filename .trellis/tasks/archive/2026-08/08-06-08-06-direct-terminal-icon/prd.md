# 移除 + 菜单，改为直接显示 Terminal 图标

## Goal

Topbar 当前的 `+` 按钮会弹出原生菜单（New Terminal / New Browser）。用户希望移除
`+`、New Browser 和 New Terminal 入口，直接显示 Terminal 图标，点击后进入终端。

## Requirements

- Topbar 不再渲染 `+` 按钮，也不再调用 `topbar_plus_menu` 原生菜单。
- Terminal 图标始终显示在 Topbar 中（不再要求已存在 terminal session）。
- 无 terminal session 时点击 Terminal 图标：创建一个 session 并展开终端面板。
- 已有 session 时点击 Terminal 图标：保留现有收起/展开行为。
- 移除 Rust 端 `topbar_plus_menu` 命令、`topbar-new-terminal` / `topbar-new-browser`
  事件转发，以及前端 `app://new-terminal` / `app://new-browser` 监听。
- 移除不再使用的 `topbar:plus.*` i18n 文案。

## Acceptance Criteria

- [ ] Topbar 中看不到 `+` 图标和 New Browser / New Terminal 菜单。
- [ ] Terminal 图标始终显示，点击无 session 时新建终端并打开面板。
- [ ] 已有终端时点击 Terminal 图标可收起/展开，不额外新建 session。
- [ ] `topbar_plus_menu` / `topbar-new-*` 相关死代码已移除。
- [ ] `topbar.json` zh/en 均不再包含 `plus` 节点。

## Technical Approach

Topbar 的 Terminal 点击 handler 判断 `terminalSessions.length`：为 0 时调用
`addSession()` + `openTerminalDock()`，否则沿用当前 toggle 逻辑。随后删除 `+`
按钮、原生菜单调用与事件监听，并清理 Rust 命令和 i18n keys。

## Out of Scope

- Terminal 面板内部的 `+` 新建 session 按钮不改。
- 浏览器标签页入口（WebViewer 内）不改。
- 文件标签栏下拉面板改动不改。
