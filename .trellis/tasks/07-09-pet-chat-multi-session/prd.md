# PetChat 多 session

## Goal

为桌宠 chat 引入多 session 支持：用户可在多个会话之间新建 / 切换 / 删除，每个 session 独立保存消息历史。复用上一任务在 `ChatMessageList` 预留的 `sessions?`/`activeSessionId?`/`onSwitchSession?` 扩展点与共用 chat 组件。需先厘清 pet session 的语义（是否跨轮记忆），并保持 vault-free / `bare:true` / appData cwd / 独立 Tauri 窗口等既有约束。

## What I already know

- 上一任务（07-09-desktop-pet-chat-and-ai-panel-shared-ui，已提交 a60c5ae）将 PetChat 接入共用 `components/chat/` 组件，并在 `ChatMessageList` 上预留了 `sessions?`/`activeSessionId?`/`onSwitchSession?` 可选 props（类型存在，UI 未渲染切换控件）。Research 结论：session list header 由各 host 自绘，不入共用 list。
- `petChatStore.ts`：`PetChatMessage = {id, role:'user'|'assistant', content, ts}`；持久化 namespace `pet-chat:messages`（单线 flat 数组）；`streaming` 运行时态。无 session 概念。
- `petChatService.ts`：一个缓存型 `CliAdapter`（按 `settings.cliAdapter` id 缓存）；`sendPetChatMessage(prompt, {onToken,onDone,onError})`；`adapter.send(prompt, { bare: true })`，**无 `resumeSessionId`** → 每次发送为全新交换；cwd=`<appData>/pet-chat-tmp`；`stopPetChat`/`resetPetChatAdapter`。
- `petChatService` 当前只处理 `text`/`error`/`done` 三种 `CliStreamEvent`，**丢弃 `session_id` 事件**。
- AiPanel 的 session 模型（参考）：`aiStore` 持有 `sessions[]`/`activeSessionId`/per-mode active session；`aiSessionPersistence` per-vault 持久化；`adapterManager` per-session adapter Map；resume via `cliSessionId` + `resumeSessionId`；header（下拉 新建/删除/切换）由 AiPanel 自绘。
- PetChat 运行在独立 `pet-panel` Tauri 窗口；不得顶层 import vault/editor/aiStore。`petChatStore` 是 pet 专属，可自由演进。
- PetPanelApp 有 Chat / Actions 两个标签页；session 切换 UI 应放 Chat 标签页内（header 区域）。

## Assumptions (temporary)

- pet session = 独立消息历史（多线程），切换/新建/删除。是否跨轮 AI 记忆待定（见 Open Questions）。
- session 持久化沿用 `petChatStore` 的 storageClient，但需从 flat `pet-chat:messages` 迁移到 sessions 结构。
- 共用 `ChatMessageList` 的预留 props 在本任务中真正接线（或由 PetChat 自绘 header + 只传 messages/streaming）。

## Decision (ADR-lite) — session 语义

**Context**: pet session 需确定是否跨轮 AI 记忆，决定 service/adapter/持久化全盘。
**Decision**: 方案 B —— 真·会话记忆。session 内 AI 跨轮记忆（接管 `session_id` 事件 + `send` 传 `resumeSessionId`），session 间隔离。保留 `bare:true`（仅控制系统提示/不注入 vault 材料，记忆由 `resumeSessionId` 提供，二者正交）。
**Consequences**: 需改 `petChatService` 事件映射（接管 `session_id`）、改为 per-session adapter 模型、store 持久化 cliSessionId per session；体验对齐 AiPanel。

## Decision (ADR-lite) — adapter 模型（推导确定）

**Context**: `claudeAdapter.send` 每次 spawn 新进程，但 adapter 内部缓存 `this.sessionId` 作 resume 回退；单共享 adapter 服务多 session 会导致新建 session 首次发送误回退到上一 session 的 id（串台）。
**Decision**: `petChatService` 改为 per-session adapter（`Map<sessionId, CliAdapter>`，镜像 AiPanel 的 `adapterManager`）；每 session 的 adapter 缓存各自的 cliSessionId。
**Consequences**: 与 AiPanel 模式一致、隔离安全；`resetPetChatAdapter` 演进为按 session 或全量清理；adapter 实例非序列化，存于 service 模块而非 store。

## Decision (ADR-lite) — session UI

**Context**: 需确定 session 切换 UI 形态与操作集，适配 600px pet-panel 窗口。
**Decision**: 方案 A —— 对齐 AiPanel。Chat 标签页内一行 header：当前 session 标题 + ▾ 下拉（session 列表 / 新建 / 删除），可选重命名。紧凑、与 AiPanel 体验一致。
**Consequences**: PetPanelApp/PetChat 需自绘 session header（共用 `ChatMessageList` 的预留 session props 不渲染 header，仅作 list 层扩展点保留）；下拉组件可复用 AiPanel 现有 session 下拉模式。

## Open Questions

- （已收敛，无阻塞；护栏数值见 Requirements，可在最终确认时调整。）

## Requirements

