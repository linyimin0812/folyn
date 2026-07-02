# csv preview fill width (flex-1)

## Goal

CSV 预览宽度自适应铺满屏幕宽度。当前 full-bleed 分支丢了 `flex-1`，作为 flex row 子元素按内容宽度收缩。

## What I already know

- `PreviewPane.tsx` csv/office full-bleed 分支：`'prev-body h-full overflow-auto'`——缺 `flex-1`。
- markdown 分支：`'prev-body flex-1 overflow-auto pt-2 px-8 pb-[80vh]'`——有 `flex-1` 才撑满。
- 父容器 `<div className="flex-1 flex overflow-hidden">` 是 flex row，子元素需 `flex-1` 或 `w-full` 才撑满宽度。

## Requirements

- full-bleed 分支加 `flex-1`（或 `w-full`）：`'prev-body flex-1 h-full overflow-auto'`。
- 高度不变。

## Acceptance Criteria

- [ ] CSV 预览宽度铺满屏幕。
- [ ] 高度仍撑满。
- [ ] office 文档同样铺满宽度。
- [ ] tsc + vitest 绿。

## Out of Scope

- 不动其它。

## Technical Notes

- 改 `components/work-area/PreviewPane.tsx` 一处 className。
