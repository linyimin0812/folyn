# 桌宠 chat 与 AI panel 共用一套 UI

## Goal

桌宠的 chat 页面（`PetChat`）与 AI panel 的 chat 页面（`AiPanel` 中的 Chat 模式）目前是两套完全独立的 UI 实现。本任务将它们重构/抽取为一套共用 chat UI 组件，由两端复用，消除重复实现与样式分叉，同时保留 PetChat 的「vault-free 最小模式」特性。

## What I already know

- 仓库为 monorepo，桌面端 `apps/desktop`：React 18 + TS + Tauri 2 + Zustand 5 + Tailwind + 全局 `index.css` 主题变量。
- 桌宠 chat 在独立 Tauri 窗口（`#/pet-panel`）挂载，目录 `src/components/pet/`：
  - `PetPanelApp.tsx`（窗口外壳：拖拽头、关闭、Chat/Actions 标签页）
  - `PetChat.tsx`（chat 视图：消息列表 + textarea + 发送/停止 + 清空）
  - `pet.css`（手写 BEM `.pet-chat-*` / `.pet-panel-*`，scoped via `html.is-pet-panel-window`）
  - `store/petChatStore.ts`（独立 Zustand store，`pet-chat:messages`）
  - `services/petChatService.ts`（缓存型 CliAdapter，`bare:true`，cwd=`<appData>/pet-chat-tmp`，每次发送为全新交换）
- AI panel 在主窗口右侧，目录 `src/components/ai/`：
  - `AiPanel.tsx`（外壳：resize、session 下拉、新建/删除、Chat/Wiki/Clip 模式标签）
  - `ChatMessages.tsx`、`ChatInput.tsx`、`MessageContent.tsx`（markdown）、`ToolCallBlock.tsx`、`FileImage.tsx`、`inputModes.ts`
  - `store/aiStore.ts` + `aiSessionPersistence.ts`（多 session、per-vault）
  - `adapterManager.ts`（per-session adapter Map，cwd=vault，`resumeSessionId`）
  - 样式：Tailwind utility + `index.css` 全局类（`.ai-body`、`.ai-streaming-indicator`、`.msg-md`、`.msg-thinking` 等）
- 两端**已共享**：`@quill/cli-adapter`（CliAdapter + CliStreamEvent）、`useSettingsStore`（cliAdapter + cliPath）、Tauri clipboard、`index.css` 主题变量。
- **无任何共享 chat 组件目录**（无 `components/chat` / `components/shared`）。
- PetChat 刻意为 vault-free（无 file mention / 附件 / wiki-clip / `bare:true` / 中性 cwd / 每次全新交换）；共享 UI 必须保留此「最小模式」，不得引入 vault 相关特性。

## Assumptions (temporary)

- 共用 UI 应以 AiPanel 的 Tailwind 体系为基准（体量更大），PetChat 端迁移到该体系，`pet.css` 仅保留窗口外壳 `.pet-panel-*`。
- 共用组件应放新目录 `src/components/chat/`，两端均从该目录导入。
- 共用组件为「presentational」性质：接收 messages 与回调，内部不绑定具体 store/adapter。
- PetChat 的 vault-free 约束意味着共用组件必须能以「能力子集」形态运行（不传附件 / 不传 markdown / 不传工具调用）。

## Decision (ADR-lite) — 共享范围

**Context**: 两端在表现层与数据层均分叉，需确定抽取的深度。
**Decision**: 方案 B —— 表现层完全统一 + 数据层部分统一。抽取共用 presentational chat 组件；message 类型统一为 `CliMessage` 超集；但 store/adapter 各自管理（PetChat 保留自己的 `petChatStore` + `petChatService`，用一个简化 session 视图喂给共用组件）。
**Consequences**: 消除 UI 与样式重复，同时保留 PetChat 的 vault-free / `bare:true` / appData cwd 隔离；代价是 PetChat 需将其 `{id,role,content,ts}` 适配为 `CliMessage`，store 层仍存在少量结构性重复（可接受）。

## Decision (ADR-lite) — 样式方向

