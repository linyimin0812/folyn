# AI 添加 chat 模式（rig 库实现）

## Goal

在现有 ask / agent 两种 AI 模式之外新增 **chat** 模式。chat 模式用 Rust 的 `rig`（rig-core）库直连 LLM 实现，不经过 `claude` CLI；ask / agent 维持现状（shell 出 claude CLI）。三种模式在**桌宠页面**（PetChat）和 **AI panel**（AiPanel）两端都要可用。

## Requirements

- 新增 `chat` 模式：纯多轮对话，带历史上下文，**无工具、无文件访问**，经 rig（Rust 后端）直连 LLM。
- ask / agent 维持 `claude` CLI shell-out 实现不变；ask=单轮只读（plan），agent=全工具（bypassPermissions）。
- chat / ask / agent 三模式在 AI panel **和** 桌宠页面均可选择与使用。
- **多 provider 可配置**：settings 支持 anthropic / openai / openai-compatible（可填 baseUrl 指向本地或兼容端点），运行时按 chat 模式配置选择。
- chat 会话历史**持久化到磁盘**（JSON，按 sessionId 存 appData），重启后可恢复。
- 桌宠页面 ask/agent 用**当前 vault 根目录**（`settingsStore.vaultPath`）作为 CLI 工作目录，不再用 appData 临时目录。
- chat 模式经 rig 调用，不需要工作目录（无文件访问）。

## Acceptance Criteria

- [ ] AI panel 模式下拉出现 chat / ask / agent 三选项。
- [ ] 桌宠页面有模式切换 UI，三模式可选。
- [ ] chat 模式发送后，经 rig（Rust 后端 `chat_stream` 命令）拿到 LLM 流式回复并渲染。
- [ ] chat 多轮对话保留历史，重启 app 后可恢复会话。
- [ ] ask / agent 行为与改动前一致（仍走 claude CLI，AI panel 端不受影响）。
- [ ] 桌宠端 ask/agent 以当前 vault 根为工作目录。
- [ ] chat 模式不调用 claude CLI、不读写文件、不挂工具。
- [ ] provider 缺 API key / 网络失败时给前端可读错误，不崩溃。

## Definition of Done

- Rust 后端新增 rig-core 依赖 + `chat_stream` Tauri 命令（`ipc::Channel` 流式）+ 磁盘会话存储；`cargo check` 绿。
- 前端按模式路由：chat → rig invoke；ask/agent → CLI adapter（不变）。
- 桌宠 + AI panel 两端 UI 支持三模式切换。
- settings 新增 provider/model/apiKey/baseUrl 配置 + UI。
- lint / typecheck / build 绿。
- 行为变更文档化（settings provider 配置、chat 会话存储位置）。

## Technical Approach

**模式路由**：现有 `ClaudeAdapter.send` 只懂 CLI。chat 不走 CLI。最小做法——在调用点按 `inputMode` 分支：
- `chat` → 调新 Tauri 命令 `chat_stream({ sessionId, provider, model, apiKey, baseUrl, prompt }, channel)`，前端用 `@tauri-apps/api/core` 的 `Channel` 收流式 chunk。
- `ask`/`agent` → 现有 `ClaudeAdapter`（不动）。

不在 `CliAdapter` 接口里硬塞 rig 语义（YAGNI，单实现无需多态）。调用点（AiPanel `:326`、petChatService `:197`）加一层 `if (mode === 'chat') invokeRigChat(...) else adapter.send(...)`。

**Rust 后端**（`apps/desktop/src-tauri/src/`）：
- 新模块 `chat.rs`：`chat_stream` async 命令，arg `tauri::ipc::Channel<ChatChunk>`，按 provider 建 rig client（`rig_core::providers`），`agent(model).preamble(...).stream_prompt(...)`，`while let Some(item) = stream.next().await` 匹配 `StreamedAssistantContent::Text` 推 chunk 到 channel；末尾持久化整段 assistant 回复。
- 会话存储：`<appData>/chat-sessions/<sessionId>.json`，存 `Vec<Message>`（system/user/assistant）。`send` 时加载→append user→调用→append assistant→写回。
- 注册命令到 `lib.rs:435` 的 `invoke_handler`。

