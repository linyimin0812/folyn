# 知识库存储迁至 ~/.folyn/（按 vault 隔离）

## Goal

知识库生成物（manifest、索引、快照、主题知识页、refs、审阅、删除意图、主题目录）不再存放在 `<vault>/__kb__/`——该目录污染 vault 的文件阅读体验（文件树里可见、被同步/备份工具打包）。迁到应用配置目录 `~/.folyn/` 下，按 vault 隔离。源资料（用户自己的文件）不动，仍在 vault 内。

## What I already know

* KB 路径全部由 `kbPaths.ts` 从 `KB_DIR = '__kb__'` 派生，vault 相对路径，经 `vaultStore.manager` 执行（`vaultKbFs`）；主题根 `__kb__/themes/<themeId>/`（`themeKbFs`）。
* `~/.folyn/vaults/<vaultId>/` 是既定 per-vault 应用数据根（versionHistory：快照、blob 都在这里），tauri fs 直写绝对路径（`versionHistory.ts:39`，`homeDir()+join`）。
* `~/.folyn/` 下已有多个应用数据目录（storage、extensions、drops、pet-icon、providers、chat-sessions）。
* `listSourceTree` 已在收录时排除 `__kb__`，但目录在文件树仍可见 —— 用户抱怨点。
* `KbFs` 端口：`readFile/writeFile/exists/rename/listSourceTree(+root)`；`listSourceTree` 走 manager（vault），生成物路径带 `fs.root` 前缀。
* 源资料路径（manifest sources[].path）是 vault 相对路径，读取必须继续走 manager —— 迁移后 KbFs 适配器要双路由：KB 生成物（落在 KB 根下）→ `~/.folyn` 绝对路径 tauri fs；其余（源资料）→ manager。
* vault watcher 只监听 vault；搬出后 KB 写入不再触发 watcher，`suppressWatcherFor` 对 KB 路径成空操作（保留无害）。
* vaultId 已是稳定隔离键（versionHistory 同款依赖）。
* ADR-0009 明确「以文件为真源……随 Vault 携带」——本变更推翻后半句，需新 ADR（0011）取代其存储位置部分。

## Assumptions (temporary)

* vaultId 稳定且跨会话可解析（versionHistory 先例成立）。
* tauri fs scope 已允许 `$HOME/.folyn`（storageClient/versionHistory 已在写，成立）。

## Open Questions

（已全部解决，见 Decision）

## Decision (ADR-lite)

**Context**: `<vault>/__kb__/` 污染 vault 文件树与同步/备份；ADR-0009 的「随 Vault 携带」与阅读体验冲突。
**Decision**（用户 2026-10-28 拍板）：
1. KB 生成物存 `~/.folyn/vaults/<vaultId>/__kb__/`（复用 versionHistory 的 per-vault 应用数据根；主题仍在 `__kb__/themes/<themeId>/`）。
2. **不做存量迁移**：新位置从零开始；旧 `<vault>/__kb__` 留在原地由用户自行处理（收录范围本就排除该目录）。
**Consequences**: KB 数据不再随 vault 同步/备份携带（后续可做导出/备份）；ADR-0009 的存储位置部分由新 ADR-0011 取代，文件真源原则不变。

## Requirements

* KB 生成物全部落在 `~/.folyn/vaults/<vaultId>/__kb__/`；vault 内不再产生 `__kb__` 写入。
* 目录布局不变：manifest/sources/topics/reviews/navigation/deletions/themes 及 `themes/<themeId>/` 层级原样，只是根换了。
* 源资料路径与读取链路不变（vault 相对，走 manager）。
* `KbFs` 适配器路由：`__kb__` 前缀路径 → 解析到 `~/.folyn/vaults/<vaultId>/` 下的绝对路径走 tauri fs；其余路径 → vaultStore.manager。vault 切换守卫语义保持。
* 引用快照/主题页等需要在编辑器打开的 KB 文件，openInEditor 拿到绝对路径（外部路径先例：drops）。
* 不迁移存量；新位置空态起步（首次使用与全新 vault 一致）。
* 新 ADR-0011 取代 ADR-0009 的存储位置结论。

## Acceptance Criteria (evolving)

* [ ] vault 文件树中不再出现 `__kb__`；KB 功能（收录、构建、阅读、页内编辑、问答、审阅、核验）全部正常。
* [ ] 同一 vault 的 KB 数据在新位置读写；切换 vault 后互不可见（隔离成立）。
* [ ] 现有 vault 的存量 `__kb__` 数据按选定策略处理。
* [ ] 单测：路径派生、KbFs 路由、迁移逻辑；既有 knowledge 测试适配后全绿。

## Out of Scope

* KB 数据的导出/备份 UI。
* 多机同步（`~/.folyn` 本就不随 vault 同步）。
* 源资料（vault 内文件）的任何移动。

## Technical Notes

* 相关文件：`kbPaths.ts`、`kbFs.ts`（vaultKbFs/themeKbFs）、`kbThemes.ts`、`versionHistory.ts`（先例）、`vaultStore`、消费方（knowledgeStore、TopicReader、kbAsk、topicSynth、kbReviewActions 等）。
* 潜在坑：`fs.root` 现为相对 `__kb__...` 前缀，迁移后是绝对路径 —— 所有 `xxxPath(..., fs.root)` 拼接点都要过一遍；`openInEditor` 打开 KB 文件（快照）需支持绝对路径（drops 先例已支持外部路径）。
