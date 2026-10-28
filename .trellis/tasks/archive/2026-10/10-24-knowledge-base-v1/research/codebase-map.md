# 代码调研：知识库第一版落点（2026-10-24）

来源：Explore agent 全库扫描 + 主会话抽查（`runRigChat`、`aiStreamUtils` 已在 master 上亲自核实）。

## 关键结论

1. **ADR-0004 的 wiki 实现不在 master**。v0.0.9（`00709c72 chore: remove wiki feature`）已移除；代码驱动写入的实现活在 `.dev/worktree/calm-garden/`（featureAgentService、wikiProvider、wikiIngestService、wikiPageWriter、wikiLintService、wikiSearch、wikiStagingWriter 等，仍用 `@quill/*` 旧包名）。本任务在 master 上重写，借鉴其模式，不做整体移植。
2. **master 上可直接复用的能力**：
   - `runRigChat`（`apps/desktop/src/services/rigChat.ts`）→ Rust `chat_stream`（`src-tauri/src/chat.rs`，rig-core 0.40）。支持 `preamble`（system prompt）、`historyMode: 'none'`（每次调用独立、不留历史）、流式事件、图像。模型无工具无文件访问 —— 天然满足 ADR-0006"模型提议、程序写入"。
   - `extractJsonObject`（`apps/desktop/src/services/aiStreamUtils.ts`）：从模型文本中抠 JSON。
   - Vault 抽象：`packages/vault-provider`（`tauriProvider` 直接用 `@tauri-apps/plugin-fs` readTextFile/writeTextFile/mkdir/rename）。Vault 根：`VaultConfig {id, name, providerType, basePath}`；`vaultStore`。
   - 原子写：`.tmp` + rename 模式已有先例（`services/versionHistoryService.ts`、worktree 的 wikiStagingWriter）。
   - SHA-256：JS `crypto.subtle`（versionHistoryService 已有 `sha256Hex` 先例）。
   - 文件监听：Rust `start_vault_watcher`（`src-tauri/src/commands/project_commands.rs:29`，notify 8，事件发到 webview）+ 前端 `utils/fileWatcher.ts`（含 `pauseWatcher/resumeWatcher`、`suppressWatcherFor`）。
   - 面板注册：`services/registerBuiltinPanels.tsx` → `featurePanelStore.register({id, title, icon, component, order})`。保留 builtin id：`files`、`wiki`、`calendar`。
   - Markdown 解析：remark 栈齐全（remark-parse/gfm/math 等，`apps/desktop/package.json`）；frontmatter 用正则（先例 worktree wikiPageWriter / `packages/cli-adapter/src/frontmatter.ts`）。`yaml` 包在依赖里。
   - 短 ID：`src/utils/idGenerator.ts` `generateShortId`。
3. **检索现状**：master 只有 `searchStore.performSearch`（逐文件正则、内存缓存）。worktree 的 `wikiSearch.ts` 有手写 BM25（英文 token + 中文 bigram、标题加权、TTL 缓存）—— 本任务按同思路在 master 重写，不移植文件。
4. **无数据库**：spec 明确 "Database Guidelines: N/A — local-first, no database"。Rust `rusqlite` 仅用于 Chrome 导入，不复用。
5. **AI 配置来源**：chat 模式的 provider/model/apiKey/baseUrl 已有设置链路（AiPanel、BubbleTemplateAIChatModal 都从现有设置读取）。

## 复用清单（写代码时直接看这些文件）

| 用途 | master 文件 |
| --- | --- |
| LLM 调用 | `apps/desktop/src/services/rigChat.ts` |
| JSON 抠取 | `apps/desktop/src/services/aiStreamUtils.ts` |
| Vault 文件 IO | `packages/vault-provider/src/providers/tauriProvider.ts` |
| 原子写/哈希先例 | `apps/desktop/src/services/versionHistoryService.ts` |
| 面板注册 | `apps/desktop/src/services/registerBuiltinPanels.tsx` |
| 文件监听 | `apps/desktop/src/utils/fileWatcher.ts`、`src-tauri/src/commands/project_commands.rs` |
| 前端状态模式 | `apps/desktop/src/store/`（Zustand） |

## 借鉴但不在 master 的模式（重写时参考 worktree 路径）

- 代码驱动写入 + 结构校验：`.dev/worktree/calm-garden/apps/desktop/src/services/wikiPageWriter.ts`、`wikiLintService.ts`
- ingest 流程（指令构造 → 模型 JSON → 校验写入）：同目录 `wikiIngestService.ts`
- BM25：同目录 `wikiSearch.ts`
- staging 原子发布：同目录 `wikiStagingWriter.ts`
