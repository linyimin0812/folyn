# 桌宠图标支持置顶配置

## Goal

桌宠图标当前默认始终浮于所有应用之上（NSPanel Dock 级别 + fullscreen-auxiliary）。新增一个配置开关 `petAlwaysOnTop`，让用户可以选择是否启用这种"始终置顶"行为；关闭后桌宠仅在 Folyn 处于前台或无其他应用遮挡时可见。

## What I already know

- NSPanel 后端（默认）在 `pet_panel_macos.rs::convert_windows` 启动时把 `pet` 窗口 `to_panel::<FolynPetPanel>()` 后 `set_level(PanelLevel::Dock)` + `set_collection_behavior(stationary | can_join_all_spaces | full_screen_auxiliary)`（=273）。
- `pet_commands.rs::pet_set_topmost_level` 在 NSPanel 路径下提前返回（line 857-859），实际级别由启动时锁定。
- `tauri.conf.json` 中 `pet` 窗口 `alwaysOnTop: false`——置顶行为完全靠 Rust 侧 NSPanel 级别控制。
- petStore（`apps/desktop/src/store/petStore.ts`）已有同构持久化切片 + hydrate + 类型守卫模式，加字段是机械活。
- PetSettings.tsx 已用 `<Toggle>` 组件做 `petModeEnabled` 开关——新增一行同样模式。
- i18n zh/en 都有 `settings.pet.*` 命名空间。

## Requirements

- 新增 petStore 字段 `petAlwaysOnTop: boolean`（默认 `true`，保留现有用户行为）。
- 新增 Rust 命令 `pet_set_always_on_top(enabled: bool)`：
  - NSPanel 后端：`to_panel::<FolynPetPanel>()` 拿到 panel 句柄；启用 → `set_level(Dock)` + `stationary | can_join_all_spaces | full_screen_auxiliary`（273）；禁用 → `set_level(Normal)` + 仅 `can_join_all_spaces`（去掉 stationary 与 full_screen_auxiliary）。
  - 非 macOS / legacy 后端：no-op（保持现状）。
- PetApp.tsx 启动 mount effect + 标志变化 effect 调用 `pet_set_always_on_top(petAlwaysOnTop)`。
- PetSettings.tsx 在"显示桌宠"开关下新增"始终置顶"Toggle，绑定 `petAlwaysOnTop`。
- i18n zh/en 加 `settings.pet.alwaysOnTop.title` + `.desc`。
- petStore.hydrate 对无效值兜底为 `true`。
- `PERSIST_KEYS_PET` 追加 `'petAlwaysOnTop'`。

## Acceptance Criteria

- [ ] 默认安装/首次启动：`petAlwaysOnTop=true`，桌宠浮于所有应用（含全屏 VS Code）之上——保持现状。
- [ ] 设置中切换为关闭：桌宠不再浮于其他应用之上；切换到 VS Code 等前台应用时桌宠被遮挡。
- [ ] 切换为开启：恢复 Dock 级别 + fullscreen-auxiliary 行为。
- [ ] 设置项持久化，重启后状态一致。
- [ ] 非 Tauri 环境（测试）不触发 invoke，不崩溃。

## Definition of Done

- petStore + Rust 命令 + UI + i18n 全链路打通。
- `pnpm typecheck` + `pnpm test` 通过（petStore.test.ts 已存在，需要加新字段的测试或至少不破坏既有测试）。
- `cargo check` 通过。

## Technical Approach

- **petStore**：加 `petAlwaysOnTop: boolean` 字段 + `setPetAlwaysOnTop` setter，加入 `PERSIST_KEYS_PET`，hydrate 兜底 `true`。
- **Rust**：新增 `pet_set_always_on_top(app, enabled: bool)` 命令，仅在 macOS + NSPanel 后端生效；legacy 后端 / 非 macOS no-op。注册到 `lib.rs` `invoke_handler`。
- **PetApp.tsx**：
  - 启动 mount effect：在现有 `pet_set_topmost_level` 调用旁加一次 `pet_set_always_on_top(petAlwaysOnTop)`。
  - 新增 effect：监听 `petAlwaysOnTop` 变化时调用 `pet_set_always_on_top`。
  - 800ms poll 与 blur listener 保持原样（NSPanel 路径下 `pet_set_topmost_level` 是 no-op，开销可忽略）。
- **PetSettings.tsx**：在"显示桌宠"开关下方新增 Toggle 行，绑定 `petAlwaysOnTop` / `setPetAlwaysOnTop`。
- **i18n**：zh/en `settings.pet.alwaysOnTop.{title,desc}`。

## Decision (ADR-lite)

**Context**: 当前桌宠"始终置顶"是硬编码，部分用户希望关闭以避免遮挡其他应用。
**Decision**: 加一个 `petAlwaysOnTop: boolean`（默认 `true`），通过 NSPanel 级别 + collectionBehavior 切换实现。
**Consequences**: 桌宠关闭置顶后变为普通透明窗口（仍 transparent + skipTaskbar + decorations:false），在前台应用切换时会被遮挡——符合用户预期。

## Out of Scope

- pet-panel / pet-bubble / voice-orb 的置顶行为——只动 pet 图标本身。
- 非 macOS 平台（pet 模式目前 macOS-only）。
- 桌宠关闭置顶时的"Folyn 前台时恢复浮起"等中间档位——二元开关。
- legacy 后端 (`FOLYN_PET_PANEL_BACKEND=legacy`) 的真正实现——命令 no-op 即可，因为 legacy 是回滚通道。

## Technical Notes

- 关键文件：
  - `apps/desktop/src/store/petStore.ts`
  - `apps/desktop/src/store/petStore.test.ts`
  - `apps/desktop/src/components/settings/PetSettings.tsx`
  - `apps/desktop/src/components/pet/PetApp.tsx`
  - `apps/desktop/src-tauri/src/commands/pet_commands.rs`
  - `apps/desktop/src-tauri/src/pet_panel_macos.rs`
  - `apps/desktop/src-tauri/src/lib.rs`（注册新命令）
  - `apps/desktop/src/i18n/locales/zh/settings.json`
  - `apps/desktop/src/i18n/locales/en/settings.json`
- `PanelLevel::Normal` / `PanelLevel::Dock` 来自 `tauri-nspanel` crate。
- `FolynPetPanel` 类型定义在 `pet_panel_macos.rs`，命令需要 import 它。
