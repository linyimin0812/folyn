# unify-settings-page-fonts

## Goal

参照外观配置页（appearance tab）的字体用法，统一其他设置子页面的字体：可编辑文本输入控件用 `font-ui`，纯展示的代码/ID/版本/快捷键 用 `font-mono`，消除 `font-mono` 误用和 inline `fontFamily` 覆盖。

## What I already know

* 外观页（`SettingsPage.tsx` appearance tab）所有 input/textarea/select 用 `font-ui`
* 外观页内纯展示（CLI adapter displayName L266、版本号 L470）用 `font-mono` / inline `fontFamily: var(--font-mono)`
* 不一致点：
  * `SettingsPage.tsx:160` — excludePatterns textarea 有 `font-ui` class 但 inline `fontFamily: var(--font-mono)` 覆盖
  * `FileTemplatesSettings.tsx:84, 102` — 可编辑 input/textarea 用 `font-mono`
  * `SkillsSettings.tsx:251, 280, 344` — 可编辑 input/textarea 用 `font-mono`（同一表单内 L262/271/324/334 用 `font-ui`，明显不一致）
  * `VoiceSettings.tsx:203` — textarea inline `fontFamily: var(--font-mono)`
* 应保留 `font-mono` 的纯展示位：
  * `FileTemplatesSettings.tsx:61, 62, 99` — 扩展名展示
  * `SkillsSettings.tsx:24, 313` — badge / skill id 展示
  * `PluginsSettings.tsx:97, 110, 289` — version / id / 路径示例
  * `ShortcutEditor.tsx:65, 71` / `VoiceSettings.tsx:105, 107` — 快捷键展示
  * `SettingsPage.tsx:266, 470` — CLI displayName / 版本号

## Requirements

* 所有 `<input>`、`<textarea>`、`<select>`（用户键入文本的控件）统一用 `font-ui`
* 移除可编辑控件上的 inline `fontFamily: var(--font-mono)` 覆盖
* 纯展示的代码/ID/版本/快捷键保持 `font-mono`，但优先用 class 而非 inline style（一致风格）
* 不改 `font-mono` 在展示位的用法

## 改动清单

| 文件:行 | 改动 |
|---|---|
| SettingsPage.tsx:160 | 移除 textarea 的 inline `fontFamily`，保留 `font-ui` |
| FileTemplatesSettings.tsx:84, 102 | input/textarea `font-mono` → `font-ui` |
| SkillsSettings.tsx:251, 280, 344 | input/textarea `font-mono` → `font-ui` |
| VoiceSettings.tsx:203 | 移除 textarea 的 inline `fontFamily`，改用 `font-ui` class |
| SettingsPage.tsx:470 | 版本号 inline `fontFamily: var(--font-mono)` → `font-mono` class |

## Acceptance Criteria

* [ ] 所有可编辑输入控件在设置页视觉字体一致（`font-ui`）
* [ ] 无可编辑控件带 inline `fontFamily: var(--font-mono)` 覆盖
* [ ] 展示位 `font-mono` 保留
* [ ] `pnpm tsc --noEmit` 通过

## Out of Scope

* 编辑器（CodeMirror）字体 — 那是 `editorFont` 设置项，不在设置页 UI 字体范畴
* 设置页之外的输入控件（如 PetChat、CommandPalette 等）

## Technical Notes

* 外观页 reference：`SettingsPage.tsx:139-145` (select)、`158` (textarea)、`209, 276, 339, 351, 363, 394` (input)
* `font-ui` / `font-mono` 定义在 tailwind 配置（基于 CSS 变量 `--font-ui` / `--font-mono`）
