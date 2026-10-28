# Folyn

A Tauri desktop app with an embedded AI pet (Cloudia) that surfaces notifications via bubble templates, corner toasts, and an interactive panel. Multi-vault, multi-feature (schedule / wiki), plugin-host AI capability for trusted-tier plugins.

## Language

**知识库（Vault）**:
Folyn 中保存原始资料和知识主题的空间，一个 Vault 可以包含多个独立配置的主题。
_Avoid_: 主题（库内的独立整理上下文）。

**主题**:
用户配置的独立知识整理上下文，具有自己的名称、目标、收录范围和整理结果；问答与审阅均限定在该主题内。同一份原始资料可被多个主题收录。
_Avoid_: 知识页（主题内整理生成的内容）、共享知识库目标（主题之间目标独立）。

**主题目标**:
用户为一个主题声明的知识积累方向，用于指导该主题内的资料整理和知识页生成。
_Avoid_: 主题目录（预先列出的组织结构）、知识页（整理后的内容）。

**原始资料**:
知识整理所依据的来源内容；在生成主题知识页后仍保留，供查阅和核对出处。
_Avoid_: 主题知识页（经过整理的知识内容）、资料索引（用于导航的描述）。

**引用版本**:
主题知识页的某条来源引用所依据的确定原文版本；原始资料后续修改或删除后，它仍是核对该引用的历史证据。
_Avoid_: 最新版本（可能已与引用时的内容不同）、主题知识页版本（被整理内容自身的版本）。

**来源引用**:
主题知识页中由 AI 根据资料生成的重要段落或独立结论，与其依据的原文版本及具体位置之间的关联。
_Avoid_: 整页参考资料列表（未明确各段内容与证据的对应关系）、逐句引用（当前不要求每句话分别标注）。

**待核验引用**:
知识页的带引用段落经人工修改后保留的来源关联，其原文依据是否支持修改后的说法尚待重新检查。
_Avoid_: 待审阅修订（等待用户确认的正文变更）、有效引用（修改后的内容尚未重新核验）。

**引用核验**:
检查指定原文版本及位置是否支持知识页中关联说法的过程。核验结果描述内容与出处的支持关系，不是对该说法事实可靠性的统一评分。
_Avoid_: 置信度评级（本设计不自动汇总）、事实核查（核验范围不是独立判定说法真伪）。

**已移除来源**:
已被删除或移出收录范围、不再持续跟踪的原始资料；已有知识与历史引用保留，检索证据中说明来源已移除。
_Avoid_: 已撤回知识（移除资料不自动撤回结论）、不支持的引用（移除来源不表示历史原文不支持原说法）。

**收录范围**:
用户为一个主题明确选定的原始资料文件与目录集合。
_Avoid_: 整个 Vault（不等于所有库内文件都已收录）、知识库目标（限定主题方向，而非资料位置）。

**更新候选**:
资料新增或变化后，通过已有引用依赖或新内容的主题关联选出的知识页及结论，需要进一步分析其是否实际受到影响。
_Avoid_: 已失效知识（入选候选不表示已有结论错误）、待审阅修订（分析后提出的具体正文变更）。

**重复佐证**:
与已有结论一致、可以补充其来源依据的资料内容，不构成需要另写一段的新事实。
_Avoid_: 新事实（为知识页补充此前未包含的内容）、修订（需要改写已有结论）。

**人工删除意图**:
用户从知识页中删除内容所表达的编辑决定，后续生成不自动恢复同一结论。新资料再次支持该结论时，可以提出恢复建议，由用户确认。
_Avoid_: 内容缺失（不能仅因当前页面没有该内容就视作可自动新增）、来源移除（停止跟踪资料的操作）。

**资料索引**:
描述单份原始资料内部结构、内容概要及原文位置的导航信息，用于在资料内定位内容。
_Avoid_: 主题导航（全库层面的主题组织）、主题知识页（综合整理后的内容）。

**索引节点**:
资料索引中对应真实原文范围的结构单元，具有描述该范围的标题和摘要。节点可以来自原有章节，也可以来自对无标题或过长内容补充的语义分层。
_Avoid_: 主题知识页（跨资料整理的知识）、原文标题（补充的索引分层不改变原文）。

**主题导航**:
单个配置主题内的内容导航，关联知识页与相关原始资料；同一份资料可以关联多个知识页。
_Avoid_: 资料索引（单份资料内部的结构）、统一主题树（将主题归类与原文结构合为一棵树）。

