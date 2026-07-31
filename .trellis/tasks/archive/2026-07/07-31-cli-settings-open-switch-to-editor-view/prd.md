# CLI 设置页：打开配置文件后切到编辑器视图

## Goal

上一版点击路径链接能成功 `openFile`，但用户仍停留在设置页（tab 创建了但视图没切）。需要在 `openAdapterSettings` 成功后调用 `useNavStore.setCurrentPage('editor')`，让用户立刻看到编辑器里的配置文件内容。

## Root Cause

`editorIoService.openFile` 只设置 `activeTabId`、创建 ext tab，**不**主动切换 `navStore.currentPage`。仓库里其它入口（App.tsx:504 拖拽、commandRegistry.ts:116 命令面板）都在 `openFile` 之后显式 `setCurrentPage('editor')`。`CliSettings.tsx` 漏了这一步。

## Requirements

- `CliSettings.tsx::openAdapterSettings` 在 `await openFile(path, basename)` 成功返回后调用 `useNavStore.getState().setCurrentPage('editor')`。
- `createAdapterSettings` 同样在 `openFile` 成功后切到 editor。
- 失败 / missing 路径不切（保持在 settings 页，让用户看到 inline 提示）。

## Acceptance Criteria

- [ ] 点 claude/pi 配置路径链接 → 立即切到编辑器视图，活动 tab 是 `ext:~/...`。
- [ ] 不存在 → inline 提示 + 创建按钮 → 点创建 → 写模板 + 切到编辑器。
- [ ] typecheck + cli-adapter 单测全绿。

## Out of Scope

- 不改 `editorIoService.openFile` 全局行为（保持"不主动切页"的契约）。
- 不改其它 openFile 调用点。

## Technical Notes

- 文件：`apps/desktop/src/components/settings/CliSettings.tsx`。
- 引入 `useNavStore` from `@/store/navStore`。
