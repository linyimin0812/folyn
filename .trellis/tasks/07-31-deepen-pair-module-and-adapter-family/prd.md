# deepen-pair-module-and-adapter-family

## Goal

把 provider+model "pair" 从四种散落形态收敛成 `aiConfigStore.ts` 里的一个深接口（`resolvePairForSession`），顺手修两处类型/路径泄漏：PairSelector 的 `as ChatProvider` 强转、`defaultChatEndpoint` 的 enum 中转。这是 AI/chat 子系统架构评审（2026-07-30）的首选候选项 B。

## What I already know

来源：架构评审 HTML 报告 + grilling 决策树（10 个 Q&A）。

### 现状四种 pair 形态
1. `AiSession.provider/model`（per-session）—— **合法 session 状态，保留**
2. `aiConfigStore.chatProvider/chatModel`（全局"上次用"）—— `createEmptySession` 继承它，`setSessionPair` 双写它 —— **删**
3. `petPair/bubblePair/voicePair/pluginPair`（per-caller 全局）—— **拆分**：pet/bubble 搬到各自 session；voice/plugin 保留（无 session 可挂）
4. `CliMessage.provider/model` + `PetChatMessage.provider/model`（盖在 assistant 气泡上）—— **保留**，记录"是谁产生了这条回复"，切换 pair 中途保留历史 tag。grilling 排除了候选 E（删戳）。

### 类型/路径泄漏
- `ChatProvider = ChatProviderId`（bundled id 字面量联合），自定义 provider id 不在其中，PairSelector 用 `entry.id as ChatProvider` 强转绕过。用法全是 `===` 相等，没有穷尽 match。
- `CustomProviderDef.defaultChatEndpoint: DefaultChatEndpoint` 是个 enum（`"anthropic-messages"` 等），在 `chat.rs:289` 1:1 映射到 bundled adapter family id（`"anthropic"` 等）。1:1 转发，无分叉，是纯中间层。

## Assumptions (temporary)

- 项目 pre-launch，无外部用户。开发者自用持久化数据可接受一次性重置。
- `petChatStore` 和 `bubbleTemplateChatStore` 都有 session 概念（确认过 `PetChatSession` interface）。
- `useVoiceInput` 和 `aiCapability` 无 session 概念（一次性 sessionId）。

## Requirements

### 状态收敛
1. 删除 `aiConfigStore` 的 `chatProvider`/`chatModel` 字段及其 setter
2. 删除 `aiStore.setSessionPair` 的双写逻辑（只写 session）
3. 删除 `aiStore.reconcileSessionPair`（mount 时不再 reconcile 全局）
4. `createEmptySession` 改为：从最近一条 session 复制 pair；若没有，回落 catalog 第一个 enabled provider + 第一个 selectedModel
5. `PetChatSession` 加 `provider?`/`model?` 字段；petChatStore 加 `setSessionPair(sessionId, pair)` action
6. bubble session（`bubbleTemplateChatStore`）同样加 pair 字段 + setter
7. 删除 `aiConfigStore` 的 `petPair`/`bubblePair` 字段及其 setter（`voicePair`/`pluginPair` 保留）

### 新接口
8. `aiConfigStore.ts` 加 `resolvePairForSession(sessionId): ResolvedPairConfig | null`，内部读 session 的 pair 再走现有 `resolvePairConfig`
9. AiPanel/pet/bubble 的 send 路径改用 `resolvePairForSession(sessionId)` 取代直接读全局
10. `resolvePairConfig(pair, state)` 保留，供 voice/plugin 路径继续用

### 类型修正
11. `ChatProvider` 从 `ChatProviderId` 改为 `string`（保留 `isChatProvider` 运行时守卫）
12. 删除 `PairSelector.tsx:46-53` 的 `entry.id as ChatProvider` 强转
13. `CustomProviderDef.defaultChatEndpoint: DefaultChatEndpoint` → `adapterFamily: string`（值 = bundled id：`"anthropic"` / `"openai-completions"` / `"ollama"` / `"gemini"` / `"openai"`）
14. `ResolvedPairConfig.defaultChatEndpoint?` → `adapterFamily?`
15. `RigChatParams.defaultChatEndpoint?` → `adapterFamily?`
16. `ChatParams.default_chat_endpoint: Option<String>` → `adapter_family: Option<String>`
17. `chat.rs` 的 `if params.custom_provider { match default_chat_endpoint ... } else { provider }` 收成 `let resolved = params.adapter_family.as_deref().unwrap_or(params.provider.as_str());`
18. 删除 `DefaultChatEndpoint` enum 类型

