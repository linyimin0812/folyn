# Split SettingsPage god file

## Goal

`apps/desktop/src/components/pages/SettingsPage.tsx` (1468 行) 把 5 个独立设置组件 + 共享原语全内联在一个文件里，违反仓库既有约定（`components/settings/` 下每个 tab 一个 `XxxSettings.tsx`，如 `PluginsSettings.tsx` / `VoiceSettings.tsx`）。拆分以恢复约定、降低单文件认知负荷，并顺手解决 `VoiceSettings.tsx:63-68` 标注的 `ShortcutEditor` 复用债。

## What I already know

仓库既有约定（`components/settings/` 已存在）：
- `PluginsSettings.tsx:221` — `export function PluginsSettings()`
- `VoiceSettings.tsx:148` — `export function VoiceSettings()`
- 都是命名导出、无 props、由 `SettingsPage` 按 `settingsTab` 渲染。

`SettingsPage.tsx` 当前内联的组件边界（行号）：
- `ShortcutEditor` — 28-133（被 `SettingsPage` 和 `VoiceSettings` 都想用但用不了，见下）
- `NAV_GROUPS` — 135-153（导航定义）
- `Toggle` — 155-161（13 处 SettingsPage 用 + VoiceSettings 用 → 必须共享）
- `FileTemplatesSettings` — 164-277
- `FORMAT_OPTIONS` 常量 — 278-298（SkillsSettings 专用）
- `SkillsSettings` — 300-678
- `PetSettings` — 679-935
- `CustomIconPreviewProps` interface — 936-940
- `CustomIconPreview` — 941-969（仅 `PetSettings:897` 用，28 行，跟着 PetSettings 走作私有 helper）
- `NotificationsSettings` — 970-1002
- `SettingsPage`（外壳 + General tab 内联）— 1003-1468

共享原语依赖实证：
- `Toggle`：SettingsPage 用 13 处，`settings/VoiceSettings.tsx:248,252` 用 → 跨文件共用，必须抽到共享模块。
- `ShortcutEditor`：SettingsPage 用（`togglePetPanel` 等快捷键）；`VoiceSettings.tsx:63-68` 注释明确说"tied to prefsStore.updateShortcut（keys-array shape），没法复用 voiceStore 的 string field，所以 VoiceSettings 重新写了一份 `VoiceHotkeyRecorder`（70-146，~30 行重复）"。

`ShortcutEditor` vs `VoiceHotkeyRecorder` 差异（决定泛化形状）：
- keyshape：ShortcutEditor → 符号数组 `['⌘','Shift','P']`，持久化 `prefsStore.updateShortcut(shortcutId, keys)`；Voice → accelerator 字符串 `'Cmd+Shift+V'`，持久化 `voiceStore.setGlobalHotkey`。
- Esc：Voice 有 Esc-clears；Shortcut 无。
- OS re-register：Shortcut 仅 `shortcutId === 'togglePetPanel'` 调 `pet_panel_set_shortcut`；Voice 总是调 `voice_set_global_hotkey`。
- 冲突超时：Shortcut 有 2.5s `conflictHint`；Voice 无。
- 展示：Shortcut 渲染键码 chip 数组 + 冲突提示 span；Voice 渲染单个 accelerator 字符串 + "未设置"空态。

## Requirements

1. 将 4 个内联设置组件各抽到 `apps/desktop/src/components/settings/<Name>Settings.tsx`，命名导出、无 props（与 `PluginsSettings`/`VoiceSettings` 一致）：
   - `FileTemplatesSettings.tsx`
   - `SkillsSettings.tsx`（含 `FORMAT_OPTIONS`）
   - `PetSettings.tsx`（含私有 helper `CustomIconPreview` + 其 props interface）
   - `NotificationsSettings.tsx`
2. 抽共享原语到 `apps/desktop/src/components/settings/primitives.tsx`（命名待定，见 Decision）：
   - `Toggle`（被外壳 + 4 抽出组件 + VoiceSettings 共用）
   - `NAV_GROUPS`（外壳路由用）
