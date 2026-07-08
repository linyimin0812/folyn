# Desktop Pet Right-Click Menu — Hide Icon + Size Adjustment

## Goal

在桌宠图标的原生右键菜单中新增两项功能：
1. **隐藏桌宠图标** — 隐藏桌宠窗口（行为与现有 Disable Pet Mode 一致，仅标签中文化，与之共存）。
2. **桌宠大小调整** — 小 / 中 / 大 三挡切换桌宠窗口与图标尺寸（64 / 96 / 128 逻辑像素）。

## What I already know (from repo inspection)

- 右键菜单**已存在**且为 Rust 原生 NSMenu（`commands.rs:597-650` `pet_show_context_menu`），因为 96×96 透明窗口会裁剪 HTML 菜单（issue #1）。
- 当前 4 个菜单项（英文标签）：`Show Main Window` / `New Note` / `Toggle AI Panel` / `(分隔)` / `Disable Pet Mode`。
- 菜单项 ID 常量在 `commands.rs:411-414`：`PET_CTX_MENU_SHOW_MAIN` 等。
- 选择流程：`on_menu_event` → `pet_ctx_menu_action` (`lib.rs:32-47`) → emit `pet://menu-action` → `App.tsx:324` 监听 → `handleAction` switch (`App.tsx:258-308`)。
- **`disable-pet` 已经实现"隐藏"语义**：`App.tsx:271-279` 中 `setPetModeEnabled(false)` + `invoke('toggle_pet_mode')`（Rust 隐藏 pet 窗口）+ emit `pet://visibility-changed`。
- 桌宠窗口尺寸固定为 96×96（`tauri.conf.json:40-54`，`resizable:false`）；mascot SVG 在 `PetMascot.tsx:73-74` 硬编码 72×72，`PetApp.tsx:54-55` `SPRITE_SIZE=96`。
- `settingsStore` 已有：`petModeEnabled` / `petPositionX,Y` / `petIconSource` / `petIconPath` / `petSizeVersion`（仅作默认尺寸迁移计数器，非用户可选尺寸）。**无** `petSize` 字段。
- 跨窗口同步模式：`pet://icon-changed`（`PetApp.tsx:667-692`）— 主窗口改图标后 emit 事件，pet 窗口监听更新。大小切换可复用同模式。
- 前序同名存档任务（commit `d02f143`）规划的是「置顶切换 + 大小调整」，**未实现即存档**；当前请求范围不同——用「隐藏图标」替代「置顶切换」。

## Decisions (from brainstorm)

- **D1（Hide 项语义）**：新增「隐藏桌宠图标」菜单项，行为与现有 `disable-pet` 完全一致（隐藏窗口 + `setPetModeEnabled(false)` + `toggle_pet_mode`），仅标签中文化。现有「Disable Pet Mode」保留共存。**理由**：用户明确选择共存，接受行为一致。**实现**：新增 action `hide-pet`，`handleAction` 中与 `disable-pet` 走同一逻辑分支。
- **D2（尺寸值）**：Small=64×64, Medium=96×96（当前默认）, Large=128×128 逻辑像素。mascot SVG 随窗口缩放（viewBox 0 0 512 512，CSS `.pet-mascot` 控制实际渲染尺寸）。
- **D3（菜单结构）**：尺寸用**子菜单**（`Submenu` + 三个 `CheckMenuItem` 单选互斥），符合原生菜单惯例；隐藏项为普通 `MenuItem`。
- **D4（菜单语言）**：仅新项中文化（「隐藏桌宠图标」「桌宠大小」「小」「中」「大」），现有 4 项保留英文。
- **D5（菜单位置）**：新项置于分隔符**之上**（与现有功能项同组），顺序：`Show Main Window` / `New Note` / `Toggle AI Panel` / `隐藏桌宠图标` / `桌宠大小 ▶` / `(分隔)` / `Disable Pet Mode`。

## Requirements

