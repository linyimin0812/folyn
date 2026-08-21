# move/copy 操作的乐观树更新

## Goal

把乐观更新扩展到 `moveFiles` / `copyPath` / `copyExternalFileToVault`，消除确认后的卡顿。

## What I already know

- `vaultStore.ts:498-577` 三个函数都在最后 `await refreshFileTree()`，同此前 delete/rename 根因。
- `moveFiles` 已有 movedMap 累积 + editor tab path 前缀替换逻辑，结构清晰，复用 `renameEntry` 顺序归约即可。
- `copyPath` 文件分支：复制到新路径 → 用 `insertEntry(tree, targetPath, 'file')`。
- `copyPath` 目录分支：复制目录树 → 需要从源子树克隆（rebase path），新增 `copyEntry` 辅助。
- `copyExternalFileToVault` 写一个二进制文件到 `targetPath` → 用 `insertEntry(tree, targetPath, 'file')`。
- 上次已加 `insertEntry` / `removeEntry` / `renameEntry`；本次只补 `copyEntry`。
- `resolveCopyName` 已处理同名冲突，targetPath 一定是最终可用路径。

## Requirements

- `moveFiles` 在批量 rename 成功后，立即对每对 `[src, dest]` 应用 `renameEntry`；tab path 更新保留；后台 `void refreshFileTree()` 兜底。
- `copyPath` 文件分支：乐观 `insertEntry` 新文件行。
- `copyPath` 目录分支：乐观 `copyEntry`（克隆源子树 + path rebase）插入到 targetDir。
- `copyExternalFileToVault`：乐观 `insertEntry` 新文件行。
- `suppressWatcherFor(targetPath)` 抑制 watcher 对新路径的 modify-event 处理。
- 不破坏现有 `vaultStore.test.ts` 测试。

## Acceptance Criteria

- [ ] 批量移动后，文件立即在新位置出现、旧位置消失。
- [ ] 批量移动后，editor tab path 正确同步（已有逻辑，不回归）。
- [ ] 文件复制后，新文件行立即出现。
- [ ] 目录复制后，新目录立即出现且子条目 path 前缀正确。
- [ ] 外部文件复制到 vault 后，新文件行立即出现。
- [ ] 新增 `copyEntry` 单测覆盖：根级、嵌套、目录递归 rebase、未找到源原样返回、不 mutate。

## Technical Approach

1. `treeUtils.ts` 新增 `copyEntry(tree, srcPath, destPath)`：
   - 在 tree 中找 `srcPath` 条目（含 children）。
   - 深克隆，把所有 path 前缀从 `srcPath` 改写到 `destPath`；destName 取 `destPath` 最后一段。
   - 插入到 `destPath` 的父目录（或根）；父目录不在树中则原样返回引用。
2. `vaultStore.ts`：
   - `moveFiles`：movedMap 累积后 → tab path 更新 → `set((state) => ({ fileTree: movedMap.reduce((t, [s, d]) => renameEntry(t, s, d), state.fileTree) }))` → 对每个 dest 调 `suppressWatcherFor` → `void refreshFileTree()`。
   - `copyPath` 文件分支：`suppressWatcherFor(targetPath)` + `set(insertEntry)` → `void refreshFileTree()`。
   - `copyPath` 目录分支：`suppressWatcherFor(targetPath)` + `set(copyEntry)` → `void refreshFileTree()`。
   - `copyExternalFileToVault`：`suppressWatcherFor(targetPath)` + `set(insertEntry)` → `void refreshFileTree()`。

## Out of Scope

- `moveFiles` 批量失败回滚（已有 console.error 记录，不增强）。
- 拖拽 vs 命令面板触发路径差异（共用 `moveFiles` 入口，单一入口已覆盖）。
- 全量 `refreshFileTree` 的递归 listFiles 本身性能优化（另开任务）。

## Technical Notes

- `apps/desktop/src/store/vaultStore.ts:498-577`
- `apps/desktop/src/utils/treeUtils.ts`（在 `renameEntry` 下方追加 `copyEntry`）
- `apps/desktop/src/utils/fileWatcher.ts:12-15`
- `resolveCopyName` / `copyDirRecursive` 已存在，不变。
