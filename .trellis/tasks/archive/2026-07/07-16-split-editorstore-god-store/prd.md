# split editorStore god-store

## Goal

把 `apps/desktop/src/store/editorStore.ts`（665 行 / 54 消费者 / 6 关注点 god-store）
拆成内聚 store + service，消除"IO 当 action、clip 桥塞 editor、AI store 反向决定编辑器挂载策略"
等腐化。纯重构，行为零变化。

## What I already know

### 现状字段/动作布局（`editorStore.ts`）

| 关注点 | 字段/动作 | 该去哪 |
|---|---|---|
| **Tab 生命周期（核心）** | `tabs`/`activeTabId`/`viewMode`/`FileTab`/addTab/closeTab/setActiveTab/updateTabContent/markTabDirty/rewriteTabPrefixes | editorStore 保留 |
| **编辑器视图态** | `cursorLine`/`cursorCol`/`wordCount`/`outlineVisible`/`aiPanelVisible`/setCursorPosition/setWordCount/toggleOutline/toggleAiPanel | 独立 `editorViewState`（cursor 跨组件要写，不能纯本地）|
| **Diff 审阅 + 外部内容** | `diffReviewMode`/`diffFilePath`/`diffOldContent`/`diffNewContent`/`externalContentVersion`/enterDiffReview/exitDiffReview/setContentExternal | 独立 `diffReviewStore`（两者耦合，fileWatcher 也读）|
| **Web tab + clip↔editor 桥** | `openWebTab`/`updateWebTabUrl`/`openWebFromClip`/`backToClip` | clip 桥——见 Open Question |
| **文件 IO / 持久化** | `openFile`/`openDailyNote`/`saveFile`/`saveOpenTabs`/`restoreOpenTabs`/`checkDiskChanges`/`flushAutoSaves` | service（非 store），卫星 `editorAutoSave.ts`/`editorPersistence.ts` 已存在 |

### 卫星文件
- `editorAutoSave.ts`（19 行）、`editorPersistence.ts`（54 行）已存在——IO service 化的雏形。

### 跨 store 反向依赖（审计点名中心腐化）
- `aiStore.ts:269-282` + `aiFileChangeActions.ts:21-51`：按 `handler.useCodeMirror` 决定调
  `editorStore.enterDiffReview` vs `updateTabContent`/`setContentExternal`。AI store 知道
  编辑器 tabId 格式（`${vaultId}:${path}`）和 diff-review 挂载策略——编辑器策略塞在 AI store 里。

### re-render 校正
cursor/wordCount 每键写全局 store——但 Zustand 细粒度 selector 下，只有选了它们的
hook re-render。订阅者仅 `StatusBar.tsx`（读）+ `EditorView.tsx`（写）。blast 小，但
概念上仍是编辑器本地态，不该在 god-store。

### 消费者
54 个文件 import editorStore。绝大多数细粒度 selector。clip↔editor 桥调用点：
`ClipsPanel`/`WebViewer`/`ClipCardView` 的 `openWebFromClip`/`backToClip`。

## Assumptions (temporary, to validate)

- 纯重构，不改 tab/content/diff/IO 行为语义。
- aiStore 反向依赖是否在本任务反转——见 Open Question（关键分支）。
- cursor/wordCount 留 store（跨组件要写），不强行移到组件本地。

## Open Questions

- （已收敛）aiStore 反向依赖：Scope B，机制 1（applier 接口依赖倒置）。

## Requirements

### editorStore 拆分
- **editorStore（核心保留）**：`tabs`/`activeTabId`/`viewMode`/`FileTab`/addTab/closeTab/
  setActiveTab/updateTabContent/markTabDirty/rewriteTabPrefixes + web tab 操作
  （`openWebTab`/`updateWebTabUrl`/`openWebFromClip`/`backToClip`——都是 tab 操作，留此）。