- **Store 模型**：`petChatStore` 从单线 `PetChatMessage[]` 演进为 `sessions: PetChatSession[]` + `activeSessionId`，`PetChatSession = { id, title, messages: PetChatMessage[], cliSessionId?: string }`。持久化 namespace 从 `pet-chat:messages` 迁移到 `pet-chat:sessions`（沿用 storageClient）。
- **迁移**：首次加载若 `pet-chat:sessions` 缺失但 `pet-chat:messages` 存在，将旧 flat 数组包成默认 session（标题「默认会话」），activeSessionId 指向它；不丢历史。`streaming` 仍运行时态。
- **Service**：`petChatService` 改 per-session adapter（`Map<sessionId, CliAdapter>`，镜像 `adapterManager`）；`sendPetChatMessage(sessionId, prompt, {onToken,onDone,onError})` 传 `resumeSessionId = session.cliSessionId ?? undefined`；接管 `session_id` 事件 → 写回 `session.cliSessionId`；保留 `bare:true` + appData cwd（共享 `pet-chat-tmp`）。`stopPetChat(sessionId)` + `resetPetChatAdapter(sessionId?)`（无参=全量）。
- **事件归属防竞态**：流式回调（onToken/onDone/onError/session_id 写回）按「触发 send 的 sessionId」归属，不读「当前 active」，避免切走后晚到的 `session_id` 落到错误 session。
- **UI**：Chat 标签页内自绘 session header（当前标题 + ▾ 下拉：session 列表 / 新建 / 重命名 / 删除），复用 AiPanel 下拉模式；未配置 AI 时不渲染 header（仍显示 CTA）。复用共用 `ChatMessageList` + `ChatInputBox`（messages 取 active session）。
- **操作语义**：
  - 新建：创建空 session 并切到它；若达上限（默认 50）则禁用新建 + 提示。
  - 切换：流式中切换 → 先 `stopPetChat(current)` 再切；切到目标 session 后其历史恢复。
  - 删除：二次确认（内联确认/小弹窗）；流式中删除 → 先 stop + 从 Map 移除 adapter；删最后一个 → 自动新建空 session 并切到它。
  - 重命名：内联编辑标题。
- **卸载**：PetChat unmount 时 stop + reset 所有 active adapter（演进旧的单 adapter 清理）。
- **约束保留**：vault-free（无附件/@提及/工具调用/markdown）、`bare:true`、appData cwd、独立 pet-panel 窗口、不顶层 import vault/editor/aiStore。

## Acceptance Criteria

- [ ] 新建/切换/删除/重命名 session 均可用，各 session 消息与 cliSessionId 隔离。
- [ ] session 内 AI 跨轮记忆（`resumeSessionId` 生效），session 间不串台。
- [ ] 旧单线 `pet-chat:messages` 历史迁移到默认 session，重启后恢复。
- [ ] 流式中切换/删除先停当前 adapter；删最后一个自动新建空 session。
- [ ] `session_id` 事件按 send 归属，切走后晚到的事件不污染其他 session。
- [ ] session 数达上限禁用新建；删除有二次确认。
- [ ] 卸载窗口时所有 active adapter 被停止。
- [ ] 未配置 AI 时显示 CTA、不渲染 session header。
- [ ] typecheck + 既有 PetChat/PetPanelApp 测试通过 + 新增 session 测试通过。

## Definition of Done (team quality bar)

- 测试更新且通过（store 迁移、service per-session + session_id 归属、UI 操作、边界）。
- Lint / typecheck / CI green。
- 行为/约束变化记录于任务 notes。
- 若 session 模型有可复用契约，更新 spec（如 pet session 与 AiPanel session 的异同）。

## Out of Scope (explicit)

- 不引入附件/@提及/markdown/工具调用（vault-free 保留）。
- 不改 `bare:true` 语义（仅控制系统提示，不涉及记忆）。
- 不动 AiPanel 的 session/adapter（`aiStore`/`adapterManager` 不变；pet 独立实现，不强行合并）。
- 不动 PetPanelApp 的 Actions 标签页与窗口外壳。
- 不做跨设备同步/导出/置顶/搜索。
- 不改共用 `chat/` 组件内部（仅接线预留 props 或由 host 自绘 header）。

## Technical Approach

1. **Store**：`petChatStore` → `sessions[]`+`activeSessionId`+`cliSessionId` per session；迁移逻辑在初始化；actions: `createSession/switchSession/deleteSession/renameSession/appendMessage/appendToLastMessage(clear→clearActive)/setStreaming/setCliSessionId`。
2. **Service**：`petChatService` → per-session adapter Map；`sendPetChatMessage(sessionId, prompt, handlers)` 传 `resumeSessionId`；事件 handler 闭包捕获 `sessionId` 归属；`session_id` → `setCliSessionId(sessionId, id)`；`stopPetChat(sessionId)` / `resetPetChatAdapter(sessionId?)`。
3. **UI**：PetPanelApp/PetChat 自绘 session header 下拉（new/switch/delete/rename + 二次确认 + 上限）；`ChatMessageList` 喂 active session 的 messages + streaming；`ChatInputBox` 喂 active session 输入。

## Implementation Plan (small PRs)

- PR1: `petChatStore` sessions 模型 + 迁移 + actions + 单测。
- PR2: `petChatService` per-session adapter + `resumeSessionId` + `session_id` 归属 + stop/reset + 单测。
- PR3: PetChat/PetPanelApp session header UI（下拉/重命名/二次确认/上限）+ 接线共用组件 + 既有测试更新。

## Technical Notes

- 关键文件：`apps/desktop/src/store/petChatStore.ts`、`apps/desktop/src/services/petChatService.ts`、`apps/desktop/src/components/pet/PetChat.tsx`、`apps/desktop/src/components/pet/PetPanelApp.tsx`、`apps/desktop/src/components/chat/ChatMessageList.tsx`（预留 props）。
- 参考上一任务 research：`.trellis/tasks/07-09-desktop-pet-chat-and-ai-panel-shared-ui/research/input-and-streaming.md`（pet service 事件映射、adapter 生命周期）。
- `CliStreamEvent.session_id` 事件目前被 pet 丢弃；若要 resume 需接管。
