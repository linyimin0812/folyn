# Plugin AI Capability

## Goal

把 quill 现有 AI 能力（rigChat 多轮对话 + featureAgentService 的 feature agent）作为宿主能力暴露给插件使用，统一 chokepoint、声明式权限、可审计。

## What I already know

- AI 能力分两处：
  - `apps/desktop/src/services/rigChat.ts` — chat 流式，Rust `chat_stream` 命令，rig 后端，按 `sessionId` 持久化历史。
  - `apps/desktop/src/services/featureAgentService.ts` — feature agent（study/analyze/clips/schedule/wiki），走 CLI adapter `adapter.send`。
- 插件两层：
  - sandbox tier（`rpcBridge.ts`）：iframe 隔离，postMessage RPC，permissions = `fs/http/clipboard/dialog/window/vault`，**无 AI 入口**。
  - trusted tier（`trustedLoader.ts`）：in-process `import()` 进主 webview realm，TOFU + 完整宿主访问，技术上可直接 `import` 上述 service，但**未声明成稳定 API**。
- manifest 已有 `permissions` 字段（`fs/http/clipboard/dialog/window/vault`），新增 `ai` 是同构扩展。
- `PluginContext`（`packages/plugin-host/src/types.ts`）目前在 PR1 阶段保持骨架，sandbox/trusted 的 RPC + capability 都在 host 侧适配层加。

## MVP Scope (decided)

- **trusted tier**: 全量 — `ai.chat` + `ai.agent`。
- **sandbox tier**: 仅 `ai.chat`（host→iframe push 流式 postMessage）。
- `ai.agent` 不给 sandbox（feature agent 涉及 canonical agent 文件可见性 + 跨 vault 路径，沙盒暴露成本高，留作 follow-up）。

## Decisions (ADR-lite)

1. **MVP 范围**: trusted 全量（chat + agent），sandbox 仅 chat。Agent 沙盒暴露 follow-up。
2. **流式 API**: callback `onEvent: (CliStreamEvent) => void`，与 `runRigChat` 现有签名一致，零抽象成本，sandbox postMessage push 天然 callback-shaped。
3. **permissions.ai 形状**: `{ chat?: boolean; agents?: string[] }`。`ai.agent` 调用时 host 校验目标 feature 名在 `agents` 白名单内。
4. **会话归属**: 默认插件自管 `sessionId`（不进 aiStore UI 列表）；`ai.chat({ useSharedSession: true })` 则 host 创建/复用 aiStore 会话，消息出现在 aiPanel。
5. **Provider/model**: 只走宿主默认配置 + 已存 apiKey；插件不接触密钥、不路由 provider。
6. **Usage/audit**: 不加。宿主本来就两个 chokepoint，需要时再加日志/store。
7. **Plugin SDK**: 不新建包。加一个 example plugin（`examples/plugins/ai-chat-demo/`）+ `docs/plugin-development.md` 章节。

## Requirements

- manifest `permissions.ai?: { chat?: boolean; agents?: string[] }`，host 在激活时校验声明。
- trusted: `PluginContext.ai.chat(params): Promise<void>` 包装 `runRigChat`；`PluginContext.ai.agent(params): Promise<void>` 包装 `runFeatureAgent`。
- sandbox: `rpcBridge.ts` 新增 `ai.chat` method，permission 校验后转发到 `runRigChat`；流式输出通过 postMessage `{type:'ai-stream', id, event}` push 回 iframe。
- provider/model/apiKey 由 host 从用户设置注入，插件不接触。
- `ai.agent` 校验 feature 在白名单；不在白名单拒绝并报错。
- `ai.chat` 默认插件自管 sessionId；`useSharedSession: true` 时复用/创建 aiStore 会话。

## Acceptance Criteria

- [ ] manifest 声明 `permissions.ai.chat` 的 trusted 插件能流式收到 chat token；未声明调用报错。
- [ ] manifest 声明 `permissions.ai.agents: ['study']` 的 trusted 插件能触发 study agent；调未授权 feature 报错。
- [ ] sandbox 插件声明 `permissions.ai.chat` 后通过 RPC 流式收到 chat token；未声明报错。
- [ ] `ai.chat({ useSharedSession: true })` 调用产生的消息出现在 aiPanel。
- [ ] provider/model/apiKey 不出现在 `PluginContext` 或 RPC params 中。
- [ ] 单测覆盖：permissions 校验、trusted ctx 方法、sandbox RPC 转发。

## Definition of Done

- 单元测试覆盖（permissions 校验、trusted ctx 方法、sandbox RPC 转发）。
- lint / typecheck 绿。
- `docs/plugin-development.md` 增补 `permissions.ai` + `PluginContext.ai` 章节。
- `examples/plugins/ai-chat-demo/` 提供可运行示例。

## Technical Approach

复用两个 chokepoint，不新建 service：

- trusted：`trustedLoader.ts` 构造 `PluginContext` 时注入 `ai` 对象，方法体直接调 `runRigChat` / `runFeatureAgent`，权限从 manifest 读。
- sandbox：`rpcBridge.ts` 的 request handler 加 `ai.chat` 分支，校验 `manifest.permissions.ai?.chat` 后转发到 `runRigChat`，streaming 通过新增 `{type:'ai-stream', id, event}` 消息 push 回 iframe。
- 类型：`packages/plugin-host/src/types.ts` 加 `PluginPermissions.ai` + `PluginContext.ai`。

## Implementation Plan (small PRs)

- **PR1**: 类型骨架 — `permissions.ai` + `PluginContext.ai` 接口；trusted ctx 注入 stub（暂返回 not-implemented）；单测覆盖 permission 校验逻辑。
- **PR2**: trusted 实现 — `ai.chat` 包装 `runRigChat`（含 `useSharedSession` 分支）；`ai.agent` 包装 `runFeatureAgent`（含 agents 白名单校验）；单测覆盖 happy path + 拒绝路径。
- **PR3**: sandbox 实现 — `rpcBridge.ts` 加 `ai.chat` method + permission 校验 + postMessage 流式 push；单测覆盖转发 + 流顺序 + 错误分支。
- **PR4**: 示例插件 `examples/plugins/ai-chat-demo/`（trusted + sandbox 各一）+ docs 章节。

## Out of Scope

- sandbox `ai.agent`（canonical agent 文件可见性策略留作 follow-up）。
- 新增 LLM provider 或重写 rig 后端。
- 暴露 apiKey 给插件。
- usage/audit store + Settings 面板。
- 跨插件 AI 会话共享 / 队列调度。
- 新建 `@quill/plugin-ai-sdk` 包。

## Technical Notes

- 关键文件：
  - `packages/plugin-host/src/types.ts`（manifest + PluginContext）
  - `apps/desktop/src/services/plugin-host/rpcBridge.ts`（sandbox RPC）
  - `apps/desktop/src/services/plugin-host/trustedLoader.ts`（trusted ctx 装配）
  - `apps/desktop/src/services/rigChat.ts` / `featureAgentService.ts`（复用 chokepoint）
- 约束：sandbox iframe 跨 origin 只能 postMessage；trusted blob URL 不能解析相对 import。
- `CliStreamEvent` 类型来自 `@quill/cli-adapter`，`onEvent` 签名直接复用。
