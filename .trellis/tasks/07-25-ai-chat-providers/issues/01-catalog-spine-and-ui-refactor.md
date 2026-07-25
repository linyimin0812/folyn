# 01 — Catalog 脊柱 + UI 重构(15/20 当天可跑)

**What to build:** 用户打开 Settings → AI → Chat 模式,看到 20 个 provider 的下拉(分 4 组:原生 / 兼容 / OpenAI 兼容家族 / 本地),每组用 `<optgroup>`。每个 provider 由 TS catalog(`apps/desktop/src/services/providers/catalog.ts`)声明:`id`、`category`、`i18nKey`、`defaultBaseUrl`、`placeholderModel`、`apiKeyUrl`、`requiresApiKey`、`requiresAzureFields`。catalog 是 single source of truth,SettingsPage 完全由它驱动渲染,不再硬编码 `<option>`。

`aiConfigStore.ts` 的 `ChatProvider` 类型从 `'anthropic' | 'openai' | 'openai-compatible'` 扩到 20 个 id 的并集,**三个旧 id 原样保留**(无迁移逻辑 — 老 user 的 `'openai-compatible'` 设置仍 hydrate 成 `'openai-compatible'`)。新增两个持久化字段 `chatAzureDeploymentId` / `chatAzureApiVersion` 加入 `PERSIST_KEYS_AI_CONFIG`,加入 state + setter + hydrate 路径,沿用现有 `schedulePersist()` 模式。

SettingsPage Chat 模式 section 重构:
- provider `<select>` 用 `<optgroup>` 按 catalog 的 category 字段分组;option 来自 catalog 遍历,不再硬编码。
- api_key label 行右对齐渲染"获取 API key →"链接,`apiKeyUrl` 为 null 时不渲染(Ollama)。
- api_key 输入框在 `!requiresApiKey` 时整体隐藏(Ollama)。
- Azure 专属 `deployment_id` / `api_version` 输入仅在 `provider === 'azure-openai'` 时渲染,值读自 / 写入 `chatAzureDeploymentId` / `chatAzureApiVersion`。
- `base_url` placeholder 用 catalog 的 `defaultBaseUrl`,Anthropic/OpenAI 等无默认的留空。

i18n:`apps/desktop/src/i18n/locales/{en,zh}/settings.json` 加 20 个 `settings:ai.chat.provider.<id>` 键 + 4 个 `settings:ai.chat.category.<native|compat|openai-family|local>` 键 + 4 个 `settings:ai.chat.capability.<vision|reasoning|web-search|function-call>` 键。品牌名(DeepSeek/Groq/OpenRouter 等)在所有 locale 下原文。

Rust 端**不动**。现有 `chat.rs` 的 2 个 match arm(anthropic / openai 兜底)已能跑通 15 个 provider:Anthropic、OpenAI、OpenAI 兼容、Anthropic 兼容、11 个 OpenAI 兼容家族(DeepSeek/EternalAI/Galadriel/Groq/Hyperbolic/Mira/Moonshot/OpenRouter/Perplexity/TogetherAI/xAI)。剩 5 个 native(Azure/Cohere/Gemini/HuggingFace/Ollama)在下拉里可选,但用户点"测试连接"或聊天时显示"backend 待接入,请使用其他 provider"。

**Blocked by:** 无 — 可立即开始

**Status:** ready-for-agent

- [ ] `apps/desktop/src/services/providers/catalog.ts` 存在,声明全部 20 个 provider,字段含 `id`/`category`/`i18nKey`/`defaultBaseUrl`/`placeholderModel`/`apiKeyUrl`/`requiresApiKey`/`requiresAzureFields`/`rigClientKind`
- [ ] `aiConfigStore.ts` 的 `ChatProvider` 类型扩到 20 id 并集,三个旧 id 原样保留
- [ ] `PERSIST_KEYS_AI_CONFIG` 加入 `chatAzureDeploymentId` / `chatAzureApiVersion`;state + setter + hydrate 路径补齐
- [ ] `aiConfigStore.test.ts` 扩展:hydration 接受 20 个 id(parameterized test)、旧 `'openai-compatible'` blob 仍 hydrate 成 `'openai-compatible'`(回归)、Azure 字段 hydrate 正确
- [ ] SettingsPage Chat 模式 section 重构为 catalog 驱动,`<optgroup>` 按 category 分组,option 不再硬编码
- [ ] api_key 行内"获取 API key →"链接按 `apiKeyUrl` 条件渲染(Ollama 不渲染)
- [ ] api_key 输入框按 `requiresApiKey` 条件渲染(Ollama 隐藏)
- [ ] Azure 专属 `deployment_id` / `api_version` 输入按 `provider === 'azure-openai'` 条件渲染,值绑定 `chatAzureDeploymentId` / `chatAzureApiVersion`
- [ ] `base_url` placeholder 来自 catalog `defaultBaseUrl`
- [ ] i18n:20 个 provider key + 4 个 category key + 4 个 capability key,在 en + zh 两个 locale 都加齐;品牌名跨 locale 原文
- [ ] 15 个能跑的 provider(Anthropic/OpenAI/OpenAI 兼容/Anthropic 兼容/11 个 OpenAI 兼容家族)端到端跑通 — 选 → 填 key → 测试连接 → 聊天一条消息
- [ ] 5 个 native provider(Azure/Cohere/Gemini/HuggingFace/Ollama)在下拉里可选,但点测试/聊天显示"backend 待接入"消息,不崩
