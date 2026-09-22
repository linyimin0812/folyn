# Extension popup close focuses Folyn app

## Goal

关闭 extension-tool 弹窗（×、Esc、失焦自动隐藏）后，焦点不应跳回 Folyn 应用；应恢复用户关闭前所在的应用。

## What I already know

* 弹窗是 `ExtensionToolApp` 托管的 Tauri NSPanel（`extension-tool-panel`）。
* 打开路径 `open_extension_tool_window` → `surface_extension_tool_panel`（`pet_panel_macos.rs:335`）执行 `makeKeyWindow` + `NSApp activate`，激活了整个 Folyn 应用。
* 关闭路径：前端 `close()`（`ExtensionToolApp.tsx:181-185`）→ `hide_extension_tool_window`（`webview_commands.rs:687`）→ `w.hide()`（:713）→ tao 的 `orderOut:`。
* Folyn 处于 active 状态且 panel 是 key window；orderOut 后 AppKit 把 key 交给下一个窗口 = Folyn 主窗口，主窗口被抬到最前，覆盖用户当前工作 → "跳转回 folyn"。
* 三条关闭路径（× / Esc / blur）都走同一个 `hide_extension_tool_window` 命令，单点修复即可覆盖。
* 相关注释：`webview_commands.rs:639-644`（Windows 侧刻意避开 set_focus，同一 bug 家族）、`pet_panel_macos.rs:202-211`（prewarm 只解决首窗激活跳转）。

## Requirements

* 关闭/隐藏 extension tool panel 时，不把 Folyn 主窗口顶到前台。
* 焦点应交还给打开弹窗前的应用（macOS 前一个 frontmost app）。

## Acceptance Criteria

* [ ] 在其他应用（如浏览器）中使用 Folyn 弹窗，点 × 关闭后，前台仍是浏览器，Folyn 主窗口不被抬起。
* [ ] Esc 关闭同上。
* [ ] 失焦自动隐藏同上。
* [ ] pet/无主窗口模式下关闭后行为不回退（不出现跳转或空 active 状态卡住）。

## Out of Scope

* Windows / Linux 路径（无此 bug，Windows 已刻意避开 set_focus）。
* 打开时的激活行为（打开时弹窗成为 key window 是预期）。

## Decision (ADR-lite)

**Context**: 第一版只在 open 时捕获 frontmost pid。实测仍跳转 —— 所有弹窗打开路径都经 pet panel，而 `pet_panel_show` 的 `set_focus` 早已激活 Folyn，open 时捕获到 None，state 永远为空。
**Decision**: 复用 pet-panel 机制 + 新增 `extension_tool_adopt_frontmost` 命令：pet panel 前端在两个 tool 打开点（`emitOpenExtensionTool`、inbox command 分支）调用它，把 `PreviousFrontmostApp`（pet_panel_show 激活前捕获）的 pid 过继给 `ExtensionToolFrontmostApp`；hide 时 take 消费该 pid，Folyn 仍前台则 150ms 延迟恢复原应用。
**Consequences**: 非 pet-panel 打开（主窗口 palette）不过继、不恢复（用户本就在 Folyn，主窗口抬升即预期）；失焦自动隐藏不恢复（用户已切换应用）；pid 每次 hide 都被消费，无陈旧恢复风险。

## Technical Notes

* 候选方案（打开时记录/关闭时让出激活）：
  * A：hide 前记录 `NSWorkspace.frontmostApplication`（在 surface 时存储），hide 时 `yieldActivationToApplication:` / `activate` 回去；再 orderOut。
  * B：hide 时直接 `NSApp deactivate`（让系统自行恢复前一应用），再 orderOut。更简单但依赖 AppKit 行为。
* 关键文件：`apps/desktop/src-tauri/src/commands/webview_commands.rs`、`apps/desktop/src-tauri/src/pet_panel_macos.rs`、`apps/desktop/src/components/pet/ExtensionToolApp.tsx`。