- **新建 `editorViewState` store**：`cursorLine`/`cursorCol`/`wordCount`/`outlineVisible`/
  `aiPanelVisible` + setCursorPosition/setWordCount/toggleOutline/toggleAiPanel。
  （cursor 跨组件要写——GlobalSearchPanel 外部跳转——不能纯组件本地。）
- **新建 `diffReviewStore`**：`diffReviewMode`/`diffFilePath`/`diffOldContent`/`diffNewContent`/
  `externalContentVersion` + enterDiffReview/exitDiffReview/setContentExternal。
  fileWatcher 读 diff 状态改指向此 store。
- **新建 `editorIoService`**（service 非 store）：`openFile`/`openDailyNote`/`saveFile`/
  `saveOpenTabs`/`restoreOpenTabs`/`checkDiskChanges`/`flushAutoSaves` 从 editorStore action
  移出为 service 函数，操作 editorStore tabs。卫星 `editorAutoSave.ts`/`editorPersistence.ts` 并入或保留为内部。

### aiStore 反向依赖反转（Scope B + 机制 1）
- **新建 `FileChangeApplier` 接口**（editor 层拥有）：`apply(change: FileChange): void`。
  通用形，不写死当前两分支。
- **editor 层实现 applier**：内部按 change 对应文件的 `FileTypeHandler.useCodeMirror` 分支——
  `useCodeMirror` → `diffReviewStore.enterDiffReview`；否则 → `editorStore.updateTabContent` +
  `diffReviewStore.setContentExternal`。tabId 解析（`${vaultId}:${path}`）移进 applier 实现
  （tabId 格式归编辑器层，不再泄漏给 aiStore）。
- **aiStore 改造**：`addFileChange` 不再自己分支调 editor 方法，改调
  `fileChangeApplier.apply(change)`。aiStore 通过模块级 `setFileChangeApplier(applier)` 注入；
  applier 未注册时 `addFileChange` no-op（防 init 时序，不崩）。aiStore 不再 import editorStore
  /diffReviewStore。
- `aiFileChangeActions.ts` 同步改：撤销/接受 fileChange 的路径（revert→updateTabContent(oldContent)、
  accept→...）改调 applier 或直接 diffReviewStore/editorStore（按归属）。

### 消费者迁移
- 54 消费者 import 从 editorStore 改到对应新 store/service；selector 形状不变。
- diff 状态读取（fileWatcher.ts:63,72,87、EditorPane/WorkArea externalContentVersion）改指 diffReviewStore。

## Acceptance Criteria

- [ ] editorStore 只剩 tab 生命周期 + web tab 操作；cursor/wordCount/diff/IO 不再在其中。
- [ ] `editorViewState` / `diffReviewStore` / `editorIoService` 存在且有 sibling test。
- [ ] `FileChangeApplier` 接口存在；aiStore 不再 import editorStore/diffReviewStore
      （grep `from.*editorStore\|from.*diffReviewStore` 在 aiStore.ts/aiFileChangeActions.ts 0 命中）。
- [ ] AI 文件变更行为零回归：`useCodeMirror` 文件仍走 enterDiffReview；自定义编辑器文件仍走
      updateTabContent+setContentExternal。fileWatcher 仍正确读 diff 状态。
- [ ] tab 生命周期/diff 审阅/IO/clip 桥/cursor 行为全不变。
- [ ] lint / typecheck / build / test 绿（除 master 既有失败）。

## Definition of Done

- 各新 store/service sibling test + applier 路由测试（useCodeMirror→diff、否则→update）。
- AI 文件变更端到端流（addFileChange→applier→diffReviewStore/editorStore）有测试。
- lint / typecheck / build / test 绿。

## Out of Scope (explicit)

- 不动 settingsStore（已拆）、App.tsx pet 焊接。
- 不改字段语义/默认值。
- `externalContentVersion` remount 计数器用 CodeMirror dispatch 替代——后续任务。
- applier 不扩展到 rename/delete 变更类型（接口通用，但本任务只接当前两分支）。

## Decision (ADR-lite)

