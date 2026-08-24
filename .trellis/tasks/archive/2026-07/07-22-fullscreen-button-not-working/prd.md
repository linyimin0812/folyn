# Fullscreen Button Not Working

## Bug
点击 Folyn 主窗口的 macOS 绿色交通灯 / Window 菜单 Enter Full Screen，无法进入全屏。

## Root cause
`apps/desktop/src-tauri/src/lib.rs` 启动时调用 `set_dock_visibility(false)`，app 进入 `NSApplicationActivationPolicyAccessory` 模式。副作用：accessory 模式下 macOS 原生 fullscreen 入口（绿色交通灯、Window 菜单 `.fullscreen()` item）不走标准 fullscreen 流程，点不动。

## Fix (A — 大回退)
移除 `set_dock_visibility(false)` 调用。app 回到 regular activation policy：
- ✅ 绿色交通灯恢复全屏
- ✅ Window 菜单 Enter Full Screen 恢复
- ✅ Dock icon 显示，app 出现在 ⌘Tab 列表
- ❌ pet 不再保证浮在 VS Code 等 fullscreen app 之上（AppKit 在 `applicationDidResignActive:` 会把 regular-app 的 NSPanel 降级）——用户接受此 trade-off

## Out of scope
- 不加 Tauri command / 前端快捷键（方案 B 已回滚）
- 不动 pet panel 的 `can_join_all_spaces | full_screen_auxiliary` collectionBehavior——保留，未来若恢复 accessory 模式可继续生效

## Verification
- `cargo check` 通过
- 待手动验证：启动 app，点绿色交通灯 → 主窗口进入全屏；再点 → 退出
- 待手动验证：pet 在非 fullscreen 场景下行为正常
