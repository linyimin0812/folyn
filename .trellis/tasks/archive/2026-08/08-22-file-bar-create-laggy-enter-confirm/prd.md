# 文件栏创建文件 Enter 卡顿

## Goal

左侧文件栏创建新文件按 Enter 后卡顿明显，应做到即时反馈。

## What I already know

- `vaultStore.ts:459-462` `createFile` 在 `writeFile` 后 `await refreshFileTree()` —— 后者对整个 vault 递归 `listFiles`，UI 必须等这次完整重列完成才会更新（卡顿来源）。
- 文件 watcher（`fileWatcher.ts:27-34`）在 800ms debounce 后会再次触发 `refreshFileTree`，导致一次创建触发两次全量刷新。
- `createDir`（`vaultStore.ts:469-472`）有相同根因。
- `treeUtils.ts` 已有 `flattenTree` 等纯函数，但没有"向树中插入条目"的辅助。

## Root Cause

`createFile`/`createDir` 阻塞 UI 等待全量 `refreshFileTree()` 完成；用户按 Enter 后输入框和文件行都卡住。

## Requirements

- `createFile` / `createDir` 调用后，新条目应立即出现在文件树中，无需等待全量刷新。
- 不破坏现有测试（`vaultStore.test.ts`、`treeUtils.test.ts`）。
- 后台仍做一次 `refreshFileTree` 以纠偏（外部并发变更、optimistic insert 漏掉的边界）。

## Acceptance Criteria

- [ ] 按 Enter 创建文件时，输入框立即消失，新文件行立即出现（无 100ms+ 卡顿）。
- [ ] `vaultStore.test.ts` 中 `createFile writes content and refreshes the tree` 通过。
- [ ] 新增 `insertEntry` 的单元测试通过。
- [ ] `createDir` 同样即时反馈。

## Technical Approach

1. 在 `treeUtils.ts` 增加 `insertEntry(tree, path, type)` —— 按路径段定位父目录，追加新 `VaultEntry`；根级直接 push。
2. `createFile`：`await writeFile` → `suppressWatcherFor(path)` → `set` 乐观插入 → `void refreshFileTree()`（不 await）。
3. `createDir`：同上（type 为 `'dir'`）。

## Out of Scope

- `deleteFile` / `deleteDir` / `renameFile` 的同样优化（用户未报告，留待后续）。
- 文件树虚拟化、watcher 800ms debounce 调优。

## Technical Notes

- `apps/desktop/src/store/vaultStore.ts:459-472`
- `apps/desktop/src/utils/treeUtils.ts`
- `apps/desktop/src/utils/fileWatcher.ts:12-15`（`suppressWatcherFor` 已存在，直接复用）
