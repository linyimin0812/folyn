# Research: tauri-nspanel `to_panel()` / NSPanel 转换安全性

> 来源：trellis-research 子代理（2026-07-06），读取 GitHub `ahkohd/tauri-nspanel` v2.1 源码 + BongoCat 实际用法 + Quill git 历史。

## 1. crates.io 发布情况

**`tauri-nspanel` 未发布到 crates.io**（API 返回 "crate does not exist"）。只能用 git 依赖：

```toml
tauri-nspanel = { git = "https://github.com/ahkohd/tauri-nspanel", branch = "v2.1" }
```

`v2.1` 分支对应 version 2.1.0，Tauri 2 兼容（依赖 `tauri = "2.8.5"` + `objc2 = "0.6.1"`）。可固定到 commit `a3122e894383aa068ec5365a42994e3ac94ba1b6`。

## 2. `to_panel()` 内部实现 — 也用 `object_setClass`

**关键纠正**：PRD 之前假设 "不是 `object_setClass` hack" 是错的。tauri-nspanel **同样用 `object_setClass`** 把活动窗口的 isa 指针换掉（`src/panel.rs:560-630` `from_window`）。

**但目标类不同**——`panel!` 宏用 `objc2::define_class!` 生成自定义 `RawNsPanel` 子类：

- 继承自 **NSPanel**（不是 base NSPanel）
- `NsPanelIvars` **空结构体**——子类不增加 ivar，`object_setClass` 不会因子类 ivar 布局溢出原分配
- 重写 `mouseEntered:/mouseExited:/mouseMoved:/cursorUpdate:` → 转发给 window delegate（绕过 NSPanel 私有 ivar 的默认实现）
- 重写 `canBecomeKeyWindow/canBecomeMainWindow/isFloatingPanel/becomesKeyOnlyIfNeeded/worksWhenModal/hidesOnDeactivate` 返回编译期常量
- 捕获 `object_getClass` 原始类，`to_window()` 可逆 swap 回去

## 3. 安全性 vs Quill 的 crash

Quill `c2269ab`（已回退 `81bc9b8`）的失败三要素：
1. swap 到 **base `NSPanel`**（Apple 类，带 NSPanel 私有 ivar，活 NSWindow 分配里没有）→ 越界
2. 用 **deprecated `objc` 0.2.7** raw FFI
3. **无方法重写** → AppKit 默认 `mouseDown:`/`sendEvent:` 触碰未初始化的 NSPanel 私有 ivar → 点击 crash

tauri-nspanel 在三轴上都不同：自定义子类 + 空 ivar、`objc2` 0.6.1 sound `define_class!`、重写鼠标事件 responder。**README Showcase 列了 ~10 个生产 Tauri App 使用此 crate**（Cap / Screenpipe / EcoPaste / BongoCat / Hyprnote / Coco / Overlayed / Verve / JET Pilot / Buffer），无 crash 报告。BongoCat（与 Quill 同为桌宠）在 `src-tauri/src/core/setup/macos.rs:37` 对主窗口调用 `to_panel::<NsPanel>()` 并正常发布。

**结论：安全。** 在 Tauri `setup` hook、主线程、`get_webview_window("pet")` 返回后立即调用——不依赖 webview 内容加载状态。所有 panel 操作必须在主线程（`run_on_main_thread`）。

## 4. collectionBehavior 与 level 数值

`PanelLevel`（`src/builder.rs:719-764`）：

| variant | value (i64) |
|---|---|
| Normal | 0 |
| Floating | 4 |
| ModalPanel | 8 |
| Utility | 19 |
| **Dock** | **20** |
| MainMenu | 24 |
| Status | 25 |
| PopUpMenu | 101 |
| ScreenSaver | 1000 |
| Custom(i32) | i32 |

→ **BongoCat 用 `Dock` (20)，不是 ScreenSaver (1000)**。

`CollectionBehavior` 标志（`src/builder.rs:806-893`，映射到 `NSWindowCollectionBehavior`）：
- `can_join_all_spaces()` = 1
- `move_to_active_space()` = 2
- `stationary()` = 16
- `full_screen_auxiliary()` = 256
- `full_screen_allows_tiling()` = 512

组合：
- **BongoCat show**：`stationary | can_join_all_spaces | full_screen_auxiliary` = 16|1|256 = **273**
- **BongoCat hide**：`stationary | move_to_active_space | full_screen_auxiliary` = 16|2|256 = **274**
- **Quill 当前**：`move_to_active_space | full_screen_auxiliary | full_screen_allows_tiling` = 2|256|512 = **770**

