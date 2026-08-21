# delete/rename 操作的乐观树更新

## Goal

把上一任务的乐观更新模式扩展到 `deleteFile` / `deleteDir` / `renameFile`，消除按 Enter / 确认后的卡顿。

## What I already know

- `vaultStore.ts:470-490` 三个函数都在 manager 调用后 `await refreshFileTree()`，同 createFile 旧版根因。
- 上次任务已加 `insertEntry` 纯函数到 `treeUtils.ts`，本次补 `removeEntry` / `renameEntry`。
- `renameFile` 通过 `manager.rename` 支持文件和目录重命名；目录重命名需要递归改写子条目 path。
- SidebarActions 已在 delete 前关闭相关 tab，rename 后由 editor 流处理 path 更新（不在本任务范围）。
- 测试 `vaultStore.test.ts:221` 只校验 `manager.rename` 调用，对 `fileTree` 无断言；delete 测试同样只校验 delegation。

## Requirements

- `deleteFile` / `deleteDir` 调用后，对应条目立即从文件树移除，无需等待全量刷新。
- `renameFile` 调用后，条目立即在新路径出现、旧路径消失；目录重命名时子条目 path 同步前缀替换。
- 后台 `void refreshFileTree()` 兜底纠偏。
- 不动 `moveFiles` / `copyPath` / `copyExternalFileToVault`（用户未提及，复杂度更高，留待后续）。

## Acceptance Criteria

- [ ] 删除文件/目录后，行立即从侧栏消失，无卡顿。
- [ ] 重命名后，行立即在新名称/位置出现。
- [ ] 目录重命名后，展开时子文件路径正确（path 前缀已替换）。
- [ ] `vaultStore.test.ts` 现有测试通过；新增 `removeEntry` / `renameEntry` 单测通过。

## Technical Approach

1. `treeUtils.ts` 新增：
   - `removeEntry(tree, path)` — 移除指定 path 的条目；未找到则原样返回引用。
   - `renameEntry(tree, oldPath, newPath)` — 移除旧条目，按 newPath 插入新条目；type 保留；若为目录，递归把 `oldPath/...` 子 path 前缀替换为 `newPath/...`。
2. `vaultStore.ts`：
   - `deleteFile`: `suppressWatcherFor(filePath)` → `set(removeEntry)` → `void refreshFileTree()`。
   - `deleteDir`: 同上。
   - `renameFile`: `suppressWatcherFor(oldPath)` + `suppressWatcherFor(newPath)` → `set(renameEntry)` → `void refreshFileTree()`。

## Out of Scope

- `moveFiles`（批量 + tab 路径更新，复杂度不同，单独任务处理）。
- `copyPath` / `copyExternalFileToVault`。
- rename 后 editor tab 的 path 同步（moveFiles 已有该逻辑，rename 单条路径由 editor 流处理）。

## Technical Notes

- `apps/desktop/src/store/vaultStore.ts:470-490`
- `apps/desktop/src/utils/treeUtils.ts`（在 `insertEntry` 下方追加）
- `apps/desktop/src/utils/fileWatcher.ts:12-15`
