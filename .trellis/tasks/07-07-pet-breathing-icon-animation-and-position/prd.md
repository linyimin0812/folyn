# 桌宠呼吸灯动效增强 + 默认位置上调

## Goal

让桌宠图标的呼吸灯（drop-shadow 光晕）动效更明显，并把默认位置从「屏幕右下角紧贴底边」改为「右下角偏上一点」。属于纯 UI 微调，不涉及交互逻辑。

## What I already know

- 呼吸灯定义在 `apps/desktop/src/components/pet/pet.css` 的 `@keyframes pet-breathe`：
  - `0%, 100%: drop-shadow(0 0 3px rgba(58,110,240,0.4))`
  - `50%: drop-shadow(0 0 7px rgba(58,110,240,0.85))`
  - 周期 2.6s ease-in-out infinite
  - 通过 `.pet-mascot.is-*` 各状态的 `animation` 列表（与状态 transform 动画并行）施加。
- 桌宠是 120×120 透明窗口，mascot SVG 88px。drop-shadow halo 当前最大 7px，需要避免动画放大后边缘被 120px 窗口裁剪（comment 中已说明 margin 预留 ~8px）。
- 默认位置由 `apps/desktop/src/components/pet/petPosition.ts` 的 `computeDefaultPetPosition` 计算：
  - `PET_RIGHT_MARGIN = 8`，`PET_BOTTOM_MARGIN = 12`
  - `y = max(PET_MIN_TOP, workArea.height - 120 - 12)`
- 用户已保存的位置会从 settingsStore 读取并 clamp，所以改 `PET_BOTTOM_MARGIN` 只影响「首次启动 / 没有保存位置」的默认值，不会强行覆盖用户已拖动过的位置。

## Assumptions (temporary)

- 「明显一些」指：增大 halo 半径 + 提高 alpha 峰值 + 可能略缩短周期，让脉冲更醒目，但仍保持柔和（不刺眼）。
- 「偏上一点」指：把 `PET_BOTTOM_MARGIN` 从 12 调大（比如 40~80px），让默认位置离 Dock/底边再远一些。

## Open Questions

- 呼吸灯强度：增强到什么程度（半径 / alpha / 周期）？
- 上调幅度：底部留白从 12px 调到多少？

## Requirements (evolving)

- R1: 增强 `pet-breathe` keyframe 的视觉对比（更大半径、更高峰值 alpha）。
- R2: 调整 `PET_BOTTOM_MARGIN`，让默认位置距离屏幕底边更远（偏上）。
- R3: halo 放大后仍须在 120×120 窗口内不被裁剪（必要时减小 mascot SVG 或增大窗口 margin，但优先靠 drop-shadow 自身的 spread 控制）。
- R4: 不影响 hover/drag/click 状态动画，呼吸灯与状态动画的并行 `animation` 列表保持不变。

## Acceptance Criteria (evolving)

- [ ] idle 状态下，呼吸灯脉冲肉眼可见且明显比改动前更醒目。
- [ ] 全屏 + 普通桌面下，halo 不被 120×120 窗口边缘裁剪成方角。
- [ ] 全新机器（无保存位置）首次启动，桌宠默认位置离屏幕底边 > 12px，肉眼可见比之前更靠上。
- [ ] 已有保存位置的用户启动后位置不变（仍走 settingsStore clamp 分支）。

## Definition of Done

- `pet.css` 的 `pet-breathe` keyframe 已更新。
- `petPosition.ts` 的 `PET_BOTTOM_MARGIN` 已上调，相关 comment 同步更新。
- `petPosition.test.ts` 断言更新（如有覆盖该常量的用例）。
- 本地 `pnpm dev` 启动 desktop，肉眼验证动效 + 默认位置。

## Out of Scope

- 不改交互逻辑（点击/拖拽/右键菜单）。
- 不改 mascot SVG 本身或其尺寸。
- 不改窗口大小（仍是 120×120）。
- 不改已保存位置的 clamp 行为。

## Technical Notes

- 关键文件：
  - `apps/desktop/src/components/pet/pet.css:96-99`（pet-breathe keyframe）
  - `apps/desktop/src/components/pet/petPosition.ts:28-29`（PET_BOTTOM_MARGIN）
  - `apps/desktop/src/components/pet/petPosition.test.ts`（可能需要同步断言）
- 约束：mascot SVG 当前 88px + r=244/512 viewBox，120px 窗口里留 ~16px 边距；drop-shadow 峰值半径不能超过 ~16px，否则 halo 会被窗口边缘裁剪。
