# list-models-v1-dedupe

## Goal

Custom provider 配 `baseUrl=https://api.vveai.com/v1/` 时，list_models 请求落到 `https://api.vveai.com/v1/v1/models`（双 /v1）。根因：`list_models.rs:list_openai_shape` 无条件 `join_url(base, "v1/models")`，不检测 base 是否已含版本段。chat.rs 的 openai 臂有 `normalizeOpenAIBase` 逻辑去重，list_models 没跟上。

## Requirements

1. `list_models.rs:list_openai_shape` 在拼 URL 前检测 base 末尾是否已是版本段（`/v1`、`/v2` 等）；若是且 path 以 `v1/` 开头，剥掉 path 的 `v1/` 前缀。
2. 新增一个纯函数 helper（如 `openai_shape_url(base, path) -> String`）承载逻辑，单测覆盖：base 有 /v1 + path `v1/models` → 不双拼；base 无 /v1 + path `v1/models` → 正常拼；base 有 /v1 + path `models` → 正常拼。
3. 不动 bundled 提供商的 call sites（deepseek/groq/moonshot/openai/perplexity 传 `v1/models`，huggingface/openrouter/xai 传 `models`，逻辑都能被新 helper 兼容）。
4. 不动 chat.rs（chat 侧已正确处理）。

## Acceptance Criteria

- [ ] `cargo test` 通过，含新加的 `openai_shape_url_*` 测试
- [ ] `cargo check` 全绿
- [ ] 手动：custom provider baseUrl `https://api.vveai.com/v1/` + adapterFamily `openai-completions`，list models 请求落到 `https://api.vveai.com/v1/models`（无双拼）

## Out of Scope

- chat.rs 的 openai 臂（已正确）
- ProviderDetailSection 预览的 /v1 normalize（TS 侧已正确）
