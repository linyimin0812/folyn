# editor-autosave-toggle-ignored

## Goal

修复 autoSave 开关关闭后未保存圆点仍自动消失的 bug：`updateTabContent` 无条件触发防抖自动保存，未读取 `editorPrefsStore.autoSave` 偏好。

## Root Cause

- `editorStore.ts:175` `updateTabContent` 调用 `scheduleAutoSave(tabId, ...)` 时未检查 autoSave 偏好
- 1s 防抖到期后 `saveFileIo` 写盘并设置 `isDirty: false`（`editorIoService.ts:230`）
- 因此即便用户关闭 autoSave，圆点也会在 ~1s 后消失

## Requirements

- `updateTabContent` 仅当 `useEditorPrefsStore.getState().autoSave === true` 时才调用 `scheduleAutoSave`
- `isDirty: true` 的设置保持不变（内容已变，仍需标记未保存）
- 手动 Cmd+S 流程不受影响（直接调用 `saveFile`，不经防抖路径）

## Acceptance Criteria

- [ ] 关闭 autoSave 后编辑文档：圆点保持显示，1s/5s/10s 后仍不消失
- [ ] 开启 autoSave 后编辑文档：圆点 ~1s 后消失（原行为）
- [ ] 切换 autoSave 开关无需重新打开 tab 即时生效
- [ ] 手动 Cmd+S 仍能保存并清圆点

## Technical Approach

`editorStore.ts:165-176` 在 `scheduleAutoSave(...)` 调用外包一层 `if (useEditorPrefsStore.getState().autoSave)`。读取 getState() 避免引入 store 订阅循环。

## Out of Scope

- 自动保存延迟可配置化
- 已打开 tab 的 pending 防抖在关闭开关后的行为（当前 timer 仍会跑完，仅影响 1s 内已键入的内容）

## Technical Notes

- 偏好 store：`apps/desktop/src/store/editorPrefsStore.ts:22,45,54`（字段 `autoSave: boolean`，默认 `true`）
- 调用点：`apps/desktop/src/store/editorStore.ts:175`
- 清 dirty 点：`apps/desktop/src/services/editorIoService.ts:230`