**Context**: editorStore god-store 混 6 关注点；aiStore 反向依赖 editorStore（按 useCodeMirror
决定编辑器挂载策略）是审计点名中心腐化。

**Decision**: Scope B + 机制 1。拆 editorStore → editorViewState + diffReviewStore + editorIoService
（核心 tab + web tab 留 editorStore，clip 桥留 editorStore 因其本就是 tab 操作）。反转 aiStore
依赖用 `FileChangeApplier` 接口（editor 层拥有、aiStore 模块级注入、未注册 no-op）——把挂载策略
移出 aiStore 进 editor 层，保留同步时序、不引入事件竞态。机制 2/3 对同步应用场景过度设计。

**Consequences**: aiStore/aiFileChangeActions 改造触及刚稳定代码（回归面），但行为零变化
（applier 内部分支等价于原 aiStore 分支）。为将来扩展（rename/delete 变更、CodeMirror dispatch
替代 externalContentVersion）留好接口。

## Technical Approach

### FileChangeApplier 注入
- `aiStore.ts` 模块级 `let fileChangeApplier: FileChangeApplier | null = null` +
  `setFileChangeApplier(a)`。`addFileChange` 末尾 `fileChangeApplier?.apply(change)`。
- App init（或 editor 层服务模块加载）调 `setFileChangeApplier(new EditorFileChangeApplier())`。
- `EditorFileChangeApplier` 依赖 diffReviewStore + editorStore + FileTypeHandler registry。

### 迁移策略：3 PR 原子
- PR1：建 editorViewState / diffReviewStore / editorIoService / FileChangeApplier 接口 +
  EditorFileChangeApplier 实现 + 注入 wiring + sibling test。旧 editorStore 不改（新 store dormant）。
- PR2：迁 54 消费者 + 把字段/action 从 editorStore 移到新 store/service + fileWatcher diff 读取重定向 +
  aiStore/aiFileChangeActions 切到 applier（删 editorStore import + 原分支逻辑）。行为关键 PR。
- PR3：清死代码 + AI 文件变更端到端测试 + 收尾。

## Research Notes

### 可行方案（scope 维度）

**Scope A — 只拆 editorStore 内部（推荐待定）**
拆出 `editorViewState`（cursor/wordCount/面板开关）+ `diffReviewStore`（diff+externalVersion）+
`editorIoService`（文件 IO 从 action 移到 service）。clip 桥（openWebFromClip/backToClip）
留在 editorStore 或移 `clipBridge` service。**aiStore 反向依赖不反转**——aiStore/aiFileChangeActions
改指向新 diffReviewStore/editorStore（import 重定向，行为不变）。
- Pros: 范围可控，纯重构零行为变化，不动 ai 事件流。
- Cons: aiStore 仍"知道"编辑器策略（反向依赖留作单独任务）。

**Scope B — 拆 editorStore + 反转 aiStore 反向依赖**
在 A 基础上，反转依赖：editorStore/diffReviewStore 订阅 aiStore 的 file-change 事件，
aiStore 不再直接调 editor 方法。AI store 只发事件（path/oldContent/newContent），
编辑器侧决定怎么应用（enterDiffReview vs updateTabContent 由编辑器层按 useCodeMirror 自决）。
- Pros: 修掉审计点名的中心腐化，aiStore 不再耦合编辑器挂载策略。
- Cons: 改 AI 文件变更事件流，触及刚稳定的 aiStore/aiFileChangeActions，回归面大、风险高。

## Technical Notes

- `editorStore.ts` 665 行；`editorAutoSave.ts` 19、`editorPersistence.ts` 54。
- aiStore 反向依赖点：`aiStore.ts:269-282`、`aiFileChangeActions.ts:21-51`。
- clip 桥调用：`ClipsPanel.tsx:42,66`、`WebViewer.tsx:27,49`、`ClipCardView.tsx:8,14`。
- fileWatcher 读 diff：`fileWatcher.ts:63,72,87`。
- spec：state-management、directory-structure、quality-guidelines、cross-layer-thinking。
