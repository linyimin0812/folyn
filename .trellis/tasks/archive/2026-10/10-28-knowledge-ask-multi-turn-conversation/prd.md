# 知识问答多轮会话

## Goal

向知识库提问目前是单轮单发（`askQuestion → askAnswer`，清空即重置）。改为多轮会话式提问：后续问题可承接前文。

## Requirements

* `knowledgeStore` 的 ask 状态改为会话轮次数组 `askTurns: { question, answer, evidence, note? }[]`（运行时态，**不落盘**——与现有 ask 状态一致；切主题/切 vault 重置）。
* `kbAsk.askKnowledge` 接收先前轮次（取最近 6 轮的问答文本对），注入 prompt 作为会话上下文；**检索仍只针对当前问题**（预算检索逻辑不变）。
* AskView：会话流展示（问题 + 回答 + 证据入口逐轮渲染，新问题输入框置底）；「清空」重置整个会话；取消只中断当前轮；IME/Shift+Enter 行为保持。
* 证据引用面板按轮次查看（点击该轮回答里的引用标记）。
* 各轮 notice/相位（askNote/askPhase）仍只反映当前进行中的轮次。

## Acceptance Criteria

* [ ] 追问的 prompt 里包含先前问答上下文（prompt 构造层测试断言注入与 6 轮截断）。
* [ ] 会话流 UI 渲染多轮；清空重置；取消中断当前轮不破坏已有轮次。
* [ ] 既有 AskView/kbAsk 测试适配后全绿 + 新增多轮用例。

## Out of Scope

* 会话历史落盘/恢复。
* 编辑/分支历史轮次。
* 多轮间共享检索缓存。

## Technical Notes

* 相关文件：`kbAsk.ts`（askKnowledge 签名 + prompt）、`kbPrompts.ts`（问答 prompt 加会话上下文段）、`knowledgeStore.ts`（ask 状态形状、ask/clearAsk/cancelAsk）、`AskView.tsx`（渲染）。
* 与「多语言」任务都改 AskView/kbPrompts——本任务先做，多语言后做。