3. 泛化快捷键录制为 `useHotkeyRecording` hook（`components/settings/useHotkeyRecording.ts`），把 `ShortcutEditor` 和 `VoiceHotkeyRecorder` 的共享行为（recording 态、keydown 捕获监听挂载/卸载、click-outside 取消、可选冲突超时）抽出；两组件各保留自己的渲染和 `onCapture`（持久化 + keyshape 转换 + OS re-register）+ 可选 `onEscape`。
   - hook 签名草案：`useHotkeyRecording(onCapture: (e: KeyboardEvent) => void, opts?: { onEscape?: () => void; conflictTimeoutMs?: number }) => { recording, start, containerRef, conflictHint }`
   - 录制态 hook 不持有键码/keyshape——keyshape 转换与持久化全在调用方 `onCapture` 内，hook 只管"录到 keydown 就回调 + 取消录制"。`onEscape` 触发时也调，调用方决定清不清。
   - `ShortcutEditor` 改造成调用 hook 的薄壳，保留 ⌘ 符号数组 keyshape + `pet_panel_set_shortcut` re-register + 冲突提示渲染。
   - `VoiceHotkeyRecorder` 改造成调用 hook 的薄壳，保留 accelerator 字符串 keyshape + `voice_set_global_hotkey` re-register + Esc 清除 + "未设置"空态。
4. `SettingsPage.tsx` 外壳保留 General tab 内联（行 ~1130-1300 那堆 Toggle 行）+ 路由逻辑；从新文件 import 4 个组件 + primitives。拆完外壳约 ~465 行（纯路由壳 + 一个内联 tab），可接受——不在本任务范围进一步拆。

## Acceptance Criteria

- [ ] `SettingsPage.tsx` 不再内联 `FileTemplatesSettings`/`SkillsSettings`/`PetSettings`/`NotificationsSettings`/`CustomIconPreview`/`Toggle`/`NAV_GROUPS`/`ShortcutEditor`。
- [ ] `components/settings/` 下新增 4 个 `<Name>Settings.tsx` + `primitives.tsx` + `useHotkeyRecording.ts`，导出形状与既有 `PluginsSettings`/`VoiceSettings` 一致。
- [ ] `VoiceSettings.tsx` 的 `VoiceHotkeyRecorder` 改为调用 `useHotkeyRecording`，删除 `VoiceSettings.tsx:63-68` 标注的复用债注释。
- [ ] `ShortcutEditor` 改为调用 `useHotkeyRecording`，行为零回归（pet_panel 快捷键录制 + 冲突提示仍工作）。
- [ ] `pnpm typecheck`（或等价）绿。
- [ ] `pnpm test`（vitest，desktop project）绿——既有测试不回归。无新测试要求（纯机械搬迁 + hook 抽取，hook 无独立测试；若 hook 复杂度值得，留一个 `useHotkeyRecording.test.ts` 自检——见 Definition of Done）。
- [ ] 手测路径（macOS）：设置 → 快捷键 → 录制 `togglePetPanel` → 验证桌宠面板全局热键生效；设置 → 语音输入 → 录制全局热键 → Esc 清除。

## Definition of Done

- typecheck + vitest 绿。
- `useHotkeyRecording` 含一个最小自检（`assert`-based `demo()` 或一个小 `test_*.ts` 验证 keydown → onCapture、Esc → onEscape、click-outside → 取消录制）。trivial 的纯展示搬迁不需要测试。
- 行为零回归：pet 快捷键 + voice 热键录制 + Esc 清除 + 冲突提示。
- 不改任何 store shape、不改 Tauri 命令、不改 CSS class。

## Technical Approach

搬迁是纯机械 move + import 调整。`ShortcutEditor` 泛化是唯一的真实设计点：

