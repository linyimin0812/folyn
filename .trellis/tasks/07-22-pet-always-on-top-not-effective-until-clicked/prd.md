# Fix: pet always-on-top not effective until clicked

## Goal

"始终置顶" 开关打开后，切换到其他应用（如 VS Code）前台时，桌宠图标并未浮于其上——需要先点击桌宠一次才会浮起。期望：开关打开即生效，无需点击。参考 `/Users/yiminlin/project/BongoCat` 的 NSPanel 实现。

## What I already know

- 当前 `pet_set_always_on_top(true)` 通过 `app.run_on_main_thread` 在主线程调用 `to_panel()` + `set_level(Dock)` + `set_collection_behavior(stationary | can_join_all_spaces | full_screen_auxiliary)`（=273）。
- `convert_windows` 启动时也设置过同样的级别 + behavior。
- `pet_set_topmost_level` 在 NSPanel 后端是 no-op（提前返回）。
- 用户报告：开关打开 + 切到其他应用前台 → 桌宠不浮起；点击桌宠 → 浮起。
- BongoCat 的 NSPanel 配置在 `/Users/yiminlin/project/BongoCat`（具体路径需调研，可能在 `src-tauri/src/core/setup/macos.rs` 或类似位置——`pet_panel_macos.rs` 的注释里提到 "BongoCat `src-tauri/src/core/setup/macos.rs:33-49`"）。

## Open Questions

- BongoCat 是否在 `show()` 之后、`orderFrontRegardless`、或在某个通知回调里额外 `set_level` / `set_collection_behavior`？
- 是否需要在 app 失活/前台切换时 re-assert 级别（类似 legacy 后端的 blur listener）？
- "点击桌宠才浮起" 是否因为 NSPanel 在首次 show 时未真正进入 fullscreen-auxiliary 层级——BongoCat 的 show 顺序是否不同？

## Requirements

- 切换到其他应用前台时桌宠立即浮于其上，无需点击。
- 开关关闭时桌宠被前台应用遮挡（保持当前预期）。
- 不引入主线程违规（保持 `run_on_main_thread` 范式）。

## Acceptance Criteria

- [ ] 开关打开 → 切到 VS Code（非全屏）前台 → 桌宠仍可见且浮于 VS Code 之上。
- [ ] 开关打开 → VS Code 全屏 → 桌宠浮于其上（fullscreen-auxiliary 行为）。
- [ ] 开关关闭 → 切到 VS Code → 桌宠被遮挡。
- [ ] 不闪退；`cargo check` 通过。

## Out of Scope

- pet-panel / pet-bubble / voice-orb 的置顶行为。
- 非 macOS 平台。
- legacy 后端（`MOCHI_PET_PANEL_BACKEND=legacy`）。

## Technical Notes

- 关键文件：
  - `apps/desktop/src-tauri/src/commands/pet_commands.rs` — `pet_set_always_on_top`
  - `apps/desktop/src-tauri/src/pet_panel_macos.rs` — `convert_windows` + `MochiPetPanel` 定义
- BongoCat 参考：`/Users/yiminlin/project/BongoCat`，重点找 `src-tauri/src/` 下的 NSPanel 配置 / show 逻辑。
