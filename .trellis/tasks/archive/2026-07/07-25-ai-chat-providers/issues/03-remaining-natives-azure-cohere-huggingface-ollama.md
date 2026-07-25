# 03 — 剩余 4 个 native:Azure / Cohere / HuggingFace / Ollama

**What to build:** `chat.rs` 加 4 个新 match arm,让 T1 留下的 5 个 native provider 里剩下的 4 个(Azure/Cohere/HuggingFace/Ollama)端到端跑通聊天。list_models 路由在 T2 已写好全部 9 个变体,T3 只补 `chat.rs` 的 4 个 arm + 处理 provider 特异点。SettingsPage 测试按钮现在传 Azure extras,T1 的"backend 待接入"标记移除。

**`chat.rs` 4 个新 match arm:**

- `"azure-openai"` → `azure::Client::builder()` 带 `api_key`、`deployment_id`(从 `params.azure_deployment_id`)、`api_version`(从 `params.azure_api_version`)、`endpoint`(从 `params.base_url`)。Azure 路径不在空 api_key 校验里(企业账户用 Entra ID,但本 ticket 范围只支持 api_key 鉴权 — 真要 Entra 留后续 ticket)。
- `"cohere"` → `cohere::Client::builder().api_key().base_url()`。`drain_loop` 复用。
- `"huggingface"` → `huggingface::Client::builder().api_key()`。HuggingFace 的 "model" 字段是 repo id(如 `meta-llama/Meta-Llama-3-70B`),catalog `placeholderModel` 已在 T1 反映。
- `"ollama"` → `ollama::Client::builder()` 无 `api_key`(跳过现有 `chat.rs:162` 的空 api_key 校验,或在 Ollama 分支里提前分流)。base_url 默认 `http://localhost:11434/v1`,用户可改(若 Ollama 跑在别的端口)。

**`drain_loop` 重构:** T2 加 Gemini 时仍是 2 个 native arm + openai 兜底,沿用现有 duplicated drain_loop。T3 加 4 个新 arm 后跨过 `chat.rs:195-201` ponytail 注释里的"3rd provider lands"阈值,重构 `drain_loop` 为 trait-object box(`Pin<Box<dyn Stream<Item = Result<Option<String>, String>> + Send>>`)统一,删除两段重复的 `match` 分支。

**SettingsPage 测试按钮:** 现有"测试连接"按钮的 `testChatConnection` 调用现在传 `azure_deployment_id` / `azure_api_version`(当 provider=azure-openai)。T1 里"backend 待接入"占位消息移除 — 所有 20 个 provider 的测试按钮现在真的发起请求。

**T2 已实现的 list_models 路由验证:** T3 不写新 list_models 代码,但补 4 个 provider 的 mockito 测试(cohere / huggingface 各自的 rig list_models 路径、Ollama 的 rig list_models 路径、Azure 的 raw HTTP strategy 在 T2 已测,本 ticket 验证 chat 路径而非 list 路径)。

**Blocked by:** 02 — Gemini arm 已立模式;`drain_loop` 重构在 T2 完成更省事(避免 T2 加 Gemini 时仍是 duplicated,T3 又重写一遍)

**Status:** ready-for-agent

- [ ] `chat.rs` 加 `"azure-openai"` match arm,带 `deployment_id` + `api_version`;`ChatParams` 加 `azure_deployment_id` / `azure_api_version` 字段(前端传)
- [ ] `chat.rs` 加 `"cohere"` match arm,`cohere::Client::builder()`
- [ ] `chat.rs` 加 `"huggingface"` match arm,`huggingface::Client::builder()`
- [ ] `chat.rs` 加 `"ollama"` match arm,跳过空 api_key 校验,默认 `http://localhost:11434/v1`
- [ ] `drain_loop` 重构为 trait-object box,删除 duplicated 分支(`chat.rs:195-201` ponytail 注释里的"3rd provider lands"阈值跨过)
- [ ] SettingsPage"测试连接"按钮调用 `testChatConnection` 时传 Azure extras(当 provider=azure-openai)
- [ ] T1 的 5 个 native"backend 待接入"标记移除,全部 20 个 provider 端到端可测可聊
- [ ] Azure 聊天端到端:填 endpoint + deployment_id + api_version + api_key → 测试通过 → 聊一条
- [ ] Ollama 聊天端到端:base_url 默认 + 不填 api_key → 测试通过 → 聊一条
- [ ] Cohere 聊天端到端:填 key → 测试 → 聊天
- [ ] HuggingFace 聊天端到端:填 key + repo id 作 model → 测试 → 聊天
- [ ] `chat.rs` 新 arm 覆盖:Azure 用 `azure_deployment_id` + `api_version`,Ollama 跳过空 key 校验
