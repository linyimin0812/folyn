# 05 — 主动过滤:vision 守门图片上传 + reasoning 暴露 thinking budget

**What to build:** T2 实现了 capabilities 纯函数 + 下拉徽章(被动展示),T5 让 UI 真正消费 capabilities 做主动过滤 — Q13=C 项的"主动过滤"半落地。

**`BubbleTemplateAIChatModal` 图片上传守门:**
- 现有图片上传按钮(`BubbleTemplateAIChatModal` 内)在 `!isVisionModel(selectedModel)` 时 `disabled`,加 tooltip"当前模型不支持图片输入"。
- `selectedModel` 查询 `modelRegistryStore.modelsByProvider[chatProvider]` 按 `chatModel` id 找;找不到(Gemini 没拉取过 / 是孤儿 model)则默认允许上传(乐观 — 让 provider 自己拒绝,而不是预阻止)。
- HTML 上传(.html)不受 vision capability 影响(纯文本注入,任何 chat 模型都能处理)。

**SettingsPage Chat 模式 thinking budget:**
- 当 `isReasoningModel(selectedModel)` 为 true 时,Chat 模式 section 加一个"thinking budget"输入(token 数,默认 1024)。
- 字段持久化到 `aiConfigStore` 新字段 `chatThinkingBudget`(加入 `PERSIST_KEYS_AI_CONFIG`)。
- `!isReasoningModel(selectedModel)` 时该输入隐藏,`chatThinkingBudget` 值保留(切回 reasoning model 时不丢)。

**`ChatParams` 加 `thinking_budget`:**
- `apps/desktop/src-tauri/src/chat.rs` 的 `ChatParams` 加 `thinking_budget: Option<u32>`。
- `chat_stream` 在构造 rig agent 时,对 reasoning-capable model 把 `thinking_budget` 传给 rig agent builder 的 `.reasoning()` 或对应 API(具体 rig 0.40 API 名 — 实现者查 rig 文档)。
- 非 reasoning model 忽略 `thinking_budget`(静默 — 不报错,rig 自己不接受 thinking 时就跳过)。

**T2 已经被动展示徽章** — T5 不再改徽章 UI,只是新加两个消费点(图片按钮禁用、thinking budget 输入)。`BubbleTemplateAIChatModal` 现有 test 文件(`BubbleTemplateAIChatModal.test.tsx`)扩展覆盖 vision 守门逻辑。

**Blocked by:** 02 — 需要 `modelRegistryStore` 里的 selectedModel(带 capabilities)才能判断 `isVisionModel` / `isReasoningModel`。T3、T4 不阻塞 T5(其他 native provider 是否接好、JSON 持久化是否完成,都不影响"选中 Gemini 时图片按钮守门"这一行为本身)

**Status:** ready-for-agent

- [ ] `BubbleTemplateAIChatModal` 图片上传按钮在 `!isVisionModel(selectedModel)` 时 `disabled` + tooltip"当前模型不支持图片输入"
- [ ] HTML 上传不受 vision capability 影响
- [ ] selectedModel 查不到时(未拉取 / 孤儿)默认允许上传(乐观)
- [ ] `BubbleTemplateAIChatModal.test.tsx` 扩展:选 vision model → 上传按钮 enabled;选非 vision model → disabled + tooltip 显示;selectedModel 未知 → enabled
- [ ] SettingsPage Chat 模式在 `isReasoningModel(selectedModel)` 时显示"thinking budget"输入,默认 1024
- [ ] `aiConfigStore` 加 `chatThinkingBudget` 字段 + `PERSIST_KEYS_AI_CONFIG` 加入;hydrate 路径补齐
- [ ] `!isReasoningModel(selectedModel)` 时 thinking budget 输入隐藏,值保留
- [ ] `ChatParams`(Rust)加 `thinking_budget: Option<u32>`;`chat_stream` 在 reasoning-capable model 时传给 rig agent builder
- [ ] 非 reasoning model 静默忽略 `thinking_budget`
- [ ] `aiConfigStore.test.ts` 扩展:`chatThinkingBudget` hydration + persist 测试
- [ ] 端到端:选 Claude Sonnet(reasoning) → thinking budget 显示 → 设 2048 → 聊天 → reasoning trace 体现 budget
- [ ] 端到端:选 GPT-4o(非 reasoning) → thinking budget 隐藏 → 切回 Claude Sonnet → 字段值仍是 2048(未丢)
- [ ] 端到端:`BubbleTemplateAIChatModal` 选 Claude(支持 vision) → 图片上传 enabled → 上传图 → 聊天跑通
- [ ] 端到端:`BubbleTemplateAIChatModal` 选 GPT-4o(支持 vision) → 图片上传 enabled
- [ ] 端到端:`BubbleTemplateAIChatModal` 选 DeepSeek(非 vision) → 图片上传 disabled + tooltip
