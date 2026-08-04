# 语音全局热键在快捷键页显示

## Goal

语音输入设置页的全局热键（`voiceStore.globalHotkey`，accelerator 字符串如 `Cmd+Shift+V`）目前只在语音设置页里能看/改。用户希望它也出现在「快捷键」设置页的列表中，作为一条同行可见的快捷键条目。

## What I already know

- 快捷键页：`SettingsPage.tsx:241-258`，从 `prefsStore.shortcuts` 渲染 `{id, name, keys: string[]}` 数组，每行用 `ShortcutEditor` 录入，底部一个 `Reset` 按钮调 `resetShortcuts()`。
- `prefsStore.shortcuts` 默认条目 `DEFAULT_SHORTCUTS`（`prefsStore.ts:13-28`）：8 条编辑器键位 + 1 条全局 OS 快捷键 `togglePetPanel`。
- `ShortcutEditor`（`ShortcutEditor.tsx:24-79`）：录入符号数组（`['⌘','Shift','Q']`），`shortcutId === 'togglePetPanel'` 时额外调 `pet_panel_set_shortcut` Rust 命令重注册。
- 语音热键：`voiceStore.globalHotkey` 是 accelerator 字符串（`Cmd+Shift+V`），编辑由 `VoiceSettings.tsx` 内联的 `VoiceHotkeyRecorder` 负责，重注册调 `voice_set_global_hotkey` Rust 命令；Esc 清空。
- 两种 keyshape 不同：`prefsStore` 用符号数组，`voiceStore` 用 accelerator 字符串。`VoiceHotkeyRecorder` 与 `ShortcutEditor` 共用 `useHotkeyRecording` 但捕获逻辑各自实现。
- i18n：`settings:shortcuts.items.*` 已有 8 条 + togglePetPanel；语音热键 i18n 在 `settings:voice.globalHotkey.label`。

## Feasible approaches

**Approach A: 在快捷键页追加一条语音热键行（复用 `VoiceHotkeyRecorder`）**（Recommended）

- 在 `SettingsPage.tsx` shortcuts tab 的 `{shortcuts.map(...)}` 之后追加一行：label = `t('settings:voice.globalHotkey.label')`，右侧直接渲染 `<VoiceHotkeyRecorder />`（导出它即可，目前在 `VoiceSettings.tsx` 内部定义）。
- 不动 store：语音热键仍只存在 `voiceStore.globalHotkey`，accelerator 字符串 keyshape 保持。
- 不动 `ShortcutEditor`、`prefsStore.shortcuts`、`resetShortcuts()`。
- 复用现成 UI（`sk-keys` 风格、`useHotkeyRecording` 录入、Esc 清空、`voice_set_global_hotkey` 重注册）—— `VoiceHotkeyRecorder` 已包含这些。
- Pros：最小改动（导出 + 1 行 JSX）；无 keyshape 转换；无迁移；语音热键仍可在语音页改。
- Cons：快捷键页的 Reset 按钮不会重置语音热键（用户预期可能被打破 —— 但 Reset 按钮文案是「恢复默认」，语音热键默认空，不重置也算合理）；行内编辑器视觉与其它行略有差异（`VoiceHotkeyRecorder` 单 span 显示 accelerator，而非 `ShortcutEditor` 的多 key span）。

**Approach B: 把语音热键迁移进 `prefsStore.shortcuts`**

- 给 `DEFAULT_SHORTCUTS` 加 `{ id: 'voiceGlobalHotkey', name: '语音输入', keys: ['⌘','Shift','V'] }`。
- `ShortcutEditor` 扩展：`shortcutId === 'voiceGlobalHotkey'` 时调 `voice_set_global_hotkey` 而非 `pet_panel_set_shortcut`。
- 持久化迁移：旧 `voiceStore.globalHotkey` 字符串 → 反解析成符号数组存入 `prefsStore.shortcuts`。
- 语音页移除自己的热键行（或保留镜像读取）。
- Pros：统一管理；Reset 覆盖语音；行视觉一致。
- Cons：多文件改动 + 迁移代码 + accelerator↔symbol 双向转换助手；风险面大；ponytail 反对。

**Approach C: 在快捷键页追加只读行 + 跳转链接**

- 行只显示当前 accelerator，点击跳到语音设置页。
- Pros：极小。
- Cons：不能就地编辑，UX 差。

## Decision (ADR-lite)

**Context**: 语音全局热键目前只在语音设置页可见/可改，用户希望它也出现在快捷键页列表中。

**Decision**: Approach A —— 在 shortcuts tab 追加一行，复用 `VoiceHotkeyRecorder`。导出组件 + 在 `SettingsPage.tsx` shortcuts 块加一行 JSX。

**Consequences**: 不动 store、不迁移 keyshape、不动 `ShortcutEditor`。快捷键页 Reset 仍只重置 `prefsStore.shortcuts`（语音热键默认空，不重置合理）。行内编辑器视觉与其它行略有差异（accelerator 单 span vs 多 key span），但已与语音页保持一致，可接受。


## Out of Scope

- 重写 `ShortcutEditor` 与 `VoiceHotkeyRecorder` 的合并（两种 keyshape 不强制统一）。
- 修改快捷键 Reset 按钮行为去覆盖语音热键。
- 修改 i18n 文件结构（复用 `settings:voice.globalHotkey.label`，不再加 `settings:shortcuts.items.voiceGlobalHotkey`）。

## Acceptance Criteria

- [ ] 快捷键设置页可见一条「语音输入」热键行，显示当前 `voiceStore.globalHotkey`。
- [ ] 点击该行能就地录入新组合并立即生效（系统级重注册）。
- [ ] Esc 清空语音热键（与语音页行为一致）。
- [ ] 在快捷键页改了热键后，回到语音页看到的是同一个最新值（共享 store）。
- [ ] 快捷键页的 Reset 按钮仍只重置 `prefsStore.shortcuts`，不影响语音热键。

## Technical Notes

- 需在 `VoiceSettings.tsx` 把 `VoiceHotkeyRecorder` 从内部 `function` 改为 `export`，或在 `ShortcutEditor.tsx` 复用同样的 capture 逻辑。 ponytail：直接 export。
- 行布局沿用快捷键页 `tr flex items-center justify-between py-3.5 border-b border-brd` + `tr-info` + 右侧 recorder。
- 行位置：放在 `{shortcuts.map(...)}` 之后、Reset 按钮之前，作为「其它全局热键」分组（视觉上和 togglePetPanel 同属全局类，不强行分组）。