**知识页（主题知识页）**:
在用户配置的主题内，围绕一个具体内容方向，从一份或多份原始资料中整理形成、带有来源引用的知识内容，由用户与 AI 共同维护。用户直接修改的解释和补充的经验也是该知识页的一部分。
_Avoid_: 原始资料（未经该次主题整理的来源内容）、资料索引（用于定位的导航信息）。

**检索证据**:
一次检索返回的相关知识页或原文内容，附带来源、版本、具体位置，以及已知的冲突或待更新状态，供回答层组织答案。
_Avoid_: 最终答案（由回答层根据证据生成）、来源引用（知识页内容与原文依据之间的关联）。

**待审阅修订**:
针对已有主题知识页正文的改写、删除或观点冲突提出的变更，尚未得到用户确认。它不等同于已应用的知识页内容，也不改变已收录原始资料可被检索使用的事实。
_Avoid_: 已确认知识（修订尚未获批）、未收录资料（资料收录与知识页修订是不同边界）。

**会话知识沉淀**:
用户主动选择外部编程助手会话中的一段对话或整个会话，将其中有价值的内容整理为 Folyn 中可长期查阅、复用的知识。外部会话包括 Codex、Claude Code、pi 等工具中的会话；会话是知识素材来源。是否收录由用户主动决定。
_Avoid_: 会话同步（未区分素材获取与知识收录）、自动知识收录（不符合用户主动选取的边界）。

**会话原文摘录**:
用户在 Folyn 中浏览外部会话并主动选择内容后，直接保存的原始对话内容；它是会话知识沉淀的一种形式。
_Avoid_: 整理笔记（经过提炼的知识内容）。

**会话整理笔记**:
用户在 Folyn 中浏览外部会话并主动选择内容后，由 AI 提炼、经用户编辑确认再保存的知识笔记；它与会话原文摘录并列支持。
_Avoid_: 自动知识收录（未经用户确认）、原文摘录（未经提炼）。

**Bubble Template AI Agent**:
The "AI 生成" entry point in `BubbleTemplateBlock` (settings → notifications). A multi-turn LLM chat that clarifies the user's intent and drafts a `BubbleTemplate`. Despite the label "AI Agent", it is NOT an agent loop — no tools, no file access, no self-sanitization. Backed by `runRigChat` (multi-turn, tool-free, history persisted by the rig backend keyed by `sessionId`). Accepts three input modes: free text, HTML file upload (read as text, injected into the prompt), and image file upload (vision; sent as image content blocks, requires the rig backend extension recorded in ADR-0001). Output is a `BubbleTemplate` JSON in a `\`\`json` code fence that enters the same `tryImport` validation + `addTemplate` path as user-pasted JSON. See ADR-0001 for the rejected alternatives (agent loop, plugin agent).
_Avoid_: Template Agent, Feature Agent (overlaps with `runFeatureAgent`-backed feature agents like wiki), Plugin Agent (overlaps with `buildPluginAi.agent`).

**Feature Agent**:
A vault-scoped agent loop backed by `runFeatureAgent` — spawns the `claude-cli` sidecar with tools, file-system access, and a canonical `agents/<feature>.md` system prompt seeded into `<vault>/__<feature>__/.claude/`. Currently registered: schedule, wiki. Distinct from the Bubble Template AI Agent despite both being called "agent" in casual speech.
_Avoid_: AI Agent (ambiguous — could mean either Bubble Template AI Agent or a Feature Agent).

**Version Snapshot**:
The content of a Versionable File at a single moment, stored as a blob file named by the SHA-256 of its UTF-8 bytes under `~/.folyn/vaults/<vaultId>/versions/blobs/`. Snapshots are taken on file save and on tab close; identical-to-last-hash writes are skipped (dedup). Restore always snapshots the current state first, then overwrites with the chosen snapshot's blob.
_Avoid_: backup, checkpoint, save-state.

**Version Index**:
Per-vault JSON file at `~/.folyn/vaults/<vaultId>/versions/index.json` mapping each vault-relative file path to a time-ordered array of `{hash, ts, size}` entries — the lookup table that pairs Version Snapshot blobs back to the files and moments they belong to. Single source of truth for "what versions does this file have"; rewritten atomically on each new snapshot.
_Avoid_: version log, history manifest.

**Versionable File**:
Any file whose type has an editor registered in `apps/desktop/src/components/file-types/` (markdown, html, code, plantuml, graphviz, csv, json, svg, web, clip, dbml, drawio, excalidraw, mmap, rich-text). Only these files participate in version history; non-editor types (images, previews) do not. First snapshot is lazy — taken the first time the file is saved or its tab is closed after the feature ships, not at feature rollout.
_Avoid_: tracked file, versioned file (overlaps with git).
