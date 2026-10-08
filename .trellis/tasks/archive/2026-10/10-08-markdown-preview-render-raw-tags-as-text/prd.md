# Markdown 预览：非代码块中的标签按原文显示

## Goal

Markdown 预览中，非代码块内的 HTML 标签（如 `<workflow-state>...</workflow-state>`）目前被 rehypeRaw 解析为真实 DOM 元素，标签本身在渲染后不可见（只剩内部文本）。期望这类标签按普通文本渲染显示。

## What I already know

- 预览管线：`apps/desktop/src/components/file-types/markdown/MarkdownPreview.tsx:180-212`（remarkParse → remarkGfm → remarkRehype(allowDangerousHtml: true) → rehypeRaw → ... → rehypeReact）
- 根因：rehypeRaw 把 `<workflow-state>` 变成 hast element，React createElement 渲染为未知自定义元素 → 标签文本消失，仅内部内容可见
- `previewComponentMap.ts:197-202` 已有先例：`style`/`script` 返回 null（直接丢弃）
- 无 sanitize 环节；输出直接作为 React 元素渲染进 `div.md-preview`
- 用户要求：非代码块中的标签"当做正常文本进行渲染显示"，不做特殊处理

## Open Questions

（无 — 已确认仅未知/自定义标签按文本显示，标准 HTML 标签保留富渲染）

## Requirements (evolving)

- 非代码块中出现的未知/自定义标签（如 `<workflow-state>`）按字面文本渲染，标签可见
- 标准 HTML 标签（`<b>` `<img>` `<table>` `<svg>` 等）保留现有富渲染行为
- 代码块/行内代码内的内容不受影响（本就按文本渲染）
- 标签内部内容正常渲染（如内部 markdown 粗体等仍生效）

## Acceptance Criteria

- [x] 预览含 `<workflow-state>...</workflow-state>` 的 markdown 时，标签以文本形式可见，内部文本正常显示（rehypeShowRawTags.test.ts）
- [x] `<b>`bold`</b>` 等标准标签仍按富渲染
- [x] 代码块内标签仍正常显示，不受影响
- [x] 带属性的未知标签（`<foo bar="1">`）属性也按文本显示
- [x] 容器指令（::::tabs / :::tab）不受影响（extraKnownTags 传入 componentMap keys，cursorsync 测试回归通过）

## Technical Approach

新增 `rehypeShowRawTags.ts`（rehypeRaw 之后、rehypeMathjax 之前），遍历 hast：tagName 不在标准 HTML/SVG 白名单、也不在 `extraKnownTags`（= previewComponentMap 的 keys，覆盖动态注册的容器指令 tags/tab 等）内的 element，拆为 `[text("<tag attrs>"), ...children, text("</tag>")]`。挂载点 `MarkdownPreview.tsx:192`。

## Out of Scope

- chat（MessageContent）与共享管线 `renderMarkdown.ts`：其 allowDangerousHtml=false，raw HTML 本就被丢弃，行为不变
- `<style>/<script>` 过滤逻辑（previewComponentMap React 层，不动）
- 自闭合斜杠的还原：parse5 会忽略非 void 标签的自闭合斜杠（`<foo/>` 按开标签处理），按解析器所见的语义渲染

## Notes

- 存量失败（与本次无关）：gapCompensation.test.ts 的 `document is not defined`、exportService.test.ts 的 open-color JSON import attribute —— master 上同样失败
- 未做浏览器实测（Tauri 桌面应用）；组件级由 MarkdownPreview.cursorsync 系列测试（真实挂载完整管线）覆盖

## Out of Scope (explicit)

- （待定）

## Technical Notes

- 备选方案：
  - A: 预处理 escape —— 管线前把非代码块内 `<` 转义为 `&lt;`（类似 `renderMarkdown.ts:108` 的 `transformMathBrackets` 先例）
  - B: rehype 插件/组件映射 —— rehypeRaw 之后把未知元素节点转回字面文本
  - C: 关闭 allowDangerousHtml/rehypeRaw（html 节点会被丢弃，不符合需求）
