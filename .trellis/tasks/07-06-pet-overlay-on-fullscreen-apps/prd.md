# Pet Overlay on Fullscreen Apps

## Goal

让桌宠窗口（`pet`）在其他 macOS 应用进入全屏（native fullscreen Space，如 VS Code / 浏览器全屏）时仍然显示在最上层，参考 `/Users/yiminlin/project/BongoCat` 的实现。当前 Mochi 的桌宠在切到全屏 App 后被遮挡或不在该 Space 显示。

## What I already know

* Mochi 桌宠是 Tauri 2 + Rust + objc/cocoa FFI，前端 React。窗口 label `"pet"`，静态声明见 `apps/desktop/src-tauri/tauri.conf.json`。
* 当前运行时配置（`src/lib.rs:58-107` `reapply_pet_topmost` + `src/commands.rs:793-857` `pet_set_topmost_level` + `commands.rs:900-981` `pet_make_transparent`，三处一致）：
  * level = `CGWindowLevelForKey(13)` (ScreenSaver, ~1000)
  * collectionBehavior = 770 = `moveToActiveSpace(2) | fullScreenAuxiliary(256) | fullScreenAllowsTiling(512)`
  * `tauri.conf.json` 中 `alwaysOnTop: false`（故意关，避免 Tauri 把 level 重置回 Floating）
* 已尝试并回退的方案（见 git log）：
  * `object_setClass` 把 NSWindow 运行时改成 NSPanel（`c2269ab`）→ 腐蚀已活动窗口 ivars，点击 crash → `81bc9b8` 回退
  * `orderOut` + `orderFrontRegardless` reorder（`6f63b1e`）→ 透明 Tauri 窗口抛 ObjC 异常，Rust 抓不住 → fatal abort → `0ba615b` 移除
  * `stationary | canJoinAllSpaces` 组合（`267583e`）→ 注释记录两者冲突，窗口"不在任何 Space"
* BongoCat 能在全屏 App 之上显示，核心机制（`/Users/yiminlin/project/BongoCat/src-tauri/src/core/setup/macos.rs:33-46`）：
  * 用 `tauri-nspanel` crate 的 `to_panel::<NsPanel>()` 把 Tauri WebviewWindow 转成**真 NSPanel**（不是 `object_setClass` hack）
  * `set_level(PanelLevel::Dock.value())`
  * `set_style_mask(StyleMask::empty().resizable().nonactivating_panel())`
  * `set_collection_behavior(stationary | can_join_all_spaces | full_screen_auxiliary)` ← **`can_join_all_spaces` 是关键，不是 `moveToActiveSpace`**
  * `is_floating_panel: true`, `can_become_key_window: true`, `can_become_main_window: false`
  * `tauri.conf.json` 启用 `"macOSPrivateApi": true`
  * 显示时切 `can_join_all_spaces`，隐藏时切回 `move_to_active_space`

## Assumptions (validated by research — see `research/tauri-nspanel-to-panel-safety.md`)

* ~~`tauri-nspanel` 的 `to_panel()` 不用 `object_setClass`~~ — **纠正**：它**也用 `object_setClass`**，但 swap 到自定义 `RawNsPanel` 子类（`objc2` 0.6.1 `define_class!`，**空 ivar** + 重写 `mouseEntered/Exited/Moved/cursorUpdate` 转发给 delegate + 重写布尔 panel-state 方法），与 Mochi `c2269ab` 的 base NSPanel + `objc` 0.2.7 + 无重写本质不同。**安全。**
* `tauri-nspanel` **未发布 crates.io**，只能 git 依赖 `branch = "v2.1"`（v2.1.0，Tauri 2 兼容）。Mochi Cargo.toml 目前无 git 依赖——本任务将引入首个 git 依赖。
* `macOSPrivateApi: true` 对 Developer ID 签名+公证无阻塞（仅 Mac App Store 拒收）。BongoCat/Cap/EcoPaste 均带此 flag 公证发布。Mochi 已用透明窗口，本就需要。
* ~~`stationary | canJoinAllSpaces` 冲突~~ — **纠正为误诊**：Apple 文档未标记互斥，是文档化的浮动面板组合（Spotlight / 通知中心同款）。Mochi `267583e` 的"不在任何 Space"是 NSWindow+ScreenSaver level 上下文的产物，真 NSPanel + Dock level 下 273 组合工作。

## Research References

* [`research/tauri-nspanel-to-panel-safety.md`](research/tauri-nspanel-to-panel-safety.md) — `to_panel()` 用 `object_setClass` 但 swap 到自定义空-ivar 子类+鼠标事件重写，安全；git-only 依赖；Dock level=20；273 是正确组合；`stationary|canJoinAllSpaces` 不冲突。

## Open Questions

* [Technical-impl] 像素级 hit-test 具体实现细节（NSTrackingArea 边界、alpha 阈值、与 WKWebView layer 的坐标转换）— 实现阶段验证。

## Spec 冲突点（必须由本任务解决）

`.trellis/spec/desktop/frontend/tauri-window-patterns.md` 的 "Click-Through on Transparent Regions" scenario 当前决策是：**不**做点击穿透（`setIgnoreCursorEvents(false)` 终身保持），原因是之前 60ms `pet_cursor_probe` + 80×80 sprite hit-test 轮询切换 `setIgnoreCursorEvents` 与原生拖拽结束抢跑 → "drag-once-then-blocked"。spec 同时注明 "Click-through via per-pixel `NSWindow` hit-testing is possible later"。

