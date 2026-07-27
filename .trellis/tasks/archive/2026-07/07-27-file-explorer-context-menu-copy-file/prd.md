# 左侧文件栏右键菜单添加复制文件功能

## Goal

在左侧文件栏（FilesPanel）右键菜单中新增"复制文件"项。点击后弹出目录选择对话框（复用现有 `MoveDialog`），用户选定目标目录后执行复制：
- 选当前所在目录 → 副本文件名/目录名加 ` 副本` 后缀（已存在则追加序号 ` 副本 2`、` 副本 3`…）
- 选其他目录 → 用源原名复制（如遇同名冲突，仍加 ` 副本` 后缀以避免覆盖）

行为等同 macOS Finder 的"复制"+ 粘贴到目标位置。

## Requirements

- 右键菜单在 `重命名` 与 `移动到...` 之间新增"复制文件"项。
- 仅 `type === 'file' | 'dir'` 时均显示（文件和目录都支持）。
- 点击后弹出目录选择对话框（复用 `MoveDialog`，新增 `mode: 'move' | 'copy'` 区分标题/行为），让用户选目标目录。
- 在 `copy` 模式下，对话框不禁用源所在父目录（同目录复制是有效操作），仅禁用源本身（dir 类型）及其后代目录。
- 用户确认后调用 `useVaultStore` 新增的 `copyPath(srcPath, srcType, targetDir)` 方法：
  - 文件：`readFile(src)` → 在目标目录下生成目标名 → `writeFile(dest, content)`。
  - 目录：递归 `listFiles(src, true)` → 对每个子目录 `createDir`，对每个文件 `readFile` + `writeFile`。
  - 目标名生成：`parentDir === targetDir` 时加 ` 副本` 后缀并避碰；否则用原名，遇冲突时回退到 ` 副本` 后缀避碰。
  - 复制完成后 `refreshFileTree()`。
- 副本创建后自动展开其父目录（保持当前 expandedDirs 不变即可，refresh 后展开状态保留），不强制选中新副本。
- 复制失败（读源失败/写目标失败）弹 console.error 并抛错给上层；不创建半成品（已写入的部分留下，由 refresh 文件树显示真实状态）。
- i18n key：`sidebar:contextMenu.copyFile`（"复制文件"）和 `sidebar:sidebarActions.copyDialog.title`（"复制到..."）。

## Acceptance Criteria

- [ ] 右键 `.md` 文件 → 菜单出现"复制文件"项。
- [ ] 右键目录 → 菜单出现"复制文件"项。
- [ ] 选当前所在目录 → 同目录出现 `name 副本.ext`（同名已存在时为 `name 副本 2.ext`）。
- [ ] 选其他目录 → 目标目录出现原名的文件/目录；若目标已有同名，则改用 `name 副本.ext`。
- [ ] 目录复制后子结构完整，所有文件内容一致。
- [ ] 复制对话框标题与移动不同（"复制到..." vs "移动到..."）。
- [ ] 复制对话框不禁用源所在父目录。
- [ ] 中英 i18n 文案齐备。
- [ ] `tsc` / `eslint` 通过。

## Definition of Done

- `vaultStore` 新增 `copyPath` 方法 + 在 `vaultManager` 不加新接口（store 层组合现有原语）。
- `MoveDialog` 增加可选 `mode: 'move' | 'copy'` prop，标题随 mode 切换，`isDisabled` 在 copy 模式不禁用父目录。
- `ContextMenu` 新增"复制文件"项 + `onStartCopy` 回调。
- `FilesPanel` 接线：`copySource` state、`onStartCopy` handler、`MoveDialog` 在 copy 模式下渲染。
- i18n 中英两边都补齐键。
- 单元测试覆盖 `copyPath` 的避碰命名逻辑（同目录 + 异目录 + 同名冲突）。

## Technical Approach

**vaultStore.copyPath(srcPath, srcType, targetDir)**:
1. 计算源所在父目录 `parentDir`。
2. `targetName = parentDir === targetDir ? withSuffix(name, ' 副本') : name`，再调 `resolveUniqueName(targetDir, targetName)` 处理冲突（若原名已存在，也加 ` 副本` 后缀）。
3. 文件：`readFile(srcPath)` → `writeFile(targetPath, content)`。
4. 目录：`createDir(targetPath)` → 递归 `listFiles(srcPath, true)` → 对每个子项：
   - 子目录：`createDir(targetPath + '/' + relPath)`。
   - 子文件：`readFile(srcRelPath)` → `writeFile(targetRelPath, content)`。
5. `refreshFileTree()`。

**MoveDialog 复用**: 增加 `mode?: 'move' | 'copy'` prop，默认 `'move'`。`copy` 模式：
- 标题：`sidebar:sidebarActions.copyDialog.title`。
- `isDisabled` 不再禁用 `parentDir`。
- 仅禁用源本身（dir 类型）及其后代。

**菜单项**: 放在 `move` 项之后，`delete` 项之前。复用 `ThemeIcon name="copyOfFolder"`。

## Out of Scope (explicit)

- 不保留 mtime / 文件元数据（`writeFile` 自然更新 mtime）。
- 不支持跨 vault 复制（仅当前 vault 内）。
- 不支持多选批量复制（当前右键菜单只针对单个 item）。
- 不在副本创建后自动进入重命名流程（用户可再用"重命名"项）。

## Technical Notes

- 复用 `MoveDialog`（`SidebarActions.tsx:226`）。
- 复用 `useVaultStore` 的 `readFile` / `writeFile` / `createDir` / `listFiles` / `refreshFileTree`。
- `copyPath` 避碰工具函数：`resolveUniqueCopyName(targetDir, desiredName, isDir)` —— 通过 `listFiles(targetDir, false)` 取已存在名 Set，循环尝试 `name 副本 N` 直到不冲突。
- 文件大小普遍 <100KB（markdown 笔记），read+write 足够快，无需 chunked copy。