- **R1 隐藏项**：右键菜单新增「隐藏桌宠图标」项，点击后隐藏 pet 窗口（行为同 `disable-pet`）。
- **R2 尺寸子菜单**：右键菜单新增「桌宠大小」子菜单，含小/中/大 三个单选项，当前尺寸打勾。切换后：
  - 调用 Rust 命令 `set_pet_size(level)` 调整 pet 窗口尺寸（`win.setSize`）。
  - 重新夹取位置（`clampPetPosition`）防出屏。
  - mascot SVG/SPRITE_SIZE 随新尺寸渲染。
  - 持久化到 `settingsStore.petSize`。
- **R3 持久化与还原**：`petSize: 'small'|'medium'|'large'`（默认 `'medium'`）。应用启动时 PetApp mount effect 按 `petSize` 调用 `set_pet_size` 还原。
- **R4 跨窗口同步**：主窗口设置面板改尺寸 → emit `pet://size-changed` → pet 窗口监听并应用（参考 `pet://icon-changed` 模式）。
- **R5 pet-panel 锚点适配**：`computePanelPosition` 与 `openOrTogglePetPanel` 中硬编码的 96 改为读取当前 `petSize` 对应像素值。
- **R6 契约同步**：
  - `PetContextMenu.tsx`：`PetMenuAction` 新增 `'hide-pet'` 与 `'set-pet-size'`（payload 带尺寸）；`PET_NATIVE_MENU_ACTIONS` 加 `'hide-pet'`。
  - `lib.rs:32-47` `pet_ctx_menu_action`：识别新 id。
  - `App.tsx:258-308` `handleAction`：新增分支（`hide-pet` 复用 disable 逻辑；`set-pet-size` 改设置 + 调 Rust + 夹取位置）。
  - `PetContextMenu.test.tsx` 契约测试更新。

## Acceptance Criteria

- [ ] 右键桌宠弹出原生菜单，顺序如 D5，含「隐藏桌宠图标」与「桌宠大小 ▶」子菜单。
- [ ] 点「隐藏桌宠图标」→ 桌宠消失，去 Settings → 桌宠 tab 可重新开启（同 disable-pet 行为）。
- [ ] 在子菜单中选小/中/大，桌宠立即缩放到 64/96/128，mascot 图标同步缩放，仍全部可见（位置夹取）。
- [ ] 重启应用，尺寸保持上次选择；隐藏状态保持。
- [ ] pet-panel 在三种尺寸下均能正确锚定在桌宠旁。
- [ ] 主窗口设置面板改尺寸（如未来加），pet 窗口实时响应（跨窗口同步）。
- [ ] 现有 4 个菜单项仍可用。
- [ ] `PetContextMenu.test.tsx` 契约测试更新并通过；Rust + 前端 lint/typecheck/build 绿。

## Definition of Done

- Rust + 前端 lint / typecheck / build 绿。
- macOS 手测：两项功能正确，尺寸切换无出屏，持久化正确，pet-panel 锚点正确。
- 契约测试更新并通过。

## Technical Approach

### Rust 端

- `commands.rs`：
  - 新增菜单 ID 常量：`PET_CTX_MENU_HIDE_PET`、`PET_CTX_MENU_SIZE_SMALL/MEDIUM/LARGE`。
  - `pet_show_context_menu`：构建新增 `MenuItem`（隐藏）+ `Submenu`（桌宠大小，含三个 `CheckMenuItem`，当前项预选中）。读 `petSize` 与 `petModeEnabled` 以决定预选中状态——通过 `app.state()` 或 `app.try_state` 读 Rust 侧 state cell（由前端 emit 事件同步）。
  - 新增命令 `set_pet_size(level: String)`：`win.setSize(Size::Logical(...))` 并返回新尺寸。
- `lib.rs`：
  - `pet_ctx_menu_action`：新增 id → action 映射（`hide-pet` / `set-pet-size-small|medium|large`，或统一 `set-pet-size` 带 payload）。
  - `on_menu_event`：emit `pet://menu-action` payload 携带 action 与可选 size。

### 前端

- `PetContextMenu.tsx`：
  - `PetMenuAction` 加 `'hide-pet' | 'set-pet-size'`（后者 payload `{ size: 'small'|'medium'|'large' }`）。
  - `PET_NATIVE_MENU_ACTIONS` 加 `'hide-pet'`、`'set-pet-size'`。