### "stationary 与 canJoinAllSpaces 冲突" 是误诊

Apple 文档**未标记 `Stationary` 与 `CanJoinAllSpaces` 互斥**——独立 bit flag。`Stationary` = 窗口不在 Space 间自动移动；`CanJoinAllSpaces` = 有资格出现在每个 Space。组合是**文档化的浮动面板模式**（`docs/key-types.md` 列在 "Common Combinations → Floating Tool Palette"），Spotlight / 通知中心就用这组。

Quill `267583e` 注释"窗口不在任何 Space"是**特定于 Quill 当时用 NSWindow（非 NSPanel）+ ScreenSaver level 的误诊**。`CanJoinAllSpaces + FullScreenAuxiliary` 只对 AppKit 当作 panel 的窗口（NSPanel 子类，或 panel/utility level 的窗口）才授予全屏 Space 可见性。普通 NSWindow 在 ScreenSaver level (1000) 太高，AppKit 把它放在全屏 App 遮挡的独立层。**真 NSPanel + Dock level (20) + 273** 才是正确配方。

## 5. `macOSPrivateApi: true` 影响

- crate `Cargo.toml` 硬依赖 `tauri` 的 `macos-private-api` feature
- 作用：让 wry/Tauri 调 NSWindow/NSView 私有方法（`setHasShadow:`、透明窗口的 opaque flag 等）
- **签名/公证**：私有 API 被 **Mac App Store 拒收**，但 **不阻塞 Developer ID 签名 + 公证**。BongoCat/Cap/EcoPaste/Hyprnote 都带此 flag 公证发布
- 范围仅 NSWindow/NSView 私有选择器，不影响 Windows/Linux 构建
- Quill 已用透明 pet 窗口，本就需要此 flag

## 6. DIY（用现有 `objc`/`cocoa`）可行性

技术上可行，但**正是 `c2269ab` crash 的路径**。要安全做需手工复制 crate 的全部内容：自定义 NSPanel 子类（迁移到 `objc2` 0.6.1 `define_class!` 或手搓 `objc::declare::ClassDecl` + 空 ivar + 鼠标事件重写）、捕获原类、可逆 swap、per-window store、collectionBehavior/level/styleMask/transparent/event handler/tracking area 全套。

Quill 当前 `objc` 0.2.7 是 **deprecated 且 unsound**（维护者推荐迁 `objc2`）。

**crate 的核心价值**：sound 宏生成的子类（空 ivar + 鼠标事件重写 = 防 crash 的关键）、可逆 `to_window()`、`ManagerExt`/`WebviewWindowExt` 与 Tauri State 集成、`PanelBuilder` fluent API、`panel_event!` 类型安全 delegate、~10 个生产 App 验证含同用例 BongoCat。DIY 无实质 upside 且正是咬过 Quill 的风险面。

## 最终结论

1. **`to_panel()` 在 Quill Tauri 2 webview 窗口上安全**——同样是 `object_setClass`，但 swap 到自定义 `objc2` `RawNsPanel` 子类（空 ivar + 鼠标事件重写），与 Quill `c2269ab`（base NSPanel + objc 0.2.7 + 无重写）本质不同。在 `setup` hook 主线程、窗口创建后立即调用。
2. **git 依赖**（无 crates.io 版），用 `branch = "v2.1"`。
3. **可复现 BongoCat 全屏置顶**：转 panel 后设 `Dock` level (20) + `nonactivating_panel` styleMask + `stationary | can_join_all_spaces | full_screen_auxiliary` (273) + `macOSPrivateApi: true`。
4. **"stationary 与 canJoinAllSpaces 冲突" 是误诊**，是 Quill NSWindow+ScreenSaver 上下文的产物，非 AppKit 通则。

## 参考文件

- `/Users/yiminlin/project/BongoCat/src-tauri/src/core/setup/macos.rs` — 参考实现
- `/Users/yiminlin/project/BongoCat/src-tauri/src/plugins/window/src/commands/macos.rs` — show/hide/always-on-top 命令模式
- `/Users/yiminlin/project/BongoCat/Cargo.toml:20` — git 依赖行
- tauri-nspanel v2.1 源码（GitHub）：`src/panel.rs`（`panel!` 宏 + `from_window`）、`src/lib.rs`（`WebviewWindowExt::to_panel`、`ManagerExt`）、`src/builder.rs`（`PanelLevel`/`CollectionBehavior`/`StyleMask`）、`docs/*.md`
