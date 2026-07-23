# Refactor pet_commands split modules

## Goal

`apps/desktop/src-tauri/src/commands/pet_commands.rs` 已 1908 行，混杂了 pet 窗口控制、托盘菜单、pet 浮窗、气泡、平台特定 stub、状态、常量、i18n 标签。按职责拆分为多个文件，降低单文件复杂度、便于后续维护与定位。

## What I already know

文件现状（grep 出的结构）：
- 4 个 managed state: `PetSizeState`、`PetOpacityState`、`PetClickThroughState`、`TrayHidePetItemState`、`PetShortcutState`
- 常量: `PET_LABEL`、`PET_CTX_MENU_*`、`TRAY_ID`、`PET_PANEL_LABEL`、`PET_BUBBLE_LABEL`
- i18n: `PetMenuLabel` enum + `pet_menu_label`、`AppMenuLabel` + `app_menu_label`
- 菜单 builder: `build_app_menu`、`build_pet_context_menu`、`pet_show_context_menu`、`pet_rebuild_app_menu`、`tray_set_enabled`
- Pet 窗口命令: `set_pet_size`、`set_pet_opacity`、`set_pet_click_through`、`exit_app`、`toggle_pet_mode`、`show_pet_if_hidden`、`set_pet_position`、`get_pet_position`、`pet_cursor_probe`、`pet_get_work_area`、`pet_set_cursor`
- Pet panel 命令: `pet_panel_show/hide/set_shortcut/set_position/get_position/set_size/get_size/is_visible`
- Pet bubble 命令: `pet_bubble_show/hide/set_position`
- 平台特定（带 stub 重复）: `pet_set_topmost_level`（mac 1614 / 非 mac 1720）、`pet_make_transparent`（mac 1761 / 非 mac 1851）
- helpers: `pet_size_to_px`、`current_pet_size_level`、`pet_opacity_to_alpha`、`nspanel_target_appkit_origin`、`pet_cursor_pos_relative`
- structs: `PetPosition`、`PetCursorProbe`、`PetWorkArea`、`PetPanelSize`
- `mod tests` 在末尾

## Assumptions (temporary)

- 目标是**物理拆分**，不改行为、不改公共 API（`pub use *` 在 mod.rs 保证外部调用不变）。
- 拆分粒度按当前自然边界，不引入新抽象、不合并相似命令。
- 保留平台特定 stub 的 `#[cfg(target_os)]` 切分方式。

## Open Questions

- (resolved)

## Requirements

- `pet_commands.rs` 不再 >500 行单文件
- 公共 API（被 `mod.rs` re-export 的符号）保持不变
- 行为保持等价，不引入 lint/build/test 回归

## Acceptance Criteria

- [ ] `cargo check` 通过
- [ ] `cargo clippy` 不新增 warning
- [ ] `cargo test` 通过
- [ ] mod.rs 的 `pub use *` 不变，前端 invoke 调用名不变

## Definition of Done

- 拆分完成，build/test/clippy 绿
- PRD 与实现一致

## Out of Scope

- 不改命令行为、不删命令、不合并命令
- 不引入新 trait/接口抽象
- 不改 i18n 文案

## Technical Approach

拆分方案（用户已确认）：

```
commands/
├── mod.rs              (不变: pub use pet_commands::* 等)
├── pet_commands.rs    (聚合 re-export + core pet 窗口命令)
├── pet_menu.rs         (菜单/tray builder + 相关 state)
├── pet_panel.rs        (panel 命令 + PetShortcutState)
├── pet_bubble.rs       (bubble 命令)
└── pet_common.rs       (共享 state/consts/labels/helpers/structs/tests)
```

**pet_common.rs** 放：
- 共享 state: `PetSizeState`, `PetOpacityState`, `PetClickThroughState`
- 共享 structs: `PetPosition`, `PetCursorProbe`, `PetWorkArea`, `PetPanelSize`
- 所有常量: `PET_LABEL`, `PET_CTX_MENU_*`, `TRAY_ID`, `PET_PANEL_LABEL`, `PET_BUBBLE_LABEL`
- i18n: `PetMenuLabel`/`pet_menu_label`, `AppMenuLabel`/`app_menu_label`
- helpers: `pet_size_to_px`, `current_pet_size_level`, `pet_opacity_to_alpha`, `nspanel_target_appkit_origin`, `pet_cursor_pos_relative`
- `mod tests`（i18n label 覆盖测试）

**pet_menu.rs** 放：
- `build_app_menu`, `build_pet_context_menu`, `pet_show_context_menu`, `pet_rebuild_app_menu`, `tray_set_enabled`
- `TrayHidePetItemState`

**pet_panel.rs** 放：
- `pet_panel_show/hide/set_shortcut/set_position/get_position/set_size/get_size/is_visible`
- `PetShortcutState`

**pet_bubble.rs** 放：
- `pet_bubble_show/hide/set_position`

**pet_commands.rs** 保留：
- `pub use pet_common::*; pub use pet_menu::*; pub use pet_panel::*; pub use pet_bubble::*;` 聚合 re-export
- core pet 窗口命令: `set_pet_size`, `set_pet_opacity`, `set_pet_click_through`, `exit_app`, `toggle_pet_mode`, `show_pet_if_hidden`, `set_pet_position`, `get_pet_position`, `pet_cursor_probe`, `pet_get_work_area`, `pet_set_cursor`, `pet_set_topmost_level`（mac + 非 mac stub）, `pet_make_transparent`（mac + 非 mac stub）

**实施策略**：纯机械移动 + 调整 `use` 导入。每个子文件 `use crate::commands::pet_common::*` 或显式引用。保持 `pub` 可见性，因 `mod.rs` 用 `pub use pet_commands::*`。

## Technical Notes

- 文件: `apps/desktop/src-tauri/src/commands/pet_commands.rs:1-1908`
- mod.rs: `apps/desktop/src-tauri/src/commands/mod.rs`，`pub use pet_commands::*`
- 平台分支通过 `#[cfg(target_os = "macos")]` 与 `#[cfg(not(target_os = "macos"))]` 区分
- 测试在 `pet_commands.rs:1859-1908`，测 i18n label 覆盖
