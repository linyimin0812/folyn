# Bug: 右键 reload 整个应用崩溃 (SIGTRAP)

## Symptom
- 用户在主窗口右键 reload（devtools / context reload）后整个 app crash。
- Crash report: Thread 21 (tokio-rt-worker) `EXC_BREAKPOINT (SIGTRAP)` at `-[BSServiceMainRunLoopQueue assertBarrierOnQueue]`。
- 栈顶往上：`tray_set_enabled` closure → drop `Option<tauri::tray::TrayIcon>` → `tray_icon::TrayIcon::remove` → `NSStatusBar.removeStatusItem` → `NSSceneStatusItem _uninstall` → `FBSScene sendActions:toExtension:` → `assertBarrierOnQueue` 断言失败。

## Root Cause
`apps/desktop/src-tauri/src/commands/pet_menu.rs:317` 的 `tray_set_enabled` 是 `#[tauri::command] async fn`，跑在 tokio worker 线程上。第 327 行 `app.remove_tray_by_id(TRAY_ID)` drop 旧的 `TrayIcon`，其 Drop 实现调用 `objc2_app_kit::NSStatusBar::removeStatusItem`，该 AppKit API 必须在主线程执行，BoardServices 的 `assertBarrierOnQueue` 断言失败 → SIGTRAP 整个进程被杀。

reload 时前端重新 hydrate localeStore 并再次调用 `tray_set_enabled`，触发该路径。

## Why existing code didn't catch it
- `pet_rebuild_app_menu`（同文件 374 行）正确用 `app.run_on_main_thread` + channel 包裹，因为 `set_menu` 要求主线程。
- `tray_set_enabled` 漏写主线程包裹 —— destroy 和 build 都触及 `NSStatusBar` / `NSStatusItem`，同 `set_menu` 一样要求主线程。
- 启用路径（首次 build）和销毁路径（reload 重建）都违反线程约束；只是首次启用在 reload 之前未触发崩溃，reload 是首次"先销毁再重建"的路径，于是崩在销毁阶段。

## Fix
把 `tray_set_enabled` 整个函数体（destroy + clear state + build + extract check item + build tray）放进 `app.run_on_main_thread` 闭包，结果通过 `mpsc::channel` 传回 async command。完全照搬同文件 `pet_rebuild_app_menu` 的模式，零新增抽象。

## Scope
- 改 `apps/desktop/src-tauri/src/commands/pet_menu.rs::tray_set_enabled`。
- 不动 `build_pet_context_menu` / `build_app_menu` / `pet_rebuild_app_menu`。
- 不引入新依赖、新工具函数。

## Acceptance
- 右键 reload 不再崩溃；tray icon 正确销毁并重建。
- 启用 / 禁用 / locale 切换三个路径都验证一次。
- `cargo check` 通过。