- `settingsStore`：
  - 新增 `petSize: 'small'|'medium'|'large'`（默认 `'medium'`）+ `setPetSize(size)` action。
  - 持久化字段加入 `debouncedPersist`。
- `App.tsx` `handleAction`：
  - `case 'hide-pet'`：与 `disable-pet` 同逻辑（提取共用函数）。
  - `case 'set-pet-size'`：`setPetSize(size)` → `invoke('set_pet_size', { level: size })` → emit `pet://size-changed`（pet 窗口监听）→ 夹取位置。
- `PetApp.tsx`：
  - `SPRITE_SIZE` 改为从 `petSize` 计算（64/96/128）。
  - mount effect 增加 `set_pet_size` 调用还原尺寸。
  - 新增 `pet://size-changed` 监听器，更新 `SPRITE_SIZE` + 重新夹取位置（参考 `pet://icon-changed` listener）。
  - `openOrTogglePetPanel` 与 `computePanelPosition` 中的 96 改为读取当前 `petSize` 对应像素。
- `petPosition.ts`：导出 `PET_SIZE_TO_PX: Record<PetSize, number>` 与 `PET_SIZE_PX_DEFAULT`；`computePanelPosition` 接收 petSize 参数。
- `PetMascot.tsx`：SVG width/height 72 改为按 `petSize` 计算（或交由 CSS 控制，确保 SVG 缩放正确）。
- `PetContextMenu.test.tsx`：断言新 action 集合与 native menu 子集一致。

## Decision (ADR-lite)

**Context**：右键菜单已存在 4 项英文功能；用户要求新增「隐藏图标」与「大小调整」。

**Decision**：
- 隐藏项与现有 Disable 共存、行为一致、仅标签中文化（用户明确选择，接受冗余）。
- 尺寸用子菜单 + 单选 CheckMenuItem，值 64/96/128（沿用前序存档 PRD）。
- 仅新项中文化，现有项保留英文。

**Consequences**：
- 菜单存在两个功能相同的项（隐藏桌宠图标 / Disable Pet Mode）——用户明确接受此冗余。
- 尺寸切换需联动位置夹取、pet-panel 锚点、跨窗口同步，改动面涉及 Rust + 前端 + 设置 + 测试。
- `petSizeVersion`（迁移计数器）与 `petSize`（用户选择）并存，前者保留用于未来默认尺寸迁移。

## Out of Scope

- 「置顶切换」（前序存档 PRD 的 R1）— 不在本任务范围。
- 「更换图标」「重置位置」「开机自启」「退出应用」等其它菜单项。
- 自定义尺寸输入 / 滑块。
- 「Quit App」菜单项。
- 现有 4 项菜单标签的本地化（仅新项中文化）。
- 系统托盘图标（用于隐藏后唤回）——隐藏项仍走 Settings 重新开启流程。

## Technical Notes

- 原生菜单构建：`commands.rs:597-650`（`pet_show_context_menu`）。
- ID → action 映射：`lib.rs:32-47`（`pet_ctx_menu_action`）。
- 前端契约：`PetContextMenu.tsx`（`PetMenuAction` 联合类型）。
- 主窗口监听：`App.tsx:258-308`（`handleAction`）+ `App.tsx:324`（`pet://menu-action` listener）。
- 位置夹取：`PetApp.tsx:446-567`（`clampPetPosition`）+ `petPosition.ts`。
- 设置存储：`settingsStore`（新增 `petSize`）。
- Tauri v2 menu API：`tauri::menu::{CheckMenuItem, Submenu, MenuItem, PredefinedMenuItem}`。
- 跨窗口同步模式：参考 `pet://icon-changed`（`PetApp.tsx:667-692`）。

## Research References

- 前序存档 PRD（git `d02f143` `.trellis/tasks/archive/2026-07/07-08-desktop-pet-right-click-menu/prd.md`）— 大小调整方案可借鉴，隐藏项是新需求。
