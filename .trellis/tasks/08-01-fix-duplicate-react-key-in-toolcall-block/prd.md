# 修复 ToolCallBlock 重复 React key 警告

## 背景
浏览器控制台报 `Encountered two children with the same key` 警告，重复 key 为
`toolu_xxx`，触发点在 `apps/desktop/src/components/chat/ToolCallBlock.tsx:86`
的 `{toolCalls.map((tc) => <ToolCallItem key={tc.id} .../>)}`。

## 根因
`aiStore.ts:300 addToolCall` 无条件 `push` 新条目到 `msg.toolCalls`。当上游
CLI adapter 对同一 `tool_use` id 重复发出 `tool_start` 事件时（Claude Agent SDK
流式 JSON 解析边界 / assistant 事件二次回放），同一 id 在数组中出现两次，
React 以 `tc.id` 为 key 渲染 → 重复 key 警告。

`claudeAdapter.ts:134` 处理 `tool_use` block 时只在 `runningToolIds` 里防重，
对已完成（已从 `runningToolIds` 移除）但仍在历史里的 tool_use，再次进入
`assistant` 事件循环时仍会二次 emit `tool_start`。

## 方案（最小修改）
在 `aiStore.addToolCall` 加一道按 id 去重的守卫：若该 assistant 消息的
`toolCalls` 中已存在同 id 条目，跳过 push。一处改动覆盖所有 caller
（`AiPanel`、`featureAgentService`）。

## 非目标
- 不改 `claudeAdapter` 的 event 发射逻辑（症状在 store 一层兜住即可，且上游
  重复发射的诱因是 SDK 流式协议本身，不可控）。
- 不改 `ToolCallBlock` 的 key 策略（用 `tc.id` 是正确的，源数据被污染才是问题）。

## 验收
1. 复现路径下不再出现重复 key 警告。
2. `aiStore.test.ts` 新增用例：连续两次 `addToolCall('tc1', ...)` 后
   `toolCalls.length === 1`。
3. 既有 `addToolCall / completeToolCall` 生命周期测试仍通过。
