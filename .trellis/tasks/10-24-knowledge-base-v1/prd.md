# 知识库第一版：资料收录、索引与主题知识页

需求基线为已确认文档，PRD 不重复其内容，只做实现范围切分与技术设计记录。

- 需求基线（权威）：`docs/design/pageindex-knowledge-base.md`
- 架构决策：ADR-0005 / 0006 / 0007 / 0008 / 0009（`docs/adr/`）
- 术语表：`CONTEXT.md`

## 目标

在 Folyn 中实现基于结构导航的知识库第一版：用户声明知识库目标、选定收录范围，AI 从资料生成资料索引与带来源引用的主题知识页，支持结构导航 + 关键词的预算内检索问答。文件为真源，随 Vault 携带。

## 实现切片（按端到端可验证排序）

1. **切片 A（首个端到端）**：收录范围选定与持久化 → 资料索引生成（含引用版本快照）→ 主题知识页生成（自动新建 + 来源引用，满足"模型提议、程序写入"）→ 关键词 + 结构导航检索问答（10 秒预算）。
2. **切片 B**：增量更新（资料变化 → 索引更新 → 更新候选 → 重复佐证补引用 / 新事实入章 / 修订入审阅）。
3. **切片 C**：审阅 UI（待审阅修订确认）、人工删除意图、引用待核验。
4. **切片 D**：来源移除标记、检索证据状态展示（冲突 / 待更新 / 已移除来源）。

第一版交付目标为切片 A–C；切片 D 中"来源已移除标记"为检索证据展示的一部分，随切片 A 的证据结构一并落字段。

## 技术设计

### UI：阅读工作台（2026-10-24 UI 交接后确定）

交互说明：`~/.codex/visualizations/2026/10/24/01a16dbd-7233-72c0-b51d-3d0b3d1883dd/folyn-knowledge-ui-notes.md`（原型 HTML 同目录，仅供观察，不复制样式/DOM/切换器）。采用推荐的"阅读工作台"：侧栏聚焦主题与待处理入口，主工作区四页（知识/提问/资料/审阅），来源依据按需旁侧展开；吸收问答工作台的证据列表与资料工作台的资料维护视图。知识页编辑用现有 Markdown 编辑器，不另造编辑器与顶层路由；主区全区域视图仿 `SessionDetailView` 先例按 `activePanel === 'knowledge'` 挂载。停止跟踪、审阅采用/保留做成真实操作（manifest 标记 removed；reviews 应用前目标页 hash 复核）。

基于代码调研（`research/codebase-map.md`）：ADR-0004 的 wiki 代码不在 master，本任务在 master 上新写；模型走 `runRigChat`（`chat_stream`，无工具无文件访问，`historyMode: 'none'`），程序校验后写入 —— 直接满足 ADR-0006 "模型提议、程序写入"。不做全项目构建（AGENTS.md）。

### 落点与目录

全部改动在前端 TS：`apps/desktop/src/services/knowledge/`（服务层）+ `apps/desktop/src/store/knowledgeStore.ts` + 面板组件。无 Rust 改动。

Vault 内数据目录 `<vault>/__kb__/`（文件真源，随 Vault 携带，ADR-0009）：

```
__kb__/
  manifest.json              # { goal, sources: {srcId -> {path, currentHash, indexVersion}}, topics: {tpId -> {path, title}} }
  sources/<srcId>.index.json # 资料索引：nodes [{title, summary, startLine, endLine}]（ADR-0005）
  sources/<srcId>/<hash>.md  # 被引用版本快照，仅在被引用时落盘（ADR-0007）
  topics/<tpId>.md           # 主题知识页：frontmatter { id, title, sources } + 正文（含引用标记 [^cN]）
  topics/<tpId>.refs.json    # 来源引用：[{ id, topicId, anchorText, srcId, versionHash, startLine, endLine, status }]
  navigation.json            # 主题导航：主题 → 知识页 + 关联资料（ADR-0005）
  reviews.json               # 待审阅修订队列（切片 A 只落记录，UI 在切片 C）
  deletions.json             # 人工删除意图（切片 C 起用，切片 A 先建 schema 占位）
```

