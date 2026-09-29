# 新建文件夹后定位并高亮

## Goal

在侧栏新建文件夹后，由于目录树按「目录优先 + 名称排序」排列，新文件夹可能出现在列表其他位置，用户需要花时间寻找。创建完成后应自动滚动定位到新文件夹并高亮，让用户立刻看到结果。

## What I already know

* 新建文件夹的所有 UI 入口（工具栏按钮、actions 菜单、右键菜单）都汇聚到 `apps/desktop/src/components/sidebar/SidebarActions.tsx` 的 `startNewItem('dir')` → `confirmNewItem()` → `vaultStore.createDir`（SidebarActions.tsx:75）。
* `createDir` 后 fire-and-forget 调用 `refreshFileTree()`（vaultStore.ts:484）异步重拉列表；排序在 `tauriProvider.ts:164`（dirs first + localeCompare）。
* 树渲染是普通递归 div，无虚拟化；每行有 `data-dirpath` 属性（FileTreeItem.tsx:59），可用 `querySelector('[data-dirpath="…"]')?.scrollIntoView({block:'nearest'})` 定位（同 idiom 已在 SlashMenu.tsx:255 使用）。
* `FilesPanel.tsx:85` 已有 `selectedPaths: Set<string>` 选中态和选中样式。
* 创建后当前只把新目录加入 `expandedDirs`（SidebarActions.tsx:104），无任何定位/高亮。

## Assumptions (temporary)

* 只处理侧栏「新建文件夹」路径；AI 面板/vault 初始化等 mkdir 调用方不在范围内。
* 需要等 `refreshFileTree()` 完成后才能定位（DOM 要先出现）。

## Open Questions

（已全部解决）

## Requirements

* 新建文件夹成功后，文件树滚动定位到新文件夹并选中（复用 `selectedPaths` 选中样式，持久选中）。
* 新建文件成功后，同样定位并选中。
* 定位在树刷新（`refreshFileTree`）完成、DOM 出现后执行，用 `data-dirpath`/`data-filepath` querySelector + `scrollIntoView({block:'nearest'})`。
* 选中态需同步取消已有的多选（`selectedPaths` 清空后仅含新项）。

## Acceptance Criteria

* [ ] 新建文件夹/文件后，该项被选中并滚动到可视区（block:'nearest'，可视区内不跳动）
* [ ] 之前的多选被替换为仅选中新项
* [ ] 父目录未展开时（新建嵌套路径）仍能正确定位

## Definition of Done

* Lint / typecheck / vitest 相关通过
* 手动验证：深目录、重名、重排序场景

## Technical Approach

`useSidebarActions` 是在 `FilesPanel` 组件内调用的 hook（FilesPanel.tsx:132），选中态 `selectedPaths` 就在 FilesPanel 本地（FilesPanel.tsx:85）。方案：

1. 给 `useSidebarActions` 的 options 增加 `setSelectedPaths`，`confirmNewItem` 成功后 `await` 树刷新，再 `setSelectedPaths(new Set([fullPath]))`。
2. 滚动定位放在 FilesPanel 侧：监听选中变化（或刷新后）`querySelector('[data-dirpath|data-filepath="…"]')?.scrollIntoView({block:'nearest'})`。
3. `createDir` 内 fire-and-forget 的 `refreshFileTree()`（vaultStore.ts:484）需要改为可等待（返回 promise 并 await）。

## Decision (ADR-lite)

**Context**: 高亮形式与范围需要选择。
**Decision**: 持久选中（复用 selectedPaths 样式）；新建文件与文件夹统一处理。
**Consequences**: 零新增样式/动画代码；创建后用户既有选区被替换为新项（符合预期）。

## Out of Scope (explicit)

* AI 面板、vault 初始化、复制流程中的 mkdir
* 树虚拟化

## Technical Notes

* 关键文件：`SidebarActions.tsx`、`FilesPanel.tsx`、`vaultStore.ts`、`FileTreeItem.tsx`
* 定位方式：刷新完成后 `querySelector('[data-dirpath]')` + `scrollIntoView({block:'nearest'})`
