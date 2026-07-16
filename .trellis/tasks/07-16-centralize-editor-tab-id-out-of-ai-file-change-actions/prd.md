# centralize editor tab id out of ai file change actions

## Goal

消除 `aiFileChangeActions.ts` 里内联构造的 `${vaultId}:${path}` tabId + 直查 editorStore/
diffReviewStore 的编辑器域知识泄漏。把"按 path 解析 tab + 应用 editor 变更"这块收进 editor 层
拥有的方法，aiFileChangeActions 只做编排（session 状态 + disk IO）。editorStore PR3 留下的尾巴。

## What I already know

### 现状（`aiFileChangeActions.ts`）
- `applyAcceptChange`（:33）：`vaultId = useVaultStore...activeVaultId || ''`、`tabId = ${vaultId}:${path}`、
  `useEditorStore.getState().tabs.find(t=>t.id===tabId)`、命中则 `useDiffReviewStore.getState().setContentExternal(tabId, change.newContent)`。
- `applyRejectChange`（:60）：同样构造 tabId + tab 查找，命中则 `useEditorStore.getState().updateTabContent(tabId, change.oldContent)`；
  另有 disk IO（writeTextFile 写 oldContent）+ session 状态 mutation。
- 即：tabId 格式 + tab 查找 + 选哪个 editor store 方法——三处编辑器域知识泄漏在 AI 侧。
- apply 路径已在 `EditorFileChangeApplier.apply`（editor 拥有）里收编；accept/reject 的 editor 切片没收。

### PR3 ponytail note 的延后理由（已读）
reject 交织 disk IO + session 状态 + editor mutation；整块搬进 applier 会拆散一个逻辑操作。
**最小收编**：只抽 editor 切片（tabId + tab 查找 + editorStore/diffReviewStore 调用）进 editor 拥有的方法，
disk IO + session 状态留 aiFileChangeActions 当 orchestrator。这样消泄漏又不拆散 reject。

### FileChangeApplier 现状（`services/fileChangeApplier.ts`）
- `interface FileChangeApplier { apply(change: FileChange): void }` + `EditorFileChangeApplier` 实现。
- apply 内部已有 tabId 构造 + tab 查找 + useCodeMirror 分支。

## Assumptions (temporary, to validate)

- 纯重构，行为零变化：accept/reject 的 editor 应用行为不变。
- disk IO + session 状态留 aiFileChangeActions。
- 抽取形状：扩展 FileChangeApplier vs 独立 helper——见 Open Question。

## Open Questions

- （已收敛）editor 切片收编形状：Approach A（扩展 FileChangeApplier）。

## Requirements

- 扩展 `FileChangeApplier` 接口加两方法：
  - `acceptEditorChange(path: string, newContent: string): void` —— editor 切片 of accept：解析 tabId + 查 tab + 命中则 `diffReviewStore.setContentExternal(tabId, newContent)`（bump externalContentVersion）。
  - `revertEditorTab(path: string, oldContent: string): void` —— editor 切片 of reject：解析 tabId + 查 tab + 命中则 `editorStore.updateTabContent(tabId, oldContent)`。
- `EditorFileChangeApplier` 实现两方法：**复用 apply 已有的 tabId 解析 + tab 查找逻辑**（抽成 private helper `resolveTab(path)` 返回 `{tab, tabId} | null`），apply/acceptEditorChange/revertEditorTab 共用。无 useCodeMirror 分支（accept/revert 不分编辑器类型，直接写 content/version）。
- `aiFileChangeActions.ts`：
  - `applyAcceptChange`：删内联 tabId/tab 查找/diffReviewStore.setContentExternal，改调 `getFileChangeApplier()?.acceptEditorChange(path, change.newContent)`；保留 session fileChanges 状态 mutation（status='accepted'）+ 返回 newContent。
  - `applyRejectChange`：删内联 tabId/tab 查找/editorStore.updateTabContent，改调 `getFileChangeApplier()?.revertEditorTab(path, change.oldContent)`；保留 disk IO（writeTextFile oldContent）+ session 状态 mutation（status='rejected'）。
  - 删 `useEditorStore`/`useDiffReviewStore` import；删顶部 PR3 ponytail note（已收编）。
  - aiFileChangeActions 仍 import useVaultStore（reject 的 disk IO 需要 vaultRoot）——保留。
- 更新 `aiFileChangeActions` test mock：mock `getFileChangeApplier` 返回的 applier 替代旧 editorStore/diffReviewStore mock。
- `fileChangeApplier.test.ts` 加 acceptEditorChange/revertEditorTab 测试（命中 tab→对应调用；未命中 tab→no-op；tabId 解析正确）。

