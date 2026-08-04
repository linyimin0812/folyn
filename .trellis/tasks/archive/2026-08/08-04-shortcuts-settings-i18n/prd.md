# Shortcuts Settings Page i18n

## Goal
快捷键设置页的快捷键名称当前以中文硬编码在 `prefsStore.DEFAULT_SHORTCUTS.name`，渲染于 `SettingsPage.tsx` 的 shortcuts tab。需将其切换到 i18n，与已 i18n 的 `settings:shortcuts.{title,description,reset,editor.*}` 一致。

## Scope
- `apps/desktop/src/i18n/locales/{zh,en}/settings.json`：在 `shortcuts` 下新增 `items` 对象，按 shortcut `id` 键值（save / bold / italic / strikethrough / code / link / dailyNote / togglePetPanel）。
- `apps/desktop/src/components/pages/SettingsPage.tsx:250`：渲染 `t('settings:shortcuts.items.<id>', { defaultValue: shortcut.name })` 替代 `shortcut.name`。

## Non-goals
- 不删除 `DEFAULT_SHORTCUTS` 的 `name` 字段 —— 留作 i18n 缺键 fallback，避免改动 store / 持久化 / 现有测试。
- 不重构 `ShortcutEditor`、`useHotkeyRecording`、全局快捷键 Rust 注册流程。

## Verification
- 切换语言至 en/zh，确认 8 条快捷键名称随之翻译。
- 删除任一 `items.<id>` 键，UI 应回退到 `DEFAULT_SHORTCUTS.name`（中文原值）。
