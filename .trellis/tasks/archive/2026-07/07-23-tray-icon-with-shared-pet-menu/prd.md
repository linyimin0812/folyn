# Tray icon with shared pet menu

## Goal

在「外观设置」页加一个「显示托盘图标」开关。开启后，系统托盘出现应用图标；点击该图标弹出与桌宠右键菜单共用的同一套菜单（显示主窗口 / 隐藏桌宠图标 / 桌宠大小 / 桌宠透明度 / 桌宠穿透 toggle / 退出应用）。复用现有 `pet://menu-action` 事件链路，零新增路由代码。

## What I already know

- `PetContextMenu.tsx` 定义了 6 个原生菜单项的 action 契约：`show-main` / `hide-pet` / `set-pet-size` / `set-pet-opacity` / `toggle-pet-click-through` / `exit-app`。
- Rust 侧 `pet_show_context_menu` (`pet_commands.rs:822`) 在 `pet` 窗口上 `popup_menu_at` 一个原生 `Menu`，所有 item id 是 `PET_CTX_MENU_*` 常量。
- `lib.rs::on_menu_event` 已经把 `PET_CTX_MENU_*` id 映射到 `pet://menu-action` 事件 payload；主窗口的 `routePetMenuAction`（`services/petHostRouter.ts`）路由所有 action。
- 桌宠右键菜单里还有第 7 项 `test-bubble`（测试气泡通知），用户的需求列表里没有它 → 托盘菜单里不放。
- Tauri 2 的 `TrayIconBuilder` 是 `tauri` core 内置能力，Cargo.toml 无需新依赖。
- 外观设置 tab 的 toggle 行模式：`appearanceStore` + `Toggle` primitive + `schedulePersist` 持久化（参考 `showStatusBar`）。
- macOS 主窗口关闭时 `lib.rs::on_window_event` 检查 `pet.is_visible()`：pet 开 → 隐藏主窗口；pet 关 → 默认退出。托盘开启时应一并阻止退出（托盘成为持久入口）。

## Assumptions (temporary)

- 托盘图标用 app 内置 icon（`default_window_icon`），不引入新资源。
- 左键单击托盘图标 = 弹出菜单（用户已指定「点击应用图标显示菜单栏」）。
- 托盘菜单与桌宠右键菜单 **共用同一个 builder**，仅去掉 `test-bubble` 项（重构 `pet_show_context_menu` 的 item 构造为 `build_pet_context_menu(&app, locale, include_test_bubble)`，返回 `Menu`）。
- 开关状态经 `appearanceStore` 持久化；启动时 hydrate，按值决定是否创建托盘。
- 托盘开启 + 主窗口关闭 → 隐藏主窗口，不退出（与 pet 开的行为对齐）。
- 托盘开启 + pet 关 → 托盘菜单的「隐藏桌宠图标」项切换为「显示桌宠图标」语义？留待 v1 先做最小：菜单文案不变，hide-pet 行为 = 隐藏 pet 窗口；如果 pet 已隐藏，hide-pet 由前端路由成 noop（前端已处理 `v === petModeEnabled` 短路）。

## Open Questions

- (resolved) 托盘开启 + 主窗口关闭：**照常退出 app**（保持 `on_window_event` 现状不动）。托盘仅在 app 运行期间作为持久入口，app 退出后托盘自然消失。

## Requirements (evolving)

- 外观设置页新增「显示托盘图标」Toggle，持久化。
- Rust 侧新增 `tray_set_enabled(enabled: bool, locale: String)` 命令：
  - `enabled=true` → 若托盘不存在则 `TrayIconBuilder::new().icon(default_window_icon).menu(&build_pet_context_menu(...)).on_tray_icon_event(popup).build()`。
  - `enabled=false` → `app.tray_by_id("folyn-tray").map(|t| t.destroy())`。
- `build_pet_context_menu(&app, locale, include_test_bubble: bool) -> Result<Menu, AppError>`：抽自 `pet_show_context_menu`，托盘与右键菜单共用。
- 启动 `setup` 时读持久化值（由前端 hydrate 后调用 `tray_set_enabled`），不在 Rust 侧读配置文件。
- `on_window_event` 主窗口关闭拦截条件追加：托盘存在时也 `prevent_close + hide`。~~取消~~（用户决定保持现状：托盘开启时关主窗口仍退出 app，不动 `on_window_event`。）
- 托盘点击 → `on_tray_icon_event` 中 `TrayIconEvent::Click` 调 `tray.show_menu()`（macOS 上 Tauri 2 的 tray menu 默认左键即弹出，需验证）。

## Acceptance Criteria (evolving)

- [ ] 开启开关 → 托盘出现图标
- [ ] 关闭开关 → 托盘图标消失
- [ ] 点击托盘图标 → 弹出菜单（6 项，无 test-bubble）
- [ ] 菜单项触发后行为与桌宠右键菜单完全一致（共用 `pet://menu-action`）
- [ ] 重启应用后开关状态保留
- [ ] 托盘开启且主窗口关闭按钮 → app 退出（保持现状，托盘随之消失）

## Definition of Done

- Rust 编译通过，`cargo clippy` 无新 warning
- 前端 `pnpm typecheck` 通过
- PetContextMenu contract test 仍通过（action 集合未变）
- 手测：开关、菜单项、重启后状态

## Out of Scope (explicit)

- 托盘图标自定义/换图标
- 托盘气泡通知（unread badge 等）
- Windows / Linux 托盘（当前 pet 是 macOS-only，托盘 v1 也 macOS-only）
- 双击托盘切换主窗口显示/隐藏
- 右键托盘菜单（左键已弹菜单，无需区分）

## Technical Notes

- 复用 `PET_CTX_MENU_*` 常量 + `on_menu_event` 路由：托盘菜单 item id 与桌宠菜单相同 → 不改 `lib.rs` 的 `pet_ctx_menu_action` / `pet_ctx_menu_size_level` / `pet_ctx_menu_opacity_level`。
- `TrayIconBuilder` 见 tauri 2 core API（`tauri::tray::TrayIconBuilder`）。
- `on_tray_icon_event` 闭包内 `match event { TrayIconEvent::Click { button: MouseButton::Left, .. } => { let _ = app.tray_by_id("folyn-tray").map(|t| t.show_menu()); } _ => {} }`。
- 主窗口关闭拦截：~~`lib.rs:523-540` 的 `on_window_event` 块加一个 `app.tray_by_id("folyn-tray").is_some()` 条件。~~ 不动（用户选保持现状）。
