# clips: infographic full width

## Goal

让 clips 信息图宽度铺满页面，去掉当前 `max-w-[960px]` 的限宽。

## What I already know

- `InfographicView.tsx:148`：`poster-container mx-auto w-full max-w-[960px] flex flex-col` —— 限宽 960px + 居中。
- `ClipCardView.tsx:18`：外层 `clip-card-view flex-1 overflow-y-auto p-4`，内层卡片 `rounded-xl border ...` 无 max-width（卡片本身铺满）。
- 信息图渲染在卡片内，被 960px cap 卡住。

## Requirements

- 去掉信息图 960px 限宽，使其铺满可用宽度。

## Acceptance Criteria

- [ ] 信息图宽度铺满（无 960px cap）。
- [ ] 窄屏 / 宽屏下不破版（grid 仍自适应）。
- [ ] tsc + vitest 绿。

## Out of Scope

- 不改 clip 卡片本身的 padding / 圆角。
- 不改其它 block 内部布局。

## Technical Notes

- 改 `InfographicView.tsx:148` 的 `poster-container` className：移除 `max-w-[960px]`（`mx-auto` 视情况保留或移除）。
