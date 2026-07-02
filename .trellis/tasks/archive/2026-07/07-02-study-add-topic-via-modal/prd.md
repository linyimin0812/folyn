# study: add topic via modal

## Goal

学习功能"添加主题"改用弹窗 Dialog，移除左栏 inline 输入框。左栏 header 的 `+` 按钮保留，点击打开弹窗。

## What I already know

- `components/study/StudyTopicList.tsx`：左栏 header `+` 按钮 toggle `creating` 状态 → inline `sw-quick-add` 输入框（回车新建）。下方是主题列表（select/delete）。
- `store/studyStore.ts`：`createTopic(title): Promise<string|null>`。
- 仓库 Dialog 范式（`components/ai/IngestDialog.tsx` 等）：`dlg-overlay` + `dlg` + `dlg-hd` + `dlg-body` 类，`onConfirm`/`onCancel` props，overlay click=cancel，内部 stopPropagation，`dlg-input`/`dlg-close` 类。
- `StudyTopicList` 有 `onCreated?(slug)` 回调（新建后聚焦主区）。

## Requirements

- 新增 `components/study/StudyAddTopicDialog.tsx`：标题输入弹窗，autofocus，Enter=提交，Esc=取消，空标题禁用提交/返回。props: `onConfirm(title): void` / `onCancel(): void`。复用 `dlg-*` 类与现有 Dialog 风格。
- `StudyTopicList.tsx`：移除 `creating`/`draft` 状态与 inline `sw-quick-add` 块；`+` 按钮改为 `setShowAddDialog(true)`；弹窗 open 时渲染 `<StudyAddTopicDialog>`，onConfirm → `createTopic(title)` → 关闭 → `onCreated?.(slug)`；onCancel → 关闭。
- 左栏主题列表（select/delete/计数）不动。

## Acceptance Criteria

- [ ] 点左栏 `+` 打开弹窗（不在左栏 inline 输入）。
- [ ] 弹窗输入标题回车/点确认 → 新建主题并出现在列表，弹窗关闭，主区聚焦（onCreated 触发）。
- [ ] Esc / 点 overlay / 点取消 → 关闭弹窗不新建。
- [ ] 空标题不新建。
- [ ] 删除/切换主题行为不变。
- [ ] tsc + vitest 绿；新增/扩展单测覆盖弹窗与左栏接线。

## Definition of Done

- tsc / vitest 绿；单测覆盖。
- 遵循 desktop frontend spec（named exports、`@/` alias、复用 `dlg-*` 类）。

## Technical Approach

- 新 `StudyAddTopicDialog.tsx`（参考 `IngestDialog.tsx` 结构）。
- `StudyTopicList.tsx` 用 `useState<boolean>` 控制 dialog 开合，移除 inline 添加相关 state/JSX。
- 不改 studyStore、不改列表渲染逻辑。

## Out of Scope

- 不改 `createTopic` 实现。
- 不改主题列表样式 / 删除流程。
- 不加标题以外的字段（描述等）。

## Technical Notes

- 参考 Dialog：`components/ai/IngestDialog.tsx`、`components/vault/CreateVaultDialog.tsx`。
- `dlg-overlay`/`dlg`/`dlg-hd`/`dlg-body`/`dlg-input`/`dlg-close` 类已存在。
