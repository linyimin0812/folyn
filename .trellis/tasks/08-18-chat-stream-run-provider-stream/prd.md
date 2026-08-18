# 拆 chat_stream 巨型函数:抽出 run_provider_stream

## 背景
`apps/desktop/src-tauri/src/chat.rs` 的 `chat_stream` 共 428 行(315-743),是单一巨型 async 函数,混了 3 个相位:
1. **Preamble + 历史加载**(315-353,~39 行):API key 守卫、`history_mode` 解析、`load_history` → `history: Vec<Message>`。
2. **Provider dispatch 巨型 match**(355-705,~350 行):`match resolved { 18 个 arm }`,每 arm 构建 client→agent→`stream_chat`→`drain_loop`,返回 `(full, assistant_images)`。
3. **持久化本轮 turn**(707-742,~35 行):重建 history、push user/assistant `HistoryMsg`、`save_history`。

腐化主体是 Phase 2。`chat_stream` 因这段 match 不可读,且 dispatch 逻辑无法独立测试/命名。

## 目标
把 Phase 2 整段 `match resolved { ... }` 抽成独立 async 函数 `run_provider_stream`,`chat_stream` 缩到 ~85 行、呈现清晰的「加载→分发→持久化」三段式。**纯 move 重构,不改任何 arm 内逻辑、不改 provider 路由、不改错误处理。**

## 设计

新增函数(放在 `chat_stream` 上方、`drain_loop` 之外):
```rust
async fn run_provider_stream(
    params: &ChatParams,
    prompt_msg: &Message,
    history: &[Message],
    on_event: &Channel<ChatChunk>,
) -> Result<(String, Vec<AssistantImage>), AppError> {
    let resolved: &str = resolve_adapter_family(params);
    match resolved {
        // ... 原 18 个 arm 原样搬入,内部 `params.xxx` / `prompt_msg.clone()` /
        // `&history` / `&on_event` / `drain_loop` 调用全部不变 ...
    }
}
```

`chat_stream` 中原 Phase 2 整段替换为:
```rust
let (full, assistant_images) =
    run_provider_stream(&params, &prompt_msg, &history, &on_event).await?;
```

## 借用分析(为什么是 `&`)
- `params: &ChatParams`:Phase 2 只读 `params.api_key`/`base_url`/`model`/`preamble`/`thinking_budget`/`provider`/`azure_*`/`images`。Phase 3 之后仍需 `params.prompt`/`params.images`/`params.session_id`,故借引用、不 move。
- `prompt_msg: &Message`:各 arm 内部本就用 `prompt_msg.clone()`;传引用、内部照 clone。Phase 3 持久化用的是 `params.prompt` 原始串,不碰 `prompt_msg`。
- `history: &[Message]`:`stream_chat(prompt_msg, &history)` 本就接 `&[Message]`。
- `on_event: &Channel<ChatChunk>`:`drain_loop` / `build_user_message` 本就接 `&Channel`。

## 非目标(刻意不做,作者已用 `ponytail:` 注释决策)
- **不统一 18 个 arm 的 stream 类型**:作者注释(366-381)明确,box 成 `dyn Stream<Item=Result<Option<String>,String>>` 会把 `MultiTurnStreamItem` 的 Delta/Thinking 变体压平,破坏 `drain_loop`。保留每 arm ~5 行重复。
- **不用 macro 折叠 8 个 OpenAI-compat arm**:同上,且 macro 可读性更差。作者注明「provider 数翻倍再评估」。
- 不改 provider 路由、不改 `resolve_adapter_family`、不改 `with_thinking`/`drain_loop`。
- 不动 Phase 1 / Phase 3(它们小且内聚,抽出收益低)。

## 验证
- `cargo check`(用户跑,见 memory feedback_no_whole_project_compile)。
- `chat_stream` 行数 428 → ~85;`run_provider_stream` ~350。
- 18 个 arm 的 provider 字符串与原文件逐一对应(脚本/diff 比对)。
- 无逻辑改动:diff 应只是「函数边界移动 + 参数从 owned 改 borrow + 调用点替换」。

## 风险
- 低。唯一陷阱:搬入新函数后,arm 内对 `params`/`history`/`on_event` 的使用从「同函数 owned/borrowed」变为「跨函数 borrow」——但原代码在 arm 内本就用引用形式(`&params.api_key`?不,是 `params.api_key` move)。⚠️ 关键:`params.api_key` 在多个 arm 里是 **move**(`.api_key(params.api_key)`)。若 `params: &ChatParams`,则 `params.api_key` 变成「copy out of borrow」——`String` 不能 copy,会借用错误。
  - **解法**:arm 内凡 `params.api_key`(owned move)处改为 `params.api_key.clone()`;`params.base_url.clone()` 已经是 clone,无影响;`params.azure_*.clone()` 已 clone;`params.model.as_str()` / `params.preamble.as_deref()` / `params.provider.as_str()` 本就是借引用,无影响;`params.thinking_budget` 是 `Option<u32>`(Copy),无影响。
  - 受影响的 move 点:`anthropic`/`gemini`/`moonshot`/`deepseek`/`groq`/`hyperbolic`/`mira`/`openrouter`/`perplexity`/`together`/`xai`/`cohere`/`huggingface`/`azure-openai`/`ollama` arm 里 `.api_key(params.api_key)` → `.api_key(params.api_key.clone())`;`openai-completions` arm 已用 `params.api_key.clone()`;`_` arm 用 `params.api_key`(owned)→ 改 `.clone()`。
  - 由于 `params` 现在整个被借给 `run_provider_stream` 且函数返回后不再用 `params.api_key`,clone 是必需的(不能 move 出借用)。语义不变(每个 arm 只用一次 api_key)。
- 这是**唯一**需要语义等价改写之处(move → clone),其余纯 move。
