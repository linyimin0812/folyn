# refactor llm layer referencing llm_wiki

## Goal

参考 `/Users/yiminlin/project/llm_wiki` 的 LLM 层设计，重构 folyn 的 LLM 部分，消除重复、去掉投机性抽象、统一 prompt 与 provider 扩展点。具体范围待 brainstorm 收敛。

## What I already know

### folyn 现状（双通路）

* **CLI 通路**：`packages/cli-adapter` 通过子进程调 `claude` 二进制，解析 `stream-json`。`ClaudeAdapter` 是唯一实现，`registry.ts` 留了多 adapter 扩展点但只有一项。
* **Chat 通路**：Rust `chat_stream` Tauri command，用 rig-core 0.40 直接调 anthropic/openai/openai-compatible。
* 两条路在 TS 侧靠 `CliStreamEvent`（`text`/`thinking`/`tool_*`/`file_change`/`session_id`/`error`/`done`）统一形状。
* Prompt 散落：chat 的 `PREAMBLE` 硬编码在 Rust `chat.rs:24`；各业务 service（github/clip/planMyDay/wiki*）自带硬编码 prompt 字符串；feature agent 定义在 `features/*/.claude/{CLAUDE.md,agents/<f>.md}` 用 `?raw` 导入。
* 双 adapter 管理器重复：`components/ai/adapterManager.ts` 与 `petChatService.ts` 各持一份 `Map<sessionId, CliAdapter>`。
* Rust 里 anthropic/openai drain loop 重复（`chat.rs:141-187`）。
* `base_url` `/v1` 规整、`extractJsonObject` 贪婪正则等脆弱点。

### llm_wiki 的可借鉴设计

* **四合一 ProviderConfig**：`{url, headers, buildBody(messages, overrides), parseStream(line)}`，`getProviderConfig(config)` switch 派发。扩展 = 加一个 case。
* **wire-agnostic 类型**：`ChatMessage {role, content: string | ContentBlock[]}`，`ContentBlock = text | image`；`RequestOverrides {temperature, top_p, top_k, max_tokens, stop, reasoning}`。producer 不带 provider 框架。
* **adapt 小函数**分层叠加各家 quirks（DeepSeek thinking、Kiki 去 temperature、Ollama reasoning_effort、Gemini 重命名、Anthropic cache_control/thinking.budget_tokens）。
* **诊断化错误**：区分 timeout / 用户取消 / 网络失败 / "只产 reasoning 无内容"。
* **CLI provider 走 subprocess transport** 与 HTTP 统一在 `streamChat` 入口分流。
* Tool use 在独立 runtime 层（Rust `agent/`），不塞进 LLM client。

### 必须保留的外部契约

1. `CliAdapter` 接口签名（`start/send/stop/isRunning/onEvent/offEvent`）+ `CliStreamEvent` 形状 —— `AiPanel`、`petChatService`、`featureAgentService`、`collectTextFromStream` 及 6 个业务 service 依赖。
2. `@folyn/cli-adapter` 包导出（`createAdapter`/`listAdapters`/`ClaudeAdapter`/`buildClaudeArgs`/`buildClaudeShellCommand`/`quoteShellArg`/类型）。
3. Tauri command `chat_stream` + `ChatParams`/`ChatChunk` 字段名（camelCase）。
4. `settingsStore` 的 AI 字段：`cliAdapter`/`cliPath`/`chatProvider`/`chatModel`/`chatApiKey`/`chatBaseUrl`。
5. input mode id：`agent`/`ask`/`chat`。
6. 磁盘会话 `~/.folyn/chat-sessions/<id>.json` 格式 `{role,content}`。
7. per-vault feature agent 文件布局 `<vault>/__<feature>__/.claude/{CLAUDE.md,agents/<feature>.md}` + write-if-missing 语义。
8. `--bare`/`--permission-mode`/`--append-system-prompt`/`--agent`/`--agents`/`--add-dir` flag 语义。
9. `PermissionMode` 取值：`default`/`acceptEdits`/`plan`/`bypassPermissions`。

## Assumptions (temporary, to validate)

