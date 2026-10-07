# dark-mode-cursor-sync-highlight-too-faint

## Goal

暗黑模式下，分栏预览的 cursor-sync 高亮块（`.cursor-sync-active`）几乎不可见，提升其在暗黑主题下的可见性。

## What I already know

- 高亮定义在 `apps/desktop/src/index.css:993`：`background-color: color-mix(in srgb, var(--acc) 6%, transparent)`
- 亮色 `--acc: #3a6ef0`，暗色 `--acc: #5b8af5`（index.css:54/73）
- 6% 透明度混合在暗黑底色上对比度不足 → 不明显
- 高亮 element 由 `usePreviewCursorSync.ts` 打 class，纯 CSS 问题，JS 无需改动

## Requirements

- 暗黑模式下高亮可见但不刺眼（保持 calm 风格）
- 亮色模式观感不变

## Acceptance Criteria

- [ ] 暗黑模式分栏编辑 markdown，光标所在块的高亮清晰可辨
- [ ] 亮色模式视觉无回归

## Technical Approach

`apps/desktop/src/index.css` 在 `.md-preview .cursor-sync-active` 后新增 `[data-theme='dark']` override，`color-mix` 百分比 6% → 14%。

## Decision (ADR-lite)

**Context**: 暗底上 6% accent 混合对比度不足。
**Decision**: 仅暗色主题提高混合浓度至 14%（用户选定）。
**Consequences**: 一行 CSS，无 JS/逻辑改动；若仍不够明显可继续上调。

## Out of Scope

- 高亮动画/闪烁效果
- JS 对齐逻辑改动

## Technical Notes

- 候选方案：暗色主题 override 提升 color-mix 百分比（如 6% → 14%），或加左侧 accent 边条