**Context**: 两端样式系统分叉（BEM pet.css vs Tailwind + index.css）。
**Decision**: 方案 A —— 共用组件全部基于 Tailwind；PetChat 迁移到 Tailwind 后删除 `pet.css` 中所有 `.pet-chat-*`，仅保留 `.pet-panel-*` 窗口外壳样式。
**Consequences**: 彻底消除两套样式系统，共用组件样式自洽于 Tailwind token 体系；PetChat 窗口外壳（拖拽头/关闭/标签页）仍由 `pet.css` 的 `.pet-panel-*` 承载，与 chat 内容解耦。

## Decision (ADR-lite) — 组件分解与输入框 API

**Context**: 共用组件需同时服务 PetChat（最小）与 AiPanel（全功能），输入框能力差最大。
**Decision**: 方案 C —— 单一 `ChatInputBox` + 子组件插槽（slots/children）。基础结构（textarea + 发送/停止 + 可选清空）由 `ChatInputBox` 承载；附件 / @提及 / inputMode / 文件选择等高级能力通过显式插槽注入，AiPanel 传入，PetChat 不传则不渲染。
共用组件清单（`src/components/chat/`）：
- `ChatMessageList` — 列表 + auto-scroll + 空状态 + streaming 指示器；props: `messages: CliMessage[]`, `streaming`, `onClear?`, `emptyState?`, `renderMessage?(msg)`。
- `MessageContent` — markdown 渲染器（从 `ai/` 迁入）；PetChat 路径下退化为纯文本（不启用 markdown 标记）。
- `ChatInputBox` — textarea + 发送/停止 + 可选清空；插槽：`leading?`（附件行等）、`trailing?`（inputMode 选择等）、`mentionLayer?`（@提及浮层）。
**Consequences**: 基础组件无内部分支、职责清晰；扩展点显式（插槽），未来新增能力不污染最小路径；AiPanel 需将其附件/提及/inputMode 现有逻辑注入对应插槽。

## Open Questions

- （已收敛，无阻塞问题）

## Requirements

- 新建 `apps/desktop/src/components/chat/` 目录，承载共用 chat UI：
  - `ChatMessageList`：消息列表 + auto-scroll + 空状态 + streaming 指示器。接收 `messages: CliMessage[]`、`streaming`、`onClear?`、`emptyState?`、`renderMessage?(msg)`；预留 session 切换可选 props（`sessions?`、`activeSessionId?`、`onSwitchSession?`），PetChat 不传、UI 暂不实现切换控件。
  - `MessageContent`：markdown 渲染器（从 `components/ai/MessageContent.tsx` 迁入）；支持「纯文本退化」路径（PetChat 不启用 markdown 标记）。
  - `ChatInputBox`：textarea + 发送/停止 + 可选清空；插槽 `leading?`（附件行等）、`trailing?`（inputMode 选择等）、`mentionLayer?`（@提及浮层）。Enter 发送 / Shift+Enter 换行 / 空输入 disabled。
- message 类型统一为 `CliMessage`（来自 `@quill/cli-adapter`）作为超集；PetChat 将其 `{id,role,content,ts}` 适配为 `CliMessage`（无 thinking/toolCalls/attachments）。
- PetChat（`PetChat.tsx`）改用 `ChatMessageList` + `MessageContent`（纯文本路径）+ `ChatInputBox`；保留 `petChatStore` + `petChatService` 不动；保留 vault-free / `bare:true` / appData cwd / 每次全新交换 / 清空 / 复制 / 未配置 CTA 行为。
- AiPanel（`AiPanel.tsx` + `ChatMessages.tsx` + `ChatInput.tsx`）改为复用 `ChatMessageList` + `MessageContent` + `ChatInputBox`，通过插槽注入附件 / @提及 / inputMode / 文件选择；保留 `aiStore` + `adapterManager` + 多 session / wiki / clip / markdown / 工具调用 / watcher pause-resume 等行为。
- 共用组件全部 Tailwind 样式；删除 `pet.css` 中所有 `.pet-chat-*`，保留 `.pet-panel-*` 窗口外壳。
- PetChat 共用气泡复制按钮顺带让 AiPanel 获得复制能力（小幅增强，可接受）。

## Acceptance Criteria

