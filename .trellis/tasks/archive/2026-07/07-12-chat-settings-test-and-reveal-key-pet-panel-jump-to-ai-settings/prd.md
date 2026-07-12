# chat-settings-test-and-reveal-key + pet-panel-jump-to-ai-settings

## Goal

Two UX gaps in the new Chat-mode (rig直连 LLM) feature:

1. **Chat 模式设置**: API Key 输入框被 `type="password"` 完全遮蔽，无法回看已输入的 key；配好 provider/model/key/baseUrl 后没有任何"试一下"的入口，用户只能切到 Chat 模式发一句话才能发现 key 写错或 baseUrl 不通。补一个**显示/隐藏 key** 的眼睛按钮 + **测试连接** 按钮。
2. **桌宠 → AI 设置跳转**: 现在 `PetChat` 只有在"未配置 AI"的 CTA 里有一个"打开 AI 设置"按钮（`PetChat.tsx:433`）。配置好后这个按钮就消失了，用户想改 provider/key/model 必须从主窗口侧栏进设置。在桌宠 chat 视图里常驻一个"AI 设置"入口。

## What I already know

- Chat 模式设置 UI 在 `apps/desktop/src/components/pages/SettingsPage.tsx:1250-1299`：Provider 下拉、Model 输入、API Key（password 输入）、Base URL 输入。
- 设置 store 字段：`chatProvider | chatModel | chatApiKey | chatBaseUrl`（`settingsStore.ts:99-102`），持久化在 `settingsStore.ts:262`。
- Chat 后端：`apps/desktop/src/services/rigChat.ts` 的 `runRigChat({ sessionId, prompt, provider, model, apiKey, baseUrl?, onEvent })` → 调 Rust `chat_stream` 命令，流式返回 `delta/done/error`。
- 桌宠 chat 跳转 AI 设置的逻辑**已经存在**：`PetChat.tsx:336-341` 的 `handleOpenSettings` 会 `setCurrentPage('settings')` + `setSettingsTab('ai')` + `emit('pet://menu-action', 'show-main')` 来 focus 主窗口。只是当前仅在 `!configured` 的 CTA 里挂了按钮。
- `PetChat` 顶部有 `PetChatSessionHeader`（`PetChatSessionHeader.tsx`）——这是 chat 已配置时常驻的 header，自然挂点。
- Pet 面板另一个 tab 是 `PetLauncher`（Actions 网格），也可以加 launcher action，但需要扩 `PetMenuAction` union + Rust `pet_ctx_menu_action` 映射，成本更高。

## Assumptions (temporary)

- "测试连接"按钮可以复用 `runRigChat`，发一个极短 prompt（如 `ping`），等 `done`/`error`，3-10s 内返回 ✓/✗。**无需**新增 Rust 命令。
- "显示 API Key"用 input `type` 切换 `password` ↔ `text` + 一个眼睛图标按钮 inline 在输入框右侧。无需新依赖。
- 桌宠页面的"AI 设置"按钮放在 `PetChatSessionHeader` 右侧（小齿轮图标），点击触发已有的 `handleOpenSettings`。**无需**新增 `PetMenuAction`。

## Decisions (resolved)

- **测试行为**: 复用 `runRigChat({ prompt: 'ping' })`，等 `done`/`error`；10s 超时兜底。不新增 Rust 命令。
- **AI 设置按钮样式**: 复用现有 CTA "打开 AI 设置" 按钮的 accent 样式（`bg-acc text-white border-acc`），仅在 padding/尺寸上压缩以适配 30px 高的 header。
- **AI 设置按钮位置**: `PetChatSessionHeader` 右侧（session switcher 是 `justify-between` 左侧，右侧空位）。该 header 仅在 configured 时渲染，与 R5（CTA 行为不变）正交。

## Open Questions

(无 —— 两个关键决策已确认)


## Requirements (evolving)

- R1: Chat 模式 API Key 输入框右侧有一个眼睛按钮，点击切换密码可见/隐藏，默认隐藏。
- R2: Chat 模式区块有一个"测试连接"按钮，点击后用当前 provider/model/key/baseUrl 发一次极短请求，3-10s 内显示 ✓ 成功 / ✗ 失败原因。
- R3: 测试进行中按钮 disabled，显示"测试中…"；结束无论成功失败都恢复可点。
- R4: 桌宠 chat 视图常驻一个"AI 设置"入口按钮，点击后主窗口跳到 Settings → AI 工具 tab。
- R5: 不破坏现有 `handleOpenSettings` 在未配置 CTA 里的行为。

## Acceptance Criteria (evolving)

- [ ] 点击眼睛按钮可在密码/明文间切换；切换不丢内容、不触发 onChange。
- [ ] 点击"测试连接"：合法配置 → ✓ + 简短成功提示；错误配置（如 key 无效/baseUrl 不通）→ ✗ + 错误信息（来自 `runRigChat` 的 `error.message`）。
- [ ] 测试期间按钮 disabled 显示"测试中…"。
- [ ] 桌宠 chat 已配置时，header 右侧"AI 设置"按钮可见可点；点击后主窗口聚焦并跳到 AI 工具 tab。
- [ ] 未配置 CTA 的"打开 AI 设置"按钮行为不变。
- [ ] 既有测试通过；新增对应单测。

## Definition of Done

- 测试覆盖：API key 显隐 toggle 行为；测试按钮 success/error/loading 三态；jump 按钮触发 store 更新 + `show-main` emit。
- lint / typecheck / 既有测试绿。
- 无新依赖。

## Out of Scope (explicit)

- 不在 Actions（PetLauncher）grid 加新的 launcher action（避免 Rust 端 `PetMenuAction` 扩张）。
- 不做 provider 列模型端点（list-models）的差异化测试 —— 统一用 chat ping。
- 不改 `chat_stream` Rust 命令本身。
- 不持久化测试结果。

## Technical Notes

- 测试按钮实现：构造一次性 sessionId（如 `test-${Date.now()}`），调 `runRigChat` with `prompt: 'ping'`，监听 onEvent：收到 `done` → 成功；收到 `error` → 失败；invoke reject → 失败。设 ~10s 超时兜底。
- 显隐切换：`<input type={showKey ? 'text' : 'password'}>`，按钮在 input wrapper 右侧，stopPropagation 防触发 drag。
- AI 设置按钮：在 `PetChatSessionHeader` 右侧加 `<button>` 调 `handleOpenSettings`（从 PetChat 透传或直接在 header 内 import 同样逻辑）。重新 `emit('pet://menu-action', 'show-main')` 即可，主窗口已 listen。
