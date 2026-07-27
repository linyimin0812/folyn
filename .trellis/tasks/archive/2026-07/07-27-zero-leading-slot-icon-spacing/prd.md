# Zero Leading-Slot Icon Spacing

## Goal

把 leadingSlot 图标间距从 1px 收到 0px。

## What I already know

- `apps/desktop/src/components/chat/ChatInputBox.tsx:124` 容器 `gap-px`（1px）
- 各子元素 `ml-0.5` 已在上一任务删除

## Requirements

- 把 `ChatInputBox.tsx` 容器 `gap-px` 改为 `gap-0`

## Acceptance Criteria

- [ ] leadingSlot 内相邻图标间距 0px
- [ ] 其他 padding 不变
- [ ] `tsc -b` 通过

## Out of Scope

- 任何其他间距 / padding 调整

## Technical Notes

- 一行 className 改动