## Acceptance Criteria

- [ ] `aiFileChangeActions.ts` 不再构造 `${vaultId}:${path}`、不再直查 `useEditorStore.getState().tabs`、不再直调 `diffReviewStore.setContentExternal`/`editorStore.updateTabContent`（grep 0 命中）。
- [ ] `aiFileChangeActions.ts` 不再 import `editorStore`/`diffReviewStore`。
- [ ] accept/revert editor 切片行为零回归（命中 tab 写 content/version；未命中 no-op；tabId 解析同旧）。
- [ ] apply 路径行为不变（复用抽出的 resolveTab helper）。
- [ ] lint / typecheck / build / test 绿（除 master 既有失败）。

## Definition of Done

- acceptEditorChange/revertEditorTab 测试覆盖命中/no-op/tabId。
- aiFileChangeActions test mock 更新。
- 行为零回归。
- lint / typecheck / build / test 绿。

## Out of Scope (explicit)

- 不动 apply 路径行为（只复用其 tabId 解析逻辑）。
- 不改 disk IO（writeTextFile）或 session 状态 mutation 位置（留 aiFileChangeActions）。
- 不改 accept/reject 行为语义。
- 不动 aiStore addFileChange（已在 applier）。

## Decision (ADR-lite)

**Context**: aiFileChangeActions 内联构造 tabId + 直查 editorStore/diffReviewStore，编辑器域知识
泄漏在 AI 侧（editorStore PR3 留下的尾巴）。PR3 ponytail note 担心整块搬 accept/reject 会拆散
reject（disk IO + session + editor 交织）。

**Decision**: Approach A——只抽 editor 切片（tabId 解析 + tab 查找 + editorStore/diffReviewStore 调用）
进 `FileChangeApplier.acceptEditorChange`/`revertEditorTab`，复用 apply 已有的 resolveTab helper。
disk IO + session 状态留 aiFileChangeActions 当 orchestrator。不拆散 reject 的逻辑操作。

**Consequences**: FileChangeApplier 成 editor 侧 file-change 应用的完整抽象（apply/accept/revert 三态）；
aiFileChangeActions 不再 import editorStore/diffReviewStore，依赖方向干净；tabId 解析逻辑统一一处。

## Technical Approach

### 单 PR
- fileChangeApplier.ts：抽 `private resolveTab(path)` helper（从 apply 抽出），加 `acceptEditorChange`/`revertEditorTab` 方法 + test。
- aiFileChangeActions.ts：切到 `getFileChangeApplier()?.acceptEditorChange/revertEditorTab`，删内联 + import + ponytail note，更新 test mock。
- 行为零回归。

## Research Notes

### 可行方案（editor 切片收编形状）

**Approach A — 扩展 FileChangeApplier（推荐待定）**
给接口加 `acceptEditorChange(path, newContent)` + `revertEditorTab(path, oldContent)` 两方法，
`EditorFileChangeApplier` 实现（复用 apply 已有的 tabId 解析 + tab 查找逻辑，抽成内部 helper）。
aiFileChangeActions 调 `applier.acceptEditorChange(path, newContent)` / `applier.revertEditorTab(path, oldContent)`，保留 session 状态 + disk IO。
- Pros: editor 域应用统一在一处抽象（apply/accept/revert 三态完整）；tabId 解析逻辑复用；aiFileChangeActions 不再 import editorStore/diffReviewStore。
- Cons: 接口扩 2 方法；applier 拿不到 session（不需要——只做 editor 切片）。

**Approach B — 独立 `editorTabBridge` helper**
新建 `services/editorTabBridge.ts`：`applyContentToTab(path, content, mode: 'external'|'replace')`，
aiFileChangeActions 调它。FileChangeApplier 不动。
- Pros: 不动现有 applier 接口；单一职责 helper。
- Cons: editor 域应用散在两处（applier + bridge）；tabId 解析逻辑要再复制一份或从 applier 抽出共享——多一层。

## Technical Notes

- 文件：`apps/desktop/src/store/aiFileChangeActions.ts`（:33 accept、:60 reject）、
  `apps/desktop/src/services/fileChangeApplier.ts`（apply 已收编 tabId 解析）。
- PR3 ponytail note 在 aiFileChangeActions.ts 顶部，本任务完成后应更新/删除。
- spec：cross-layer-thinking（依赖方向）、type-safety、quality-guidelines、state-management。