可重建的关键词索引放机器本地 `~/.folyn/vaults/<vaultId>/kb-cache/`（派生数据不入 Vault，ADR-0009）。

### 关键机制

- **稳定标识**：`generateShortId` 生成 `src-*` / `tp-*`，存 manifest；路径仅记录位置。移动/重命名识别（hash 匹配旧路径消失）从切片 B 起做。
- **写入一致性**：`.tmp` + rename 原子写（versionHistoryService 先例）；程序写入前校验目标页当前 hash 与上次程序写入一致，用户编辑过（hash 变化）则降级进 reviews.json，不覆盖（ADR-0006）。
- **程序校验**（写入前逐条）：引用的 srcId 存在、versionHash 与资料当前 hash 一致、行号范围落在真实文件内、索引节点范围不重叠越界；校验不过的变更丢弃并记日志。
- **资料索引**：模型按段落/标题提 nodes JSON，程序用实际文件行数校验范围；无标题/长文本允许语义分层，不改原文（ADR-0005）。
- **长文分块**：超长资料按索引节点分块多次调用模型，合并结果。
- **关键词索引**：BM25（英文 token + 中文 bigram、标题/摘要加权），覆盖资料全文 + 知识页 + 索引摘要；重建命令 + ingest 后增量更新。
- **检索（ADR-0008）**：程序驱动的多轮循环，模型每轮返回 JSON 动作 `{action: 'list_topics'|'open_topic'|'search'|'read_source'|'done', args}`；程序执行（BM25 搜索、按行读原文片段、列导航）并回填观测；程序限制：10 秒墙钟 + 最大轮数（初值 8 轮，待验证）+ 每轮读取量上限；到限返回已有证据与缺口。循环只产出结构化证据（片段、srcId、versionHash、行范围、状态标记）；回答层是独立的第二次 `runRigChat` 调用，输入证据、输出答案 —— 检索与回答分开评估。
- **AI 配置**：复用现有 chat 模式设置（provider/model/apiKey/baseUrl），与 Bubble Template AI Agent 同链路。
- **触发**：收录范围内的文件新增/修改由现有 vault watcher 事件驱动（`fileWatcher` / `start_vault_watcher`），程序写入用 `suppressWatcherFor` 防自触发循环。

### 面板 UI（最小）

注册 builtin panel `knowledge`（`registerBuiltinPanels.tsx`，order 在 files 之后）：目标与收录范围设置（复用文件树选择）、构建/更新按钮（分项发布进度：单份资料/单页完成后即可检索，ADR-0009）、提问框 + 证据展示（来源、版本、位置、状态）。知识页是 Vault 普通文件，用现有 markdown 编辑器打开。

### 未决事项的最小完整方案（不重开产品访谈）

- 去重/冲突判定：切片 B 中按 anchorText + 引用重叠初判，模型判定辅助，产物一律进审阅 —— 宁可多进审阅不自动改写。
- 段落定位：行范围（startLine/endLine）+ anchorText 双保险；显示时高亮行范围。
- 分项发布：每份资料/每页独立 `.tmp`+rename，manifest 最后更新即视为发布完成。
- 搜索实现：BM25（上文）；tantivy/FTS 等引入推迟到 10 秒预算实测不达标。

## 验收

- 单 Vault 1,000 份资料为验收基准（性能数字为待验证目标，未达标如实记录）。
- 检索质量按 `docs/design/pageindex-knowledge-base.md` 验收章节：固定问题预标注可接受证据，检查必要证据覆盖、来源版本与位置、冲突 / 待核验状态，及 10 秒时间预算。
- 测试遵守 AGENTS.md：不做全项目编译 / 构建，用定向单文件 / 单 crate 检查与最小可运行验证。