**前端**：
- `packages/cli-adapter` 或 `apps/desktop/src/services/` 新增 `rigChat.ts`：封装 `invoke('chat_stream', {..., channel})` + 把 chunk 映射成现有事件类型（`text`/`done`/`error`），复用 AiPanel/PetChat 既有渲染。
- `inputModes.ts`：注册 `chat` 模式（无 permissionMode，标记 `backend: 'rig'`）。
- `petChatService.ts`：`resolveWorkingDir()` 改为按模式——chat 忽略 workingDir；ask/agent 用 `settingsStore.vaultPath`。补 `resolveSendOptions` 调用让桌宠端也认模式。
- 桌宠 PetChat 输入区加模式下拉（镜像 `ChatInput.tsx:303` 模式）。
- settingsStore 加 `chatProvider`/`chatModel`/`chatApiKey`/`chatBaseUrl`；settings 页加配置 UI。

## Decision (ADR-lite)

**Context**：现有 ask/agent 只差一个 CLI flag；要加 chat 且要求走 rig 直连 LLM，绕过 claude CLI。
**Decision**：
1. chat 走 rig（Rust 后端新命令，`ipc::Channel` 流式）；ask/agent 不动 CLI 路径。
2. 多 provider 可配（anthropic/openai/openai-compatible）。
3. chat 历史持久化到磁盘（appData JSON，按 sessionId）。
4. 桌宠 ask/agent 用当前 vault 根作工作目录；chat 无需工作目录。
5. 调用点按 mode 分支，不为 rig 引入新抽象接口。
**Consequences**：chat 与 ask/agent 是两套后端，调用点有分支（可接受，单点）；历史持久化带来磁盘 I/O 与格式演进责任（MVP 用简单 JSON Vec，后续可换 SQLite）；多 provider 增加 settings 复杂度但换来灵活性。

## Out of Scope

- 不动 ask / agent 现有 CLI 路径与 stream-json 协议。
- 不在 chat 里引入工具调用 / function-calling（rig 默认无工具，保持）。
- 不引入前端 LLM SDK（rig 只在 Rust 侧）。
- chat 历史不跨设备同步、不上向量检索/RAG。
- 不做会话列表 UI 的完整管理（MVP 只恢复当前 sessionId 历史；列表/切换会话后续）。

## Technical Notes

- 关键文件（来自代码探查）：
  - 模式系统：`apps/desktop/src/components/ai/inputModes.ts`
  - 活动模式：`apps/desktop/src/store/aiStore.ts:67,358,359`
  - CLI 适配器：`packages/cli-adapter/src/claudeAdapter.ts`（send 66-109, buildClaudeArgs 317-358, shell 365-374）
  - 适配器注册：`packages/cli-adapter/src/registry.ts`
  - 适配器类型：`packages/cli-adapter/src/types.ts`（CliAdapter/CliSendOptions/PermissionMode）
  - AI panel 调用点：`apps/desktop/src/components/ai/AiPanel.tsx:326-330`
  - 桌宠调用点：`apps/desktop/src/services/petChatService.ts:173,197-199`
  - 桌宠 UI：`apps/desktop/src/components/pet/PetChat.tsx`
  - AI panel 输入/模式下拉：`apps/desktop/src/components/ai/ChatInput.tsx:303-334`
  - settings：`apps/desktop/src/store/settingsStore.ts`（vaultPath:73, cliPath:89-90,320-321）
  - Rust 命令注册：`apps/desktop/src-tauri/src/lib.rs:435-480`
  - Rust 命令实现：`apps/desktop/src-tauri/src/commands.rs`
  - shell ACL：`apps/desktop/src-tauri/capabilities/default.json`, `capabilities/pet-panel.json`
- vault 根来源：`settingsStore.vaultPath`（+ `vaultStore.ts`），PetChat 可直接读，无需新 IPC。
- 待实现时注意：rig-core 0.40.0（已用 `cargo info` 对线 crates.io 实时索引确认最新）；API 方法名/类型已对照 0.40.0 发布源码验证——`stream_prompt`/`stream_chat`（`src/streaming.rs`）、`StreamedAssistantContent`、`MultiTurnStreamItem`、`Message` enum、`AgentBuilder<NoToolConfig>`；OpenAI-compatible 本地服务需 `with_system_instructions_as_messages()` 否则 preamble 丢失。Anthropic 模型常量到 `CLAUDE_SONNET_4_6` 等，default model 可直接用常量或 raw `&str`。详见 `research/rig-core-integration.md`。

## Research References

- [`research/rig-core-integration.md`](research/rig-core-integration.md) — rig-core 0.40.0 + Tauri 2.11.2：核心 API、`stream_prompt` 流式语义（`.await` 返回 stream 需 `next()` 轮询）、provider 配置、`ipc::Channel` 流式命令骨架、Cargo.toml 依赖行、rustls 选取与 pitfalls。
