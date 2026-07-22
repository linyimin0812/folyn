# Pet Panel Empty Box Shown on Startup after NSPanel Convert

## Goal

App 启动时 `pet-panel` 窗口（440×620）以空白框形式自动显示，用户没点击桌宠也没按快捷键。需要堵住这个自动显示路径，让面板只在用户主动点击桌宠 / 全局快捷键 / bubble 跳转时才打开。

## Root Cause (Hypothesis, 2026-07-22)

Commit `be29a8c`（2026-07-22 15:13）把 `convert_windows` 从异步 `run_on_main_thread` 改成在 `.setup()` 里同步执行。同步执行时 `to_panel()` 类替换发生在 Tauri 应用 `visible:false` 之前/同时，NSPanel 转换的副作用可能让 `pet-panel` 窗口落盘成默认可见状态——webview 还没加载 React 内容，用户看到的就是一个 440×620 的空白框。

`pet`、`pet-bubble`、`voice-orb` 没有这个问题：它们要么由 `toggle_pet_mode` 显式 `show()`，要么没有同步转换触发的可见状态。只有 `pet-panel` 暴露症状。

## Requirements

- 启动时 `pet-panel` 窗口必须保持隐藏（`visible:false` 兜底生效）。
- 不破坏 `be29a8c` 修复的 "always-on-top 不点不生效"——同步 `convert_windows` 必须保留。
- 不影响用户主动打开面板的三条路径：点击桌宠、全局快捷键 ⌘⇧Q、点击 bubble 跳 chat。

## Acceptance Criteria

- [ ] 冷启动应用，不点击桌宠、不按快捷键，屏幕上不出现 440×620 空白框。
- [ ] 点击桌宠图标，面板正常打开（带内容 + fade-in）。
- [ ] ⌘⇧Q 全局快捷键，面板正常打开（居中）。
- [ ] 点击 bubble 的 "查看详情" 跳 chat，面板正常打开。
- [ ] `cargo check` + 前端 typecheck + 既有 pet/pet-panel 测试绿。

## Technical Approach

在 `apps/desktop/src-tauri/src/pet_panel_macos.rs::convert_windows` 的 `pet-panel` 转换块末尾，显式调用 `window.hide()`（Tauri `WebviewWindow::hide`，对应 NSWindow `orderOut`）。这兜住任何由 `to_panel()` 类替换引发的可见状态，不动同步转换逻辑（保留 `be29a8c` 的修复），不影响后续 `pet_panel_show`（`panel.show()` = `orderFrontRegardless` 会重新显示）。

不采用方案 B（改回异步 `run_on_main_thread`）：会重新引入 `be29a8c` 修复的 "always-on-top 不点不生效" bug。

## Out of Scope

- 用户主动打开面板后 webview 加载慢导致短暂空白：不在启动路径，不修。
- `pet` / `pet-bubble` / `voice-orb` 窗口的同步转换副作用：目前无症状，不预防性加 hide。
- 加 `pet://panel-fade-in` 或 React 端的 mount-time hide：root cause 在 Rust 端同步转换，前端兜底是 bandaid，不治本。

## Technical Notes

- `apps/desktop/src-tauri/src/pet_panel_macos.rs:160-174` — `pet-panel` 转换块。
- `apps/desktop/src-tauri/src/commands/pet_commands.rs:561-605` — `pet_panel_show`，用 `panel.show()` = `orderFrontRegardless`，会在 hide() 之后正确重新显示。
- `.trellis/spec/desktop/frontend/tauri-window-patterns.md` — pet-panel 窗口契约（show/hide/position 命令、`visible:false` conf）。
