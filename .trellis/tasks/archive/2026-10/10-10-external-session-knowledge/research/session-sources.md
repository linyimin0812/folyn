# 本机外部会话来源调查

调查日期：2026-10-10。范围：Codex 本地持久会话、Claude Code 本地会话、pi coding-agent 持久会话。仅调查读取与知识收录；不调用恢复会话或发送消息，不读取或输出用户对话正文。以下来源为官方文档或官方仓库，`main` 会变化，实施时应固定已验证版本。

## 结论

三种来源都有本地持久记录，但不能把“三种工具的 JSONL”视为同一种格式。建议使用三个只读适配器，统一输出会话摘要、可选择内容块、来源定位和附件清单。已有官方读取接口值得优先验证，尤其 Claude Agent SDK 已提供历史枚举与消息读取；直接解析 Claude 内部 JSONL 是明确的版本风险。[Claude SDK 会话文档](https://code.claude.com/docs/en/agent-sdk/sessions)

## Codex

- 官方 rollout 列表代码说明默认目录为 `~/.codex/sessions/YYYY/MM/DD/rollout-时间-uuid.jsonl`；存在归档目录、状态数据库辅助定位以及压缩文件路径处理，单扫活动目录会漏数据。[rollout discovery](https://github.com/openai/codex/blob/main/codex-rs/rollout/src/list.rs)
- 官方测试构造的持久记录使用 `timestamp/type/payload` 外层，包含 `session_meta`、`response_item`、`event_msg`。元数据包含线程 ID、cwd、来源、CLI 版本、git 信息与 fork/parent 字段；同一用户输入可同时出现为响应项和事件，不能简单把每行当作一条显示消息。[rollout fixtures](https://github.com/openai/codex/blob/main/codex-rs/app-server/tests/common/rollout.rs)
- `ResponseItem` 消息 ID 可缺失；函数调用以 `call_id` 关联结果，参数是字符串，结果可能是文本或结构内容。图像引用可为内联 URL 或文件 ID；部分内容加密，不能保证可读。[protocol models](https://github.com/openai/codex/blob/main/codex-rs/protocol/src/models.rs)
- 当前 app-server 文档具有 `thread/list`、`thread/read` 接口说明，可作为读取候选；但需验证安装版本、分页历史、归档和附件返回范围后再决定使用，不能假定本机桌面运行时对 Folyn 暴露接口。[app-server](https://github.com/openai/codex/blob/main/codex-rs/app-server/README.md)

建议：优先验证 app-server 读取契约是否满足原文保存；否则只读解析 rollout，由适配器负责事件去重、调用关联和分叉关系。消息缺少原生 ID 时使用会话 ID + 原始记录定位 + 内容摘要，而不是仅用列表下标。禁止修改 Codex 数据库或启动恢复操作来提取内容。

## Claude Code

- 默认本地记录为 `~/.claude/projects/<encoded-project>/<session-id>.jsonl`。项目目录编码并非可逆；位置和持久化行为可由环境变量、设置及 CLI 参数改变。官方明确指出 JSONL 条目格式是内部格式，会随版本改变。[会话存储](https://code.claude.com/docs/en/sessions#where-transcripts-are-stored)
- `listSessions()` / `getSessionMessages()`（Python 对应函数同样存在）专门用于本地会话枚举和历史读取，可用来做会话浏览器，不需要调用 `query` 或恢复会话。[SDK 读取接口](https://code.claude.com/docs/en/agent-sdk/sessions#resume-across-hosts)
- 分支复制历史并产生新会话 ID；同一会话多个终端的消息可能交错。cwd 移动、重复副本、自动保留清理和关闭持久化都影响发现结果。[会话管理](https://code.claude.com/docs/en/sessions)
- hooks/statusline 的 `transcript_path` 是官方提供的当前会话路径，但它们不能单独解决已有本机全部历史的发现。[脚本接口](https://code.claude.com/docs/en/sessions#access-conversations-from-scripts)

建议：先做 SDK 历史读取能力验证，核实返回的 UUID、cwd、标题、全部工具结果、图片来源、子代理记录和分页。当前调查确认接口存在，未确认它无损返回全部原始记录或附件字节；若不满足，采用内部格式适配器前必须明确支持版本，并保留未知记录及诊断。不要把目录 slug 当作真实项目路径，也不要调用 `claude -p --resume` 来生成摘要，那会新增会话消息。

## pi coding-agent

- 官方 SessionManager 当前格式版本为 3；头部包含会话 ID、时间、cwd、可选 parentSession。记录以 `id/parentId` 表示树，不是单纯线性聊天；`session_info` 提供名称，另有 compaction、branch_summary、context_edit 等条目。[SessionManager](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/src/core/session-manager.ts)
- 默认跨项目发现位于 `~/.pi/agent/sessions/<encoded-cwd>/`，`listAll()` 遍历所有项目目录，亦支持指定目录；头部 cwd 才是项目信息依据。[SessionManager discovery](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/src/core/session-manager.ts)
- 用户内容可含图片；助手内容包含文字、thinking、toolCall；toolResult 使用 `toolCallId` 关联，可含文字、图片、details 及有限的 nestedCalls。嵌套调用记录本身不记录结果，不能宣称收录了未被源工具保存的完整输出。[pi message types](https://github.com/badlogic/pi-mono/blob/main/packages/ai/src/types.ts)

建议：只读解析 v3 记录并重建父子树，默认展示选定路径，同时允许看到其他分支。保留原始条目，不用仅供模型上下文的压缩投影代替历史。谨慎使用 SessionManager.open：其加载逻辑涉及旧版迁移，知识浏览适配器应避免任何源文件写入。按项目指令，不实现历史格式迁移，遇到未支持版本明确提示。

## 共同契约与验收建议（设计推论）

- “本机全部”限定为可发现、可读取的持久记录；云端、远程主机、内存会话和已被源工具删除的数据无法保证获得。自定义存储根需要可配置发现入口，默认扫描不能覆盖任意目录。
- 会话身份使用 `provider + native session ID`，另存位置与原始项目路径；重复副本不能静默合并覆盖。内容定位保留 native ID、内容块编号、所选文字范围及原始记录摘要。
- 将当前会话显示投影和证据副本分开：证据包含用户确实选择的原文和明确关联的工具记录，不能把整个会话偷偷送入 AI。选中一条工具结果是否自动包含调用参数，应在 UI 中显示被纳入范围。
- 保存时从源记录读取实际附件字节，按内容摘要写入知识库附件目录，并在 Markdown 中使用相对路径；保留缺失、远程、file ID、加密、截断状态。附件不可取得时显示缺失，不伪造完整性。
- 针对三个来源分别验证：跨项目、分支、工具调用与结果、内联图片、丢失附件、末尾尚未写完的 JSONL、源文件删除、未知类型与版本。只在进入列表、打开会话或用户刷新时读取；列表缓存文件签名，详情按需读取。

尚需实施前验证：本机安装版本与可用读取 API；Codex 当前分页/压缩历史；Claude SDK 返回记录的无损程度；三者附件落盘方式及源文件已经截断/清理时的提示。此调查未据未公开内部格式承诺完整性。
