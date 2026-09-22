# Markdown split 模式：列表与代码块之间偶发大片空白

## Goal

Split 模式下，预览中块与块之间（典型：列表 → 代码块）偶发一大片空白（数百 px）。定位并修复，同时不破坏既有 cursor-sync 对齐行为。

## What I already know

- 预览通过两套机制对齐编辑器行网格：
  - `rehypeBlankGap.ts`：块间插入 `.md-blank-gap` spacer，静态高度 = 空行数 × editorLineHeight。
  - `MarkdownPreview.tsx:1437-1468`（runtime blank-gap compensation，useLayoutEffect）：重算每个 gap，使每块落在 `origin + (line − line0) × editorLineHeight` 网格上。公式 `newH = max(8, curH + desired − (top + shift))` —— **前一个块渲染偏短的差额全部灌进它后面的 gap**。
- 差额来源（按量级）：
  1. **被 420px 截断的代码块**（`.code-block-wrapper { max-height: 420px }`）：100 行代码编辑器跨度 ~2200px，预览只有 420px，~1780px 差额灌进下一个 gap → 巨型空白带。
  2. 段落/列表在窄编辑器换行、宽预览不换行 → 小额累积。
  3. 图片异步加载时首次测量高度 0。
- 「不是必现」的解释：光标进入代码块时 CSS 解除 420 截断（`:has(.cursor-sync-active) → max-height:none`），离开时恢复；gap 重算 effect 的依赖是 `[reactContent, editorLineHeight, syncActive]`，不含 cap 状态 → gap 高度取决于上次重算时的 cap 状态（即光标历史）。打字 + 光标进出代码块会让 gap 大小翻转。
- 用户示例（列表 → 空行 → 代码块）中，代码块前的 gap 吸收的是上方累积的全部差额。

## Root Cause

Runtime blank-gap compensation 把「被设计截断的代码块」的渲染差额当作普通块的 re-wrap 差额处理，全额灌进下一个 gap。代码块截断是刻意行为（预览内部还有 inner scroll + codeBlockAlignPoint 处理块内光标对齐），其差额不该参与网格补偿。

## Requirements

- gap 补偿循环中，代码块（`.code-block-wrapper` / 顶层 `pre`）的渲染差额不再灌入其后的 gap：该 gap 保持静态高度，网格以代码块实际渲染底部 re-anchor。
- 非代码块行为完全不变（re-wrap 差额补偿是既有对齐机制的核心，不动）。
- 抽出纯函数 `planGapHeights(blocks, gapAfter, editorLineHeight)` 便于单测。

## Acceptance Criteria

- [ ] 含长代码块（> 420px 渲染高度）+ 后续列表/代码块的文档，代码块后的 gap 保持 ≈ 空行数 × editorLineHeight，不再出现数百 px 空白带。
- [ ] 光标进出代码块（cap/uncap）不再改变任何 gap 的高度。
- [ ] 普通段落 re-wrap 差额补偿行为不变（既有对齐不回退）。
- [ ] `planGapHeights` 单测覆盖：capped code block 场景、普通 re-wrap 场景、floor 8px、相邻无 gap 场景。

## Out of Scope

- 图片异步加载后的重测量（ResizeObserver）——影响对齐精度，不产生巨型空白，本任务不做。
- 光标离开代码块 re-cap 后下方内容的网格重对齐（视觉正确性由 cursor-sync 滚动路径保证）。
- editorLineHeight 测量本身。

## Technical Approach

在 `MarkdownPreview.tsx` 的 compensation useLayoutEffect 中：循环处理 gap i−1 时，若 `blocks[i-1].el` 是代码块，跳过差额灌入（`newH = curH`），并把 `origin` re-anchor 到 `blocks[i].top + shift` 对应网格位置，后续块相对新锚点补偿。循环体抽为纯函数。

## Technical Notes

- `apps/desktop/src/components/file-types/markdown/MarkdownPreview.tsx:1437-1468`（补偿循环）、`:1018-1023`（cursor-sync-active 换类）、`:1396`（syncActive 时启用 rehypeBlankGap）
- `apps/desktop/src/components/file-types/markdown/rehypeBlankGap.ts`（静态 gap）
- `apps/desktop/src/index.css:473-485`（420px cap + `:has(.cursor-sync-active)` 解除）
- spec：`.trellis/spec/desktop/frontend/markdown-rendering.md`（管道规范，本改动不触碰渲染管道本身）
