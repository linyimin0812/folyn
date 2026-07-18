# unify-settings-page-fonts

## Goal

参照外观配置页（appearance tab）的字体用法，统一其他设置子页面的字体：可编辑文本输入控件用 `font-ui` + `text-[length:calc(var(--ui-font-size)-2px)]`，纯展示的代码/ID/版本/快捷键用 `font-mono`。

## What I already know

* 外观页（`SettingsPage.tsx` appearance tab）所有 input/textarea/select 用 `font-ui` + `text-[length:calc(var(--ui-font-size)-2px)]`
* 其他子页面混用 hardcoded `text-xs`（12px 固定）和 `font-mono`
* 不一致点：
  * `FileTemplatesSettings.tsx:84, 102` — input/textarea 用 `text-xs` + `font-mono`（font 已修，size 未修）
  * `SkillsSettings.tsx:251, 262, 271, 280, 324, 334, 344` — 7 个 input/textarea 用 `text-xs`（其中 4 个 font 已改 ui，但 size 仍固定）
  * `VoiceSettings.tsx:203` — inline `fontSize: 'calc(var(--ui-font-size) - 2px)'`（已一致，不动）
  * `SettingsPage.tsx:160` — textarea 已有 `text-[length:calc(var(--ui-font-size)-2px)]`，本次任务上轮已去 inline fontFamily（一致）
* 应保留固定 size 的元素：
  * 按钮 `text-[11px]`（外观页按钮也用 `text-[11px]`，是约定）
  * 徽章/版本号/快捷键键位 `text-[10px]` / `text-[10.5px]`（小尺寸展示，约定）
  * 错误提示 `text-[11px]` / `text-[10.5px]`（约定小尺寸）

## Requirements

* 所有 `<input>`、`<textarea>`、`<select>`（用户键入文本的控件）统一用：
  * `font-ui`
  * `text-[length:calc(var(--ui-font-size)-2px)]`（替换 `text-xs`）
* 移除可编辑控件上的 inline `fontFamily: var(--font-mono)` 覆盖（上轮已做，本轮复查）
* 纯展示的代码/ID/版本/快捷键保持 `font-mono`，size 不变（badge 风格）
* 按钮、徽章、错误提示保持固定小尺寸不动

## 改动清单

| 文件:行 | 改动 |
|---|---|
| FileTemplatesSettings.tsx:84 | input `text-xs` → `text-[length:calc(var(--ui-font-size)-2px)]` |
| FileTemplatesSettings.tsx:102 | textarea `text-xs` → `text-[length:calc(var(--ui-font-size)-2px)]` |
| SkillsSettings.tsx:251, 262, 271, 280, 324, 334, 344 | 7 个 input/textarea `text-xs` → `text-[length:calc(var(--ui-font-size)-2px)]` |

## Acceptance Criteria

* [ ] 所有可编辑输入控件字号跟随 `--ui-font-size` 变化
* [ ] UI 字号从 14px 改为 16px 时，所有设置子页输入控件字号一致放大
* [ ] 按钮 / 徽章 / 错误提示字号保持不变（约定）
* [ ] `pnpm tsc --noEmit` 通过

## Out of Scope

* 编辑器（CodeMirror）字体
* 设置页之外的输入控件
* 按钮 / 徽章 / 快捷键键位的固定小尺寸（与外观页约定一致）
* 字段标签（label）字号（范围扩大太散，留作后续）

## Technical Notes

* 外观页 reference：`SettingsPage.tsx:139-145` (select)、`158` (textarea)、`209, 276, 339, 351, 363, 394` (input)
* `--ui-font-size` CSS 变量由 appearance 设置控制，可选 12/14/16px
