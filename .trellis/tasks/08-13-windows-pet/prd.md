# Windows Pet Module: Mascot + Tray Icon Display

## Goal

让桌宠 mascot 窗口和系统托盘图标在 Windows 11 上正常显示。覆盖 PRD `08-12-windows` R14 的所有剩余 FOLLOW-UP 项 + 调查托盘图标不显示的根因。

## Parent

`.trellis/tasks/08-12-windows` (R14 pet 模块 Windows 原生重写 — 剩余项)

## Requirements

### R14 pet 模块 Windows 原生重写（剩余命令）

当前已实现：`pet_set_cursor` (LoadCursorW + SetCursor)、`set_pet_opacity` (SetLayeredWindowAttributes LWA_ALPHA + WS_EX_LAYERED)、`pet_get_work_area` (MonitorFromWindow + GetMonitorInfoW rcWork)。

剩余项（`apps/desktop/src-tauri/src/commands/pet_commands.rs`）：

- [ ] `pet_set_topmost_level`（line ~625, Windows stub 在 line ~730）— Windows 实现：`SetWindowPos(HWND_TOPMOST, ...)` 保持置顶。当前 stub 是 no-op。
- [ ] `pet_make_transparent`（line ~771, Windows stub 在 line ~861）— Windows 实现：`SetWindowPos` 加 `WS_EX_LAYERED` + `SetLayeredWindowAttributes(ULW_ALPHA)` 或 `DwmExtendFrameIntoClientArea`。当前 stub 是 no-op。
- [ ] `show_pet_if_hidden`（line ~227）— 非 macOS 分支已用 `pet.show()`，但需验证 Windows 上透明窗口是否实际可见。如果 `transparent: true` 在 Windows 上需要 WS_EX_LAYERED 才渲染 alpha，则在 show 前调用 `pet_make_transparent`。
- [ ] `set_pet_position`（line ~287）— 非 macOS 分支走 Tauri `set_position`。验证多屏（主屏负坐标）行为；Windows 用 `SetWindowPos` 直接定位更稳。
- [ ] `toggle_pet_mode`（line ~153）— 验证 Windows 上切换路径。

### R14 NSPanel 后端 Windows 等价

- [ ] `apps/desktop/src-tauri/src/pet_panel_macos.rs` NSPanel 行为在 Windows 等价：`WS_EX_TOOLWINDOW`（不在任务栏/alt-tab 出现）+ 多屏 Y-flip（Windows 坐标系原点在左上，不需要 flip，但需要 `MonitorFromWindow` 选对屏）。

### 托盘图标不显示调查

- [ ] `apps/desktop/src-tauri/src/commands/pet_menu.rs::tray_set_enabled` 看起来跨平台（`TrayIconBuilder` 是 Tauri 2 跨平台 API），但 Windows 上图标不显示。调查方向：
  - `apps/desktop/src/App.tsx:510` 的 `tray_set_enabled` 调用时机：`useAppearanceStore.showTrayIcon` 默认 false，hydrate 前先 invoke 一次 → 可能传 false，Windows 上 destroy 路径有差异？
  - `tauri::include_image!("icons/tray-icon.png")` 在 Windows 上 PNG 加载是否成功（Tauri 2 用 `image` crate，PNG 跨平台应该 OK，但 RGBA 透明通道在 Windows 任务栏托盘区渲染可能有差异）
  - `show_menu_on_left_click(true)` 在 Windows 上的行为：Windows Tauri 2 默认是左键弹菜单还是需要 `on_tray_icon_event`？
  - Windows 系统托盘区隐藏溢出图标的行为：新装应用默认进溢出区，需要用户手动拖出。这是 Windows 系统行为，不是 bug — 但要确认图标确实在溢出区。
  - 是否需要在 `tauri.conf.json` 的 `bundle.windows` 配置 `trayIcon` 或在 Windows 用 `.ico` 而非 `.png`

### Frontend 平台门控移除

- [ ] `apps/desktop/src/components/pet/PetApp.tsx` 周期性 `pet_set_topmost_level` invoke（line ~430）— Windows 上当前是 no-op，需在新实现完成后验证。
- [ ] `apps/desktop/src/hooks/usePetHostBridge.ts:103` `show_pet_if_hidden` 调用路径 — Windows 上应自动走非 macOS 分支。
- [ ] 无 `onMac()` 门控 pet 显示（grep 确认 `apps/desktop/src` 里 pet 路径没有 macOS-only 门控；voice 路径有，但那是 voice 子任务）。

## Acceptance Criteria

- Windows 11 上启动应用（pet mode enabled）→ mascot 窗口可见且透明背景渲染正确
- mascot 窗口 `alwaysOnTop` 行为对齐 macOS（`SetWindowPos(HWND_TOPMOST)`）
- 多屏（主屏负坐标）`set_pet_position` 定位正确
- Windows 任务栏右下角（或溢出区）可见 Quill 托盘图标，左键弹菜单
- `cargo check --target x86_64-pc-windows-msvc` 在 macOS host 通过
- 无 macOS 行为回归（CI macOS matrix 绿）
- 受影响模块 lint / typecheck 绿

## Out of Scope

- voice 模块 Windows 实现（见 `08-13-windows-voice` 子任务）
- Chrome 密码 DPAPI（已在 `08-12-windows` PR5 排期）
- 代码签名 / MSIX
- ARM64 Windows

## Technical Notes

- Windows API 通过 `windows-rs` crate 调用：`Win32::UI::WindowsAndMessaging`（`SetWindowPos`, `HWND_TOPMOST`, `WS_EX_LAYERED`, `WS_EX_TOOLWINDOW`, `SetLayeredWindowAttributes`, `MonitorFromWindow`, `GetMonitorInfoW`）+ `Win32::Graphics::Dwm`（`DwmExtendFrameIntoClientArea`）+ `Win32::UI::Shell`（ tray 行为可能在 `Shell_NotifyIcon` 层，但 Tauri 2 封装了）
- 已有的 `pet_set_cursor` / `set_pet_opacity` / `pet_get_work_area` Windows 实现在 `pet_commands.rs` 内的 `#[cfg(target_os = "windows")]` 块，新命令按相同模式扩展
- Tauri 2 在 Windows 上 `transparent: true` 会自动设置 `WS_EX_NOREDIRECTIONBITMAP` + 用 DWM 透明，但 mascot 96x96 的小窗口可能需要显式 `WS_EX_LAYERED` + `UpdateLayeredWindow` 才能正确 alpha 混合
- Windows 托盘图标推荐 `.ico` 格式（Tauri 2 在 Windows 上内部把 PNG 转 ICO，但嵌入式 PNG 透明通道在转换中可能丢失 — 验证一下）

## Implementation Plan

- 单 PR，闭环 lint + typecheck + `cargo check --target x86_64-pc-windows-msvc` + Windows 11 验证
