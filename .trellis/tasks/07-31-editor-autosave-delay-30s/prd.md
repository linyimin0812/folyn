# editor-autosave-delay-30s

## Goal

修复 autoSave 延迟与 i18n 描述不符的 bug：设置页描述"每 30 秒自动保存当前文档"/"Auto-save the current document every 30s"，但实际 `AUTO_SAVE_DELAY_MS = 1000`（1 秒）。让代码兑现描述承诺的 30 秒。

## Root Cause

- `apps/desktop/src/store/editorAutoSave.ts:4` 硬编码 `const AUTO_SAVE_DELAY_MS = 1000`
- i18n 文案承诺 30s：`apps/desktop/src/i18n/locales/{en,zh}/settings.json:103`
- 用户开了 autoSave 后看到圆点 1s 后消失，与"30 秒"预期不符

## Requirements

- `AUTO_SAVE_DELAY_MS` 改为 30000
- i18n 文案不变（仍描述 30s，与实现一致）
- 手动 Cmd+S 与关闭 autoSave 的行为不受影响（上一任务已修复 gate）

## Acceptance Criteria

- [ ] 开启 autoSave 后编辑文档：圆点保持 ~30s 后才消失（原 1s）
- [ ] 关闭 autoSave 后编辑文档：圆点持续不消失（上一任务的 gate 仍生效）
- [ ] 现有 editorStore.autosave 测试仍通过（不依赖具体延迟数值）
- [ ] 连续键入时防抖仍按 trailing-edge 工作最后一次输入后 30s 保存

## Technical Approach

`apps/desktop/src/store/editorAutoSave.ts:4` 单行常量从 `1000` 改为 `30000`。`debounceByKey` 已是 trailing-edge，连续输入会重置计时器，最后一次输入后 30s 触发保存——与文案"每 30 秒"语义一致。

## Out of Scope

- 把延迟做成可配置项（用户在设置页选 1s/5s/30s）
- 替换 debounce 策略为固定间隔保存

## Technical Notes

- 常量：`apps/desktop/src/store/editorAutoSave.ts:4`
- 文案：`apps/desktop/src/i18n/locales/en/settings.json:103`、`apps/desktop/src/i18n/locales/zh/settings.json:103`
- 上一任务已加 gate：`apps/desktop/src/store/editorStore.ts:175`（`if (useEditorPrefsStore.getState().autoSave)`)