* 重构目标主要是 TS 侧的 LLM 抽象与 prompt 组织，不一定动 Rust（rig-core 仍保留作为 chat 通路的实现）。
* CLI 子进程通路（Claude Code binary）继续保留，不替换为 HTTP。
* Tool use 仍由 CLI/agent 路径承担，不在 LLM client 层引入。

## Open Questions

* 重构范围边界：是只重写 TS 侧 provider 抽象、还是连 Rust chat 通路一起统一？
* 是否需要新增 provider（如 google/gemini、ollama、azure）？还是只规整现有 anthropic/openai 两家？
* prompt 模板系统是否要引入？统一到哪个层（TS 还是 Rust）？
* 双 adapter 管理器重复是否在本次重构内合并？

## Requirements (evolving)

* 待 brainstorm 收敛。

## Acceptance Criteria (evolving)

* [ ] 待定

## Definition of Done

* Tests added/updated（至少覆盖 provider 抽象的 wire 翻译与 stream 解析）。
* Lint / typecheck / CI green。
* 所有外部契约（9 项）保持不变或显式声明升级路径。
* Rollback 路径清晰（保留旧通路可回退）。

## Out of Scope (explicit)

* 待收敛后填充。

## Technical Notes

* 关键文件清单见上 "What I already know"。
* llm_wiki 参考：`src/lib/llm-providers.ts`(994)、`llm-client.ts`(300)、`reasoning-detector.ts`、`templates.ts`(654)。
* folyn 双通路：CLI（`packages/cli-adapter`）+ Rust（`apps/desktop/src-tauri/src/chat.rs` 272 行，rig-core 0.40）。

## Research References

* 已通过两个 Explore agent 完成双侧现状探查。
* 第三个 Explore agent 专项调研 llm_wiki 的 CLI transport（claude-cli-transport / codex-cli-transport）。

### llm_wiki CLI transport 调研要点

* **两个 transport**：`claude-cli-transport.ts`(359) + `codex-cli-transport.ts`(234)，Rust 端 spawn，TS 端只 `listen` 事件。
* **统一分流入口**：`streamChat`（`llm-client.ts:60`）在 `getProviderConfig` 之前早返——`provider === "claude-code"` 走 `streamViaClaudeCodeCli`，`"codex-cli"` 走 `streamViaCodexCli`。签名与 HTTP 路径**完全一致**：`(config, messages, callbacks, signal?, overrides?) => Promise<void>`。
* **CLI 当纯文本管道**：输入 `ChatMessage[]`，输出只 `onToken(string)` + done/error。不暴露 tool_use、不暴露 session、不暴露 resume。CLI 内置 tool 自跑自闭环。
* **配置极简**：仅 `model`、`localCliIsolation`、`codexCliTimeoutMinutes`、`workingDirectory`。无 `permissionMode`/`agent`/`bare`/`addDir`/`systemPrompt`/`cliPath` 旋钮。
* **进程模型**：Rust spawn（`claude_cli.rs` / `codex_cli.rs`），TS 端无状态、无 `childProcess` 句柄。
* **与 folyn `ClaudeAdapter` 本质区别**：folyn 把 CLI 当**带状态的 agent runtime**（`start/send/stop`、`resumeSessionId`、8 类事件含 `tool_start`/`tool_end`/`file_change`、`permissionMode`/`agent`/`agents`/`addDir`/`bare`/`systemPrompt`）；llm_wiki 把 CLI 当**只产文本的 LLM provider**。

### 调研结论

* **值得借鉴**：llm_wiki 的 **`streamChat` 分流模式**——按 `provider` 在入口早返，CLI/HTTP 签名对齐，让上层调用方零分支。
* **不值得借鉴**：folyn 的 `tool_use`/`file_change`/`resume`/`permissionMode`/`agent` 编排是交互式 agent 面板的核心价值，不应为了统一接口砍掉。**两套抽象并存合理**。
* **重构真正价值点**：让 folyn 的 `CliAdapter`（CLI 通路）与未来的 TS 侧 provider 抽象（HTTP 通路）**在入口分流签名对齐**，而不是强行合一。调 `streamChat` 的业务调用方（如 wikiIngestService/githubAnalysisService 等需要纯文本输出的场景）可以选 CLI 或 HTTP，互为 fallback。