- [ ] `src/components/chat/` 存在 `ChatMessageList` / `MessageContent` / `ChatInputBox`，PetChat 与 AiPanel 均引用。
- [ ] PetChat 行为与重构前一致：发送 / 停止 / 清空 / 复制 / 未配置 CTA / auto-scroll / Enter 发送 / Shift+Enter 换行 / 卸载时 stop+reset。
- [ ] AiPanel 行为与重构前一致：多 session 切换 / chat-wiki-clip 模式 / 附件 / @提及 / inputMode / markdown / 工具调用 / streaming cursor / watcher pause-resume。
- [ ] `CliMessage` 作为两端 message 超集；PetChat 适配层类型正确。
- [ ] `pet.css` 中 `.pet-chat-*` 全部移除，`.pet-panel-*` 保留且窗口外壳正常。
- [ ] `ChatMessageList` 预留 session 切换可选 props（类型存在，PetChat 不传，UI 不渲染切换控件）。
- [ ] Lint / typecheck / 既有测试（`PetChat.test.tsx`、`PetPanelApp.test.tsx`、AiPanel 相关）通过。

## Definition of Done (team quality bar)

- 既有测试更新且通过；必要时新增共用组件单测。
- Lint / typecheck / CI green。
- 行为/样式变化记录于任务 notes（如 AiPanel 新增复制按钮）。
- `pet.css` 中 `.pet-chat-*` 已清理。

## Out of Scope (explicit)

- 不为 PetChat 实现多 session UI（仅预留 props 扩展点）。
- 不动 `petChatStore` / `petChatService` / `aiStore` / `adapterManager` 的内部实现与生命周期。
- 不引入新 mode（wiki/clip 之外）。
- 不改 PetChat 的 vault-free 约束（无附件/@提及/markdown/inputMode/工具调用）。
- 不动 PetPanelApp 的 Actions 标签页与窗口外壳逻辑。

## Technical Approach

1. 新建 `src/components/chat/`，迁入并改造 `MessageContent`（增加纯文本退化）；实现 `ChatMessageList`（含预留 session props）与 `ChatInputBox`（插槽式）。
2. PetChat 接入：写 `PetChatMessage → CliMessage` 适配，替换内联列表/输入为共用组件，迁移样式到 Tailwind。
3. AiPanel 接入：`ChatMessages` → `ChatMessageList`、`ChatInput` → `ChatInputBox` + 插槽注入附件/提及/inputMode。
4. 清理 `pet.css` 的 `.pet-chat-*`；补/改测试。

## Implementation Plan (small PRs)

- PR1: 抽取共用组件 `src/components/chat/`（`MessageContent` 迁入 + `ChatMessageList` + `ChatInputBox`），含单测；此时尚未接入两端。
- PR2: AiPanel 接入共用组件（含插槽注入），保持行为一致，更新既有测试。
- PR3: PetChat 接入共用组件 + 适配 CliMessage + Tailwind 迁移，删除 `pet.css` `.pet-chat-*`，更新既有测试。

## Requirements (evolving)

- 抽取一套共用 chat UI 组件，供 `PetPanelApp` 与 `AiPanel` 同时复用。
- PetChat 的 vault-free、单线会话、`bare:true`、每次全新交换等既有行为保持不变。
- AiPanel 的多 session / wiki / clip / 附件 / @提及 / markdown / 工具调用等能力保持不变。

## Acceptance Criteria (evolving)

- [ ] 存在 `src/components/chat/` 共用组件，两端均引用。
- [ ] PetChat 端行为与重构前一致（发送/停止/清空/复制/未配置 CTA/auto-scroll/Enter 发送）。
- [ ] AiPanel 端行为与重构前一致（session/模式/附件/提及/markdown/工具调用/streaming cursor）。
- [ ] Lint / typecheck / 既有测试通过。

## Definition of Done (team quality bar)

- 既有测试更新且通过；必要时新增共用组件测试。
- Lint / typecheck / CI green。
- 若行为/样式有变化，记录于任务 notes。
- `pet.css` 中 `.pet-chat-*` 若废弃则清理。

## Out of Scope (explicit)

- 待确认。

## Technical Notes

- 关键文件路径见探查结论（PetPanelApp/PetChat/pet.css/petChatStore/petChatService vs AiPanel/ChatMessages/ChatInput/MessageContent/ToolCallBlock/inputModes/adapterManager/aiStore）。
- 两种样式系统并存：BEM pet.css vs Tailwind + index.css。
- PetChat 在独立 Tauri 窗口 bundle 中挂载，共用组件不得在顶层 import vault/editor store。