本任务要交付点击穿透，**必须不复用**之前失败的轮询-toggle 路径，改用 NSView `hitTest:` 重写（AppKit 按事件逐次评估，无轮询无竞态）。实现完成后需更新该 spec scenario 记录新决策与 Drag 安全性证据。

## Decision (ADR-lite)

**Context**: Mochi 已两次翻车（`object_setClass` swap crash、`orderOut` foreign-exception abort）。需要在引入 NSPanel 方案的同时保留可回退路径，并预留点击穿透能力。

**Decision**:
1. 引入 `tauri-nspanel` git 依赖，**固定到 commit `a3122e8`**（`branch = "v2.1"`，v2.1.0，Tauri 2 兼容）保证可复现。
2. **保留旧 NSWindow + level 1000 + behavior 770 路径**，用运行时开关切换（env var `MOCHI_PET_PANEL_BACKEND=nspanel|legacy`）。默认 `nspanel`，出问题可切回 `legacy`。开关在窗口创建前读取，setup hook 据此分支。
3. 新 NSPanel 路径：`to_panel::<NsPanel>()` → `set_level(Dock=20)` → `nonactivating_panel` styleMask → `collectionBehavior = 273`（show）/ 切 `274`（hide）→ `macOSPrivateApi: true`。
4. **点击穿透做完整像素级方案**：透明区穿透到全屏 App、宠物本体可点可拖。**不复用**之前失败的 `setIgnoreCursorEvents` 轮询 toggle（spec 记录的 "drag-once-then-blocked" 竞态），改用 **NSView `hitTest:` 重写**——AppKit 按事件逐次评估点击点是否命中宠物像素（读 WKWebView layer alpha 或前端提供命中区），命中则接收事件、否则返回 nil 让事件穿透到下层窗口。无轮询、无 drag 竞态。具体在实现阶段验证。

**Consequences**:
- 代码两套（NSPanel + legacy NSWindow），维护成本略高但可安全回退。
- 像素级穿透增加前端/Rust 命令往返复杂度；`setIgnoresMouseEvents` 切换有边界竞态（进入穿透区时事件已派发），需在宠物周边留缓冲或用 `NSTrackingArea`。
- 固定 commit 后升级需手动改 Cargo.toml。

## Requirements (evolving)

* [ ] 桌宠（`pet`）在其他 App 全屏（native fullscreen Space）时可见且浮在最上层
* [ ] 快捷面板（`pet-panel`）同样能在全屏 App 之上显示/弹出
* [ ] 不破坏现有的"非全屏模式下常驻置顶"行为
* [ ] 桌宠点击、拖拽、右键菜单、快捷面板仍正常工作（不重蹈 NSPanel swap 的 crash）
* [ ] 不抢前台 App 焦点（nonactivating）
* [ ] **像素级点击穿透**：透明区点击穿透到全屏 App，宠物本体（圆形 badge）可点可拖
* [ ] 保留 legacy NSWindow 路径，运行时开关可切回

## Acceptance Criteria (evolving)

* [ ] 在 VS Code 全屏 Space 上，桌宠可见
* [ ] 在浏览器（Chrome/Safari）全屏上，桌宠可见
* [ ] 桌宠点击不 crash，拖拽正常
* [ ] 切换 Space 后桌宠跟随到当前活动 Space
* [ ] 非全屏模式下，桌宠仍置顶于普通窗口之上
* [ ] 点击桌宠透明区，事件落到全屏 App（不触发桌宠菜单/拖拽）
* [ ] 点击桌宠本体，正常触发交互（菜单/拖拽）
* [ ] `MOCHI_PET_PANEL_BACKEND=legacy` 时回退到旧 NSWindow+level 1000 路径，桌宠仍可用（非全屏置顶）
* [ ] `pet-panel` 在全屏 App 之上正常弹出

## Definition of Done

* Tests added/updated（前端交互逻辑 + Rust 单测可覆盖部分）
* `cargo check` / `cargo clippy` / `pnpm typecheck` / `pnpm lint` 绿
* 行为变更记录到 `.trellis/spec/desktop/`
* 回滚方案：保留现有 NSWindow + level 1000 路径作为 fallback（feature flag 或代码分支）

## Out of Scope (explicit)

* Windows / Linux 端的全屏置顶（本任务仅 macOS）
* 桌宠之外的其他主窗口（`main`）的置顶行为
* 多显示器全屏跨屏显示（先保证单屏）
* `pet-panel` 的像素级穿透（panel 是交互面板，整体可点即可，不做穿透）

## Technical Notes

* 关键文件：
  * `apps/desktop/src-tauri/tauri.conf.json` — pet / pet-panel 窗口静态声明
  * `apps/desktop/src-tauri/src/lib.rs:58-107` — `reapply_pet_topmost` + setup + 500ms 轮询线程
  * `apps/desktop/src-tauri/src/commands.rs:793-857` — `pet_set_topmost_level`
  * `apps/desktop/src-tauri/src/commands.rs:900-981` — `pet_make_transparent`（含 `with_webview` 透明化）
  * `apps/desktop/src/components/pet/PetApp.tsx:270/305/315` — 前端调用点
* 参考：`/Users/yiminlin/project/BongoCat/src-tauri/src/core/setup/macos.rs`、`/Users/yiminlin/project/BongoCat/src-tauri/src/plugins/window/src/commands/macos.rs`
* Tauri 2 NSWindow 通过 `WebviewWindow::ns_window()` 拿原生指针