### 迁移
19. 不写迁移代码（pre-launch 无用户）。旧持久化 blob 的 `petPair`/`bubblePair`/`chatProvider`/`chatModel`/`defaultChatEndpoint` 由 hydrate 的 unknown-key drop 自然丢弃；pet/bubble session 的 `pair` 字段加载时为 undefined，第一次发消息走"回落第一个 enabled"分支。开发者自用一次性重选 pair。

### 测试
20. 更新 `aiConfigStore.test.ts` 的 `resolvePairConfig` 现有测试到 `resolvePairForSession(sessionId)` 新签名
21. `aiStore.test.ts` 加一个 `createEmptySession` seeding 测试（有 session 时复制最近；无 session 时回落第一个 enabled）
22. `chat.rs` 加一个 `resolved` 查找的最小单测：bundled provider 用 `params.provider`，custom 用 `params.adapter_family`

## Acceptance Criteria

- [ ] `grep -r "chatProvider\|chatModel" apps/desktop/src/store/aiConfigStore.ts apps/desktop/src/store/aiStore.ts | grep -v "//\|test"` 为空（生产代码无引用）
- [ ] `grep -r "petPair\|bubblePair" apps/desktop/src --include="*.ts" --include="*.tsx" | grep -v "//\|test\|voicePair\|pluginPair"` 为空
- [ ] `grep -rn "as ChatProvider" apps/desktop/src --include="*.ts" --include="*.tsx"` 为空
- [ ] `grep -rn "defaultChatEndpoint\|default_chat_endpoint\|DefaultChatEndpoint" apps/desktop/src apps/desktop/src-tauri/src` 为空
- [ ] `resolvePairForSession` 在 aiConfigStore 导出且签名正确
- [ ] `createEmptySession` 在有 sessions 时复制最近一条的 pair；无 sessions 时回落第一个 enabled
- [ ] chat.rs 的 `resolved` 查找用 `adapter_family.as_deref().unwrap_or(provider.as_str())`，custom 和 bundled 走同一条路
- [ ] 切换 session pair 后，历史 assistant 气泡的 pair tag 保留原值（戳仍在消息上）
- [ ] `pnpm test` 全绿
- [ ] `cargo test` 的 chat.rs 测试全绿
- [ ] pet/bubble/voice/plugin 四条 chat 路径端到端可用（手动）

## Definition of Done

- 测试更新 + 新增（见上）
- `pnpm lint` / `pnpm typecheck` 全绿
- `cargo check` / `cargo clippy` 全绿
- spec 文档 `.trellis/spec/desktop/frontend/state-management.md` 若涉及 pair 状态管理需要更新
- ADR-0002 记录"adapterFamily 直接声明，不走 enum 中转"决策（沿用 ADR-0001 格式）

## Out of Scope（独立候选，留给后续 grilling）

- **A**：`adapterManager.ts` 与 `petChatService.ts:52-75` 的 adapter 缓存去重 —— 独立，B 落地后便宜但本任务不做
- **C**：`ProviderDetailSection` 31 props 内联回 ModelServicesSettings —— 独立 shallow split 修复
- **D**：TS↔Rust chat 类型 codegen（ts-rs 等）—— 独立 ports & adapters 工作
- **F**：`BubbleTemplateAIChatModal` 折进共享 chat pipeline —— 依赖 B 落地，独立任务更合适
- **chat.rs 的 8 个 match 臂去重** —— 文件已自文档化为 ponytail 债，独立任务

## Technical Approach

### 关键设计

