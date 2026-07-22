# Fix: pet_set_always_on_top main-thread crash

## Goal

`pet_set_always_on_top` 命令在 async 线程直接调用 `to_panel()` / `panel.set_level()` / `panel.set_collection_behavior()`，违反 AppKit 主线程约束，应用启动即闪退（"Must only be used from the main thread"）。修复为通过 `app.run_on_main_thread` 调度。

## Root cause

`#[tauri::command] async fn` 默认在异步 runtime 线程执行；AppKit NSPanel API 必须在主线程调用。同文件 `pet_set_topmost_level` 用 `app.run_on_main_thread(move || { ... })` 是正确范式，新命令漏抄。

## Requirements

- `pet_set_always_on_top` 的 `to_panel` + `set_level` + `set_collection_behavior` 全部移入 `app.run_on_main_thread` 闭包。
- 闭包内失败用 `return` 静默跳过（与现有 `pet_set_topmost_level` 行为一致——错误非致命，下次 poll/flag-change 会重试）。
- 非 macOS / 非 NSPanel 后端提前返回不变。
- 不动 lib.rs 注册、不动 PetApp / PetSettings / petStore。

## Acceptance Criteria

- [ ] `pnpm tauri dev` 启动不闪退。
- [ ] 切换"始终置顶"Toggle 不闪退；行为符合 PRD（开 = 浮于其他应用，关 = 被前台应用遮挡）。
- [ ] `cargo check` 通过。

## Out of Scope

- 其他 AppKit 调用的线程性审计——只修这条命令。
- 命令的单元测试——Tauri 命令难单测，验证靠手动启动。
