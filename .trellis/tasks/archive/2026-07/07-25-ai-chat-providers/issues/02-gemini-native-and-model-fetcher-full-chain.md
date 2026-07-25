# 02 — Gemini native + 模型拉取全链路(一条新 provider 端到端)

**What to build:** 挑 Gemini 作为第一条 native provider 做完整垂直切片,贯穿每一层 — 从 catalog 声明、Rust chat arm、Rust list_models Tauri 命令、catalog sync 脚本、runtime merge/capability 纯函数、到 SettingsPage "获取模型" 按钮 + 下拉带徽章。Gemini 跑通后,其他 14 个已在 T1 工作的 provider 也获得"获取模型"按钮。

**Rust chat arm(`chat.rs`):** 新增 `match params.provider.as_str()` 的 `"gemini"` 分支,用 `gemini::Client::builder().api_key().base_url()` 构造 client,沿用现有 `drain_loop`(此时仍是 2 个 native arm + openai 兜底,trait-object box 重构留给 T3 — ponytail 注释里 "if a 3rd provider lands" 的阈值本 ticket 不跨)。

**Rust `list_models` 命令(新文件 `apps/desktop/src-tauri/src/list_models.rs`):**

```rust
#[tauri::command]
pub async fn list_models(
    app: AppHandle,
    params: ListModelsParams,
) -> Result<Vec<ModelDto>, AppError>
```

`ListModelsParams` 镜像 `ChatParams` 的路由字段(`provider` / `api_key` / `base_url` / `azure_deployment_id` / `azure_api_version`)。命令内部调纯函数 `fn fetcher_kind(provider_id: &str) -> FetcherKind` 返回 `Rig(Anthropic)` / `Rig(OpenAI)` / `Rig(Gemini)` / `Rig(DeepSeek)` / `Rig(Ollama)` / `Rig(OpenRouter)` / `Rig(Mira)` / `OpenAICompat` / `Azure`。本 ticket 实现全部 9 个 `FetcherKind` 变体的 dispatch(Q12 全量落地),哪怕只对 Gemini 跑 mockito 测试 — 11 个 OpenAI 兼容家族的 raw HTTP `/v1/models` + Bearer 路径在 T2 就跑通,后续 ticket 不再回填。

7 个 Rig provider 用 rig 0.40 的 `ModelListingClient::list_models()`(anthropic / openai / gemini / deepseek / ollama / openrouter / mira)。11 个 OpenAI 兼容家族用 `reqwest` 打 `<base_url>/v1/models`,Bearer 头,解析 `{data: [{id: ...}]}`。Azure 用 raw HTTP 打 `<endpoint>/openai/models?api-version=<api_version>`,`api-key` 头(不是 Bearer)。

`list_models` 命令在 `apps/desktop/src-tauri/src/lib.rs:676` 现有 `chat::chat_stream` 旁注册。

**Catalog sync 脚本(`scripts/sync-model-catalog.ts`):** 新建 Node 脚本,手动跑(无 CI)。`fetch('https://models.dev/api.json')` → zod 校验 → 抽 per-model `{id, providerId, capabilities, inputModalities, pricing}`;`fetch('https://openrouter.ai/api/v1/models')` + `fetch('https://openrouter.ai/api/v1/embeddings/models')` 补全 models.dev 没覆盖的 provider。merge 按 `(providerId, id)` union,models.dev 在 capabilities 上胜出,OpenRouter 在 pricing 上胜出。写到 `packages/model-registry/data/models-catalog.json`,commit 进 repo。脚本**不**生成 18 vendor 文件 / reasoning 规则表 / `reasoning-families.gen.ts` — 这些 models.dev 已聚合。

**Runtime loader:** 新建 `packages/model-registry/`(或 folder 内)在 app boot 时 `readFileSync` + zod 校验 catalog JSON,按 `(providerId, modelId)` 建 O(1) 索引。idle 过期不重新加载(catalog 随 binary 走,只在 app 升级时变)。

**纯函数(`apps/desktop/src/services/modelRegistry/`):**

- `mergeProviderModelsWithRegistry(remoteIds, catalog, providerId) → Model[]` — 远程 id 查 catalog 找到则 enrich,找不到则合成最小 Model(`capabilities: []`,无 pricing);catalog 有但远程无的 id 省略。
- `isVisionModel(m)` — `m.capabilities.includes('vision') || m.inputModalities.includes('image')`
- `isReasoningModel(m)` / `isWebSearchModel(m)` / `isFunctionCallingModel(m)` — `capabilities.includes(...)`。

**SettingsPage UI:** model 字段从 `<input>` 改成"获取模型"按钮 + 下拉/输入复合组件。未拉取时是 `<input>`(占位符 `placeholderModel`)+ 按钮可点;点按钮 → 调 `list_models` → 成功后变 `<select>`(每行 `${id} · ${badges}` + pricing 副标题);失败时保持 `<input>` + 显示错误。

**Blocked by:** 01 — catalog 形状稳定才能写 merge 函数;i18n key 已在 T1 加齐

**Status:** ready-for-agent

- [ ] `apps/desktop/src-tauri/src/list_models.rs` 存在,导出 `list_models` Tauri 命令 + `ListModelsParams` + `fetcher_kind` 纯函数 + `ModelDto`
- [ ] `fetcher_kind` 9 个变体全实现(7 Rig + OpenAICompat + Azure);路由纯函数 table-driven 单测覆盖全部 20 个 id
- [ ] `list_models` 在 `lib.rs:676` 旁注册,前端 `invoke('list_models', ...)` 能调到
- [ ] 7 个 Rig provider 用 `ModelListingClient::list_models()`(anthropic / openai / gemini / deepseek / ollama / openrouter / mira)
- [ ] 11 个 OpenAI 兼容家族用 raw HTTP `/v1/models` + Bearer;mockito 测试验证请求头
- [ ] Azure 用 raw HTTP `/openai/models?api-version=` + `api-key` 头;mockito 测试验证请求头与 query 参数
- [ ] `chat.rs` 加 `"gemini"` match arm,用 `gemini::Client::builder()`;Gemini 端到端聊天跑通
- [ ] `scripts/sync-model-catalog.ts` 存在,跑后产出 `packages/model-registry/data/models-catalog.json`,zod 校验通过
- [ ] Runtime loader 在 app boot 读 catalog JSON + zod 校验,按 `(providerId, modelId)` 索引
- [ ] `mergeProviderModelsWithRegistry` 纯函数 + 单测:(a) 全在 catalog → enriched,(b) 部分不在 → 最小 Model,(c) catalog 有远程无 → 省略,(d) 空远程 → 空结果
- [ ] `isVisionModel` / `isReasoningModel` / `isWebSearchModel` / `isFunctionCallingModel` 纯函数 + 单测,table-driven 覆盖 capability + modality 组合
- [ ] SettingsPage model 字段改成"获取模型"按钮 + 下拉/输入复合组件;点按钮调 `list_models`,成功后下拉带徽章 + pricing,失败保持输入 + 错误
- [ ] Gemini 端到端:选 Gemini → 填 key → 点"获取模型" → 下拉填充 → 选一个 → 聊天跑通
- [ ] 其他 14 个已在 T1 工作的 provider 也获得"获取模型"按钮,均能拉到列表
- [ ] mockito 测试覆盖:Anthropic(x-api-key 头)、OpenAI 兼容(Bearer 头)、Azure(api-key 头 + api-version query)、Ollama(/api/tags 路径)