**hook 抽取边界**：`useHotkeyRecording` 持有 `recording`、`containerRef`、`conflictHint`，挂载 keydown(capture=true)/click-outside/可选 2.5s 超时三个 effect，录到非纯修饰键的 keydown 时调 `onCapture(e)` 然后 `setRecording(false)`，Esc 时调 `onEscape?.()`。keyshape 转换（`['⌘','Shift','P']` vs `'Cmd+Shift+V'`）、持久化、OS re-register 全在调用方——hook 不碰这些，避免 keyshape 漏到通用层。

**为什么不抽 `<HotkeyRecorder>` 组件**：两处展示差异大（键码 chip 数组 + 冲突提示 vs 单字符串 + 空态 + Esc 提示），render-prop/slot 比两个薄壳 + 一个 hook 更重。行为共享、展示专用 = ponytail 阶梯最高一档。

**文件落点**：
- `components/settings/primitives.tsx` — `Toggle` + `NAV_GROUPS`（`NAV_GROUPS` 引用 `SettingsTab` 类型 from `navStore`，import 即可）。
- `components/settings/useHotkeyRecording.ts` — hook。
- `components/settings/ShortcutEditor.tsx` — 薄壳，调用 hook。
- 4 个 `<Name>Settings.tsx` — 各自组件。
- `VoiceHotkeyRecorder` 留在 `VoiceSettings.tsx` 内（它是 VoiceSettings 私有，跟 `CustomIconPreview` 之于 `PetSettings` 同理），改成调 hook。

## Decision (ADR-lite)

**Context**: `SettingsPage.tsx` 1468 行 god file，4 个 tab 组件 + 共享原语 + `ShortcutEditor` 内联；`VoiceSettings.tsx` 因 `ShortcutEditor` 耦合 prefsStore keyshape 被迫重写一份 recorder（自标技术债）。

**Decision**:
1. 4 组件 + `Toggle`/`NAV_GROUPS` 机械搬到 `components/settings/`，对齐既有约定。
2. 抽 `useHotkeyRecording` hook（行为层），`ShortcutEditor` + `VoiceHotkeyRecorder` 各自改薄壳调用，keyshape/持久化/OS re-register 留在调用方。
3. 不抽 `<HotkeyRecorder>` 组件（展示差异 > 行为共享，组件化会比 hook 重）。
4. 不拆 SettingsPage 外壳的 General tab 内联（范围之外，外壳 ~465 行可接受）。

**Consequences**:
- 删除 ~30 行 voice recorder 重复 + 解除 `VoiceSettings.tsx:63-68` 技术债注释。
- 新增 6 个文件，但每个 < 400 行，符合既有 settings/ 约定。
- hook 是新的共享边界，但有两个具体消费者（非投机），第三消费者出现时直接复用。
- 风险：录制行为回归（keydown capture 时序、click-outside、超时）——靠手测 + hook 自检覆盖。

## Out of Scope

- 拆 `SettingsPage` 外壳的 General tab 内联为 `GeneralSettings.tsx`（方案 B，本任务选 A）。
- 其他 god 文件（`ErDiagramX6.tsx`、`MindMapCanvas.tsx`、`ClipsPanel.tsx`、`commands.rs` 等）——见架构评估其余 ROI 项。
- 三处 AI 聊天面 `ToolCallBlock`/`FileIcon` 共享层——另一任务。
- store shape / Tauri 命令 / CSS 改动。

## Technical Notes

- `SettingsPage.tsx` 入口渲染逻辑在 1003-1468；`NAV_GROUPS` 在外壳 `:1074` 渲染。
- `isTauri()` 守卫在两处 recorder 都用——hook 不调 invoke，调用方在 `onCapture` 内按需调。
- `keyToSymbol`（`ShortcutEditor` 内用）和 `shortcutAccelerator.keysToAccelerator`（re-register 用）的位置需在搬迁时确认 import 路径（前者可能是本文件私有 helper，需一并处理）。
- vitest workspace：desktop project 配置在 `vitest.workspace.ts`；既有 settings/ 组件无配对测试，本次不补组件测试（纯搬迁），仅 hook 自检。
