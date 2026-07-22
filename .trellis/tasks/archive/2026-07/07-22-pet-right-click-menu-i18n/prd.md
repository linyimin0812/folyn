# Pet Right-Click Menu i18n

## Goal

桌宠右键菜单 + macOS app 菜单栏的硬编码 label 改为跟随用户当前 locale（zh/en）。当前 10 条右键菜单 label + 3 条 app 菜单栏子菜单标题硬编码、中英混杂；需要让菜单文案随 locale 切换，且切换后立即生效（不重启）。

## Requirements

- 桌宠右键菜单 10 条 label i18n（`pet_commands.rs` 的 `pet_show_context_menu`）：
  - `Show Main Window` / `New Note` / `Toggle AI Panel` / `隐藏桌宠图标` / `桌宠大小` / `小` / `中` / `大` / `Disable Pet Mode` / `测试气泡通知`
- macOS app 菜单栏 3 个子菜单标题 i18n（`lib.rs` setup）：
  - `Edit` → `编辑`（zh）/ `Edit`（en）
  - `Window` → `窗口`（zh）/ `Window`（en）
  - `Quill` 是品牌名，不翻译。
- 前端 `pet_show_context_menu` 命令加 `locale: String` 参数。
- 前端 `setLocale` 时调新命令 `pet_rebuild_app_menu(locale)`，Rust 重建 app 菜单栏。
- Rust 端 const label 表（zh/en 两列），未知 locale → fallback en。
- 菜单项 ID 与 `PetMenuAction` 字符串不变；`on_menu_event` 路由不动。
- 前端从 `useLocaleStore.getState().locale` 取 locale 传给 Rust。
- 启动 hydrate 后前端主动同步一次 locale 给 Rust（setup() 默认 en）。

## Acceptance Criteria

- [ ] locale=zh：桌宠右键菜单全中文；app 菜单栏子菜单标题为 `编辑` / `窗口`。
- [ ] locale=en：全英文；子菜单标题为 `Edit` / `Window`。
- [ ] 切换 locale 后，下次右键立即生效；app 菜单栏也立即更新（无需重启）。
- [ ] `PET_CTX_MENU_*` ID 与 `PET_NATIVE_MENU_ACTIONS` 字符串不变。
- [ ] `on_menu_event` 路由逻辑不变。
- [ ] `PetContextMenu.test.tsx` 更新（若签名变更）或仍通过。
- [ ] Rust 端 const label 表加最小自检（`#[test]` 确认 zh/en 两列 key 完整）。

## Definition of Done

- Rust lint / `cargo check` / `cargo test` 绿。
- 前端 `pnpm typecheck` + `pnpm test` 绿。
- 文案落位（Rust const 表；不需要前端 i18n 文案）。

## Technical Approach

- Rust 端在 `pet_commands.rs` 加 const 表 + `fn pet_menu_label(locale: &str, key: PetMenuLabel) -> &'static str`。
- `pet_show_context_menu(app, locale: String)`：从 locale 取 label 构建 MenuItem。
- 新命令 `pet_rebuild_app_menu(app, locale: String)`：重建 app 菜单栏（提取 `lib.rs::setup` 里的菜单构建为可复用函数）。
- 前端：
  - `PetContextMenu.tsx` `openPetContextMenu()` → `invoke('pet_show_context_menu', { locale: useLocaleStore.getState().locale })`。
  - `localeStore.setLocale` 在持久化 + `i18n.changeLanguage` 后调 `invoke('pet_rebuild_app_menu', { locale })`（`isTauri()` 守卫）。
  - `App.tsx` 启动 hydrate locale 后也调一次 `pet_rebuild_app_menu` 同步给 Rust。
- fallback：locale 非 `zh` → 按 `en` 取（match 表达式 default 分支）。

## Decision (ADR-lite)

**Context**: Rust 端原生菜单需要 i18n，但 Rust 无 locale 状态。

**Decision**: Approach A — 前端传 locale 字符串给 Rust 命令；Rust 端存 zh/en const label 表。

**Consequences**:
- 新增语言 = Rust 表加一列 + 前端 `SUPPORTED_LOCALES` 加一项。
- Rust 有一份和前端概念上重复的翻译表，但只有 10+2 条，可控。
- 不引入 Rust i18n crate（gettext / fluent），避免依赖膨胀。

## Out of Scope

- 新增第三种语言（仅打通机制，文案 zh/en 就位即可）。
- 翻译 "Quill" 品牌名。
- 改菜单项 ID / 顺序 / 图标。
- PredefinedMenuItem（Cut/Copy/Paste/About 等）—— OS 已本地化。
- 非 macOS 平台的菜单栏（当前 desktop 仅 macOS）。

## Technical Notes

- 菜单构建：`apps/desktop/src-tauri/src/commands/pet_commands.rs:539-660`。
- app 菜单栏 setup：`apps/desktop/src-tauri/src/lib.rs:528-560`。
- `on_menu_event` 路由：`apps/desktop/src-tauri/src/lib.rs:428-460`。
- `PET_CTX_MENU_*` ID 常量：`pet_commands.rs` 顶部。
- 前端入口：`apps/desktop/src/components/pet/PetContextMenu.tsx:106` `openPetContextMenu`。
- 前端 locale store：`apps/desktop/src/store/localeStore.ts`，`SUPPORTED_LOCALES = ['zh','en']`。
- 先例：`voice_start(app, spoken_locale: String)` 命令接收前端传入 locale。

## Implementation Plan

- PR1: Rust 端 const label 表 + `pet_show_context_menu` 加 locale 参 + `pet_rebuild_app_menu` 命令 + setup() 重构为可复用构建函数 + Rust `#[test]` 自检。
- PR2: 前端 `openPetContextMenu` 传 locale；`localeStore.setLocale` 触发 rebuild；启动 hydrate 后同步一次。
- PR3: `PetContextMenu.test.tsx` 更新；文案校对；typecheck/test 绿。
