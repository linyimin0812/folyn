# 外观页「界面字体大小」与编辑器页「字体大小」支持 8px–28px

## Goal

两处字体大小设置从固定几个选项改为支持 8px–28px 任意取值，方便用户细调。

## What I already know

* 外观页控件：`apps/desktop/src/components/pages/SettingsPage.tsx:173-179`，Select 固定 12/14/16
* 编辑器页控件：`SettingsPage.tsx:272`，Select 固定 12/13/14/16（默认 13）
* 外观 store：`appearanceStore.ts`，默认 14，写 CSS 变量 `--ui-font-size`（documentElement + App.tsx:335 内联）
* 编辑器 store：`editorPrefsStore.ts`，默认 13，CodeMirror 主题内联 fontSize（`EditorView.tsx:569`）
* 两处 hydrate 均无范围校验，脏值会原样生效

## Requirements

* 两处字体大小均为 Select 下拉，选项为 8–28px 全量（21 项）
* 外观页界面字体大小可设 8–28；编辑器页字体大小可设 8–28
* 默认值不变（14 / 13）
* hydrate/set 时 clamp 到 [8, 28]（配置文件属信任边界外输入）

## Acceptance Criteria

* [x] 外观页 Slider 拖动即改 `--ui-font-size` 并持久化
* [x] 编辑器页 Slider 拖动即改 CodeMirror 字号并持久化
* [x] 脏配置（如 fontSize: 999 或 0）被 clamp 回 [8, 28]
* [ ] UI 视觉验证（滑块样式），需用户在应用内确认

## Decision (ADR-lite)

* 控件形态：初版用 Slider，用户反馈后改回 Select（8–28px 全量选项），沿用既有 `settings-select` 样式

## Out of Scope

* 其他设置项范围调整

## Technical Notes

* 见上方文件与行号；无既有 slider 组件可复用（待确认 UI 库）
