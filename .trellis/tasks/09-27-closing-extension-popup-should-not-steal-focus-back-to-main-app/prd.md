# Closing extension popup should not steal focus back to main app

## Goal

用户报告：关闭扩展工具弹窗（extension-tool-panel）后会"跳转回 Folyn 应用"——Folyn 主窗口抢到前台，盖住用户原本工作的应用。期望关闭后焦点留在用户的应用。

## What I already know（代码勘察）

* 弹窗 = `extension-tool-panel`（NSPanel，非激活面板，tauri.conf 静态声明，启动时转换）。
* 关闭路径：`ExtensionToolApp.close()` / `toolWindowStore.close` → Rust `hide_extension_tool_window`（webview_commands.rs:725）。
* 该命令已有防跳转设计：
  - 打开时 `capture_frontmost_pid()` 存 pid（Folyn 前台时返回 None 不覆盖）
  - 宠物面板路径经 `extension_tool_adopt_frontmost` 继承 `PreviousFrontmostApp` 的 pid
  - hide 时：若弹窗全屏 → 特殊处理；否则 `w.hide()`；随后若 Folyn 仍前台（capture None）且存有 pid → 150ms 后 `restore_frontmost_app(pid)`（`activateWithOptions:0` 礼貌激活）
* 打开路径有多条：
  - 宠物面板搜索/chips：`emitOpenExtensionTool`（有 adopt）+ `emitRunCommand('extension.openTool.*')`（仅 `extension_tool_match_pet_panel`，无 adopt）
  - 主窗口 commandRegistry `extension.openTool.*`（commandRegistry.ts:262，无 adopt —— Folyn 本就前台，符合预期）
  - petHostRouter `open-extension-tool`（builtin translation 直调）
* `restore_frontmost_app` 用 `activateWithOptions:0`（礼貌激活，系统可能拒绝）；宠物面板 hide 用同一原语。

## Assumptions (temporary)

* 失效点候选：① 某条打开路径没存 pid（adopt 缺失）；② 礼貌激活被系统拒绝（时机/race）；③ 打开时 Folyn 前台 → 无 pid → 关闭时 Folyn 主窗口升起且无还原。

## 用户确认的复现条件

* 打开路径：宠物面板
* 关闭方式：× 按钮 → 跳回 Folyn；**Esc 关闭正常**
* 关键矛盾：× 与 Esc 前端调用同一个 `close()` → `hide_extension_tool_window`，差异只能来自鼠标 vs 键盘事件引发的 AppKit 状态差异（点击 WKWebView 可能激活应用/改变 key window 解析），或 restore 时机竞态

## 历史背景

* 本 bug 2026-09-22 已修过（commit 948cb939，任务 09-22-extension-popup-close-focuses-folyn-app）：打开时捕获 frontmost pid + 宠物面板路径 adopt + hide 后 150ms `activateWithOptions:0` 礼貌激活还原
* 现在症状复现 = 修复不完整或回归

## Open Questions

* × 路径下：pid 是否存在？hide 时 frontmost 是谁？restore 是否被跳过/被系统拒绝？——需运行时数据

## Requirements (evolving)

* × 关闭与 Esc 关闭行为一致：Folyn 主窗口不得升起盖住用户工作区
* 需要运行时诊断数据定位失效点（打印 capture/adopt/hide/restore 各环节的 pid 与 frontmost 状态）

## Acceptance Criteria (evolving)

* [x] 搜索行路径：关闭弹窗 Folyn 不跳前台（用户已验证）
* [x] 激活被拒兜底：restore_frontmost_app 礼貌激活失败时强激活
* [x] `tsc -b` / `cargo check` / `cargo test` 231/231 / PetPanelApp 测试 40/40 通过
* [ ] chips（最近使用）路径：修复后出现过一次偶发跳转，重启后正常 —— 观察期 1-2 天，复现则抓 [ext-tool-diag] 日志；稳定后摘除诊断日志

## 遗留事项（观察期后处理）

* 摘除 pet_panel.rs / webview_commands.rs 的 [ext-tool-diag] eprintln 诊断日志（commit c573629c 有意保留）

## Out of Scope

* Windows 侧行为（本 bug 表述为 macOS 焦点语义）

## Technical Notes

* 关键文件：webview_commands.rs（open/hide/adopt）、pet_panel.rs（capture/restore）、PetPanelSearchResults.tsx、petHostRouter.ts、commandRegistry.ts、ExtensionToolApp.tsx
