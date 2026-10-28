# 整理模型选择框：位置与宽度

## Goal

知识库页面刚打开时工作区头部显示的「整理模型」选择框（`KnowledgeWorkbench.tsx:52`，`sourceEntry === 'closed'` 时渲染）造成干扰；应只在「选择要收录的资料 / 主题设置」编辑表单里出现（`SourcesView.tsx:131` 已有一份）。同时选择框太短（`KnowledgeModelSelector.tsx` 中 `PairSelector` 的 `max-w-[min(100%,260px)]` 限制）。

## Requirements

* 移除 `KnowledgeWorkbench.tsx` 头部的 `KnowledgeModelSelector`（连 `kbPair/setKbPair` 的头部绑定与 `sourceEntry === 'closed'` 条件一起删）；模型配置入口只剩 SourcesView 编辑表单一处。
* 加宽选择框：`KnowledgeModelSelector` 的 `max-w` 从 260px 提到 ~420px（`max-w-[min(100%,420px)]`）；若 `PairSelector`（`@/components/ai/PairSelector`）的弹出面板自身有窄宽度限制，同样放宽——以实际弹层可完整展示「provider / 模型名」为准。
* 不改 `PairSelector` 的公共行为（其他使用方不动）；宽度调整尽量收在 KnowledgeModelSelector 侧。

## Acceptance Criteria

* [ ] 打开知识库（阅读/问答/审阅/资料列表普通态）头部无模型选择框。
* [ ] 进入「选择要收录的资料 / 主题设置」表单仍可配置整理模型，选择框明显加宽。
* [ ] 相关测试（KnowledgeWorkbench/组件级若有）适配后全绿。

## Out of Scope

* 模型选择的其他入口/持久化逻辑（kbPair 在 aiConfigStore 的存取不动）。

## Technical Notes

* 文件：`KnowledgeWorkbench.tsx`（删头部实例）、`KnowledgeModelSelector.tsx`（宽度）、必要时 `PairSelector.tsx`（弹层宽度，谨慎：多处共用）。
