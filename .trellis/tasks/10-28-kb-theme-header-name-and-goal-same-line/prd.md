# 主题详情页头部：主题名称与整理目标同行

## Goal

知识工作区头部（`KnowledgeWorkbench.tsx` 的 `kb-workspace-context`）目前主题名称（h1）与整理目标（p）上下两行堆叠。改为同一行：名称在前、目标跟后，更紧凑。

## Requirements

* 眉标（知识库 / 当前主题）保持在上一行不变。
* 名称 + 目标一行：名称不换行省略（title 提示已有）；目标单行省略（现 -webkit-line-clamp 2 改 1），视觉层级保持（名称 t1 粗体、目标 t3 小字）。
* 容器窄时目标自然截断（min-w-0 + ellipsis），不换行、不溢出；650px 容器断点的头部竖排规则不动。
* 只动布局（KnowledgeWorkbench.tsx 结构 + index.css 的 `.kb-workspace-context h1/p` 或新增一行容器类），不改数据与行为。

## Acceptance Criteria

* [ ] 头部名称与目标同行渲染，超长各自省略。
* [ ] knowledge 组件测试全绿（ThemeWorkspace.test 若有头部断言则适配）。

## Out of Scope

* 其他页面/面板的布局调整。

## Technical Notes

* `KnowledgeWorkbench.tsx:52`（h1 + p）、`src/index.css:450-452`（.kb-workspace-context h1/p）。
