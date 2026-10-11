# Markdown 预览页手势放大缩小

## Goal

Markdown 预览（`MarkdownPreview.tsx` / `PreviewPane.tsx`）支持视觉缩放（transform: scale）：跟踪板捏合、ctrl+滚轮、Cmd +/-/0 快捷键，缩放级别全局统一并持久化。

## Requirements

* 视觉缩放：`transform: scale()` 整体缩放 `.md-preview` 内容（不重排）
* 手势入口：跟踪板捏合（macOS WKWebView 表现为 `wheel` + `ctrlKey`）、ctrl+滚轮
* 快捷键：Cmd + / - / 0（放大 / 缩小 / 重置），仅在 Markdown 预览激活时生效
* 锚点：光标/捏合点锚定缩放，内容不跳变（补偿 scrollTop/scrollLeft）
* 范围：0.5x–3.0x，步进 ~1.1 倍（或 wheel delta 驱动）
* 作用范围：全局统一，持久化（appearanceStore + Tauri 持久化）
* **模式限制：仅在 preview（纯预览）模式下可缩放；split 模式下手势与快捷键均禁用（避免破坏编辑器↔预览对齐）**
  * 判定来源：`editorStore.viewMode === 'preview'`（`src/store/editorStore.ts:68`）
  * 切回 split 模式时预览恢复 100%（或保持倍率但不生效——实现时取简单者：恢复 100%）
* ~~缩放指示：状态栏或角落显示当前倍率~~（已移除：用户不要求 UI 显示倍率；重置用 Cmd+0）
* 滚动：放大后 `.prev-body` 可双向滚动查看溢出内容
* ~~编辑器↔预览滚动/光标同步补偿~~（不需要：split 模式禁用缩放，preview 模式无编辑器）
* 切回 split 模式时预览恢复 100% 显示

## Acceptance Criteria

* [ ] 双指捏合可连续缩放，以捏合中心为锚，无跳变
* [ ] ctrl+滚轮等效缩放
* [ ] Cmd +/-/0 生效；0 重置为 100%
* [ ] 缩放级别跨文件、跨会话保持
* [ ] split 模式下捏合/ctrl+滚轮/Cmd± 均无缩放效果；切回 preview 恢复可用
* [ ] 0.5x 与 3.0x 边界 clamp，不越界
* [ ] 演示模式下缩放仍可用（或明确禁用）

## Definition of Done

* 最小可运行自检/测试（缩放 clamp、锚点补偿数学）
* lint / typecheck 通过
* 手动验证：捏合、快捷键、重启后持久化、split/preview 模式切换

## Out of Scope

* 仅文字缩放（font-size reflow）模式
* 按文件独立记忆缩放
* 图片/JSON 等其他预览类型的缩放统一（图片已有 ZoomPanCanvas）

## Technical Approach

* 参考 `ZoomPanCanvas.tsx`（wheel + ctrlKey 判定、scale clamp）
* 在 `MarkdownPreview.tsx`（或 Preview 层）对 `.md-preview` 外层 wrapper 施加 `transform: scale(z)`，`transform-origin` 依锚点动态计算 + scroll 补偿（标准公式：`scroll' = (scroll + anchor) * z'/z - anchor`）
* 缩放级别存 `appearanceStore`（新增 `mdPreviewZoom`，走既有持久化通道）
* 快捷键：组件内 keyboard listener，限制在 markdown 预览激活时
* 倍率指示 + 重置：预览角落小组件

## Decision (ADR-lite)

**Context**: 预览无任何缩放能力；可选字号 reflow 或视觉 scale。
**Decision**: 视觉缩放 + 光标锚点 + 全局统一持久化 + 手势/快捷键双入口；仅 preview 模式生效。
**Consequences**: 放大后需双向滚动；split 模式禁用（切回时恢复 100%），编辑器↔预览同步不受影响；文字在高倍率下由浏览器矢量渲染，不模糊。

## Technical Notes

* Tauri 2 + React，预览为普通 DOM（非 iframe/canvas）
* `.md-preview` 样式在 `src/index.css:446`；滚动容器 `.prev-body` 在 `PreviewPane.tsx`
* 现有手势参考：`src/components/file-types/image/ZoomPanCanvas.tsx`（wheel:91, pinch:135-154）
* 持久化参考：`src/store/appearanceStore.ts:144`（setFontSize 模式）