**Pair 作为 `aiConfigStore.ts` 里的函数，不开新文件**。深模块 = 接口语义，不是文件个数。`resolvePairForSession(sessionId) → ResolvedPairConfig | null` 内部吸收：session 查找（aiStore）+ provider 目录查找 + providerSettings/apiKey 校验。voice/plugin 走原有 `resolvePairConfig(pair, state)` 路径不变。

**`ChatProvider` 改 `string`** —— 联合类型提供的安全性已被强转实际绕过，`string` 只是承认现实。`isChatProvider` 运行时守卫保留。

**`defaultChatEndpoint` enum 整个删掉**，custom provider 直接声明 `adapterFamily: string`（值就是 bundled id）。Rust 侧 `if custom_provider { match ... } else { provider }` 收成单行 `unwrap_or`。1:1 转发 = 无抽象价值的中间层。

### 影响面

- TS：`aiConfigStore.ts`、`aiStore.ts`、`petChatStore.ts`、`bubbleTemplateChatStore`（在 `BubbleTemplateAIChatModal.tsx` 内）、`PairSelector.tsx`、`AiPanel.tsx`、`PetChat.tsx`、`petChatService.ts`、`aiCapability.ts`、`useVoiceInput.ts`、`rigChat.ts`、`providers/catalog.ts`、`CustomProviderDrawer`/`ProviderDetailSection`（UI 文案改 endpoint → adapter family 概念）
- Rust：`chat.rs`

## Decision (ADR-lite)

**Context**: 架构评审发现 pair 散落四种形态 + 两处类型/路径泄漏（PairSelector 强转、defaultChatEndpoint 三段跳）。
**Decision**:
1. Pair 作为 `aiConfigStore.ts` 函数（非新文件），删 (b) 全局 + (c) 的 pet/bubble 部分
2. `ChatProvider` 改 `string`，删强转
3. `defaultChatEndpoint` enum 整个删掉，custom provider 直接声明 `adapterFamily`
4. 不写迁移（pre-launch）
5. 删 E（消息盖戳是承重的历史记录，不删）
**Consequences**:
- 减少三种冗余 pair 形态
- PairSelector 强转消失，类型系统不再撒谎
- chat.rs 中间层 enum 消失，custom 和 bundled 走同一条路
- 开发者自用一次性重选 pair（pre-launch 可接受）
- 后续候选 A/C/D/F 独立推进，B 落地后 F 变便宜

## Technical Notes

### 关键文件 + 行号

- `apps/desktop/src/store/aiStore.ts:39-56,131-147,422-453` — AiSession pair + createEmptySession + setSessionPair/reconcileSessionPair
- `apps/desktop/src/store/aiConfigStore.ts:93-176,570-600` — pair globals + hydrate
- `apps/desktop/src/store/petChatStore.ts:37-65` — PetChatSession interface
- `apps/desktop/src/components/ai/PairSelector.tsx:46-53` — 强转点
- `apps/desktop/src/services/rigChat.ts:16-106` — ChatChunk / RigChatParams 手抄
- `apps/desktop/src-tauri/src/chat.rs:101-111,283-310` — ChatParams.default_chat_endpoint + match 映射
- `apps/desktop/src/store/aiConfigStore.ts:123-145` — resolvePairConfig

### 已有的"不修改"清单（架构评审识别的深模块）

- `chat.rs` 的 `drain_loop` / `thinking_params` — 8 provider 共用的 generic stream drain
- `rigChat.ts` 作为 TS↔Rust 承重桥（类型手抄是 D 候选，不在本任务）
- `ChatMessageList.tsx` 的 prop 面（renderPairTag 由 caller 传）
- `inputModes.ts` 的插件注册表
- `aiCapability.ts` 的插件咽喉点

### 参考资料

- 架构评审 HTML 报告（已写至 $TMPDIR/architecture-review-1785426134.html）
- ADR-0001（`docs/adr/0001-bubble-template-ai-agent-chat-not-loop.md`）—— 沿用其"考虑过 X 并拒绝"格式
- CONTEXT.md —— "Bubble Template AI Agent" / "Feature Agent" 领域语言（"Pair" 是架构概念不入此文件）
