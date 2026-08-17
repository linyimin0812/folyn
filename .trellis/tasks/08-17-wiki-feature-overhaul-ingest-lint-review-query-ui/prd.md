# Wiki Feature Overhaul — Ingest / Lint / Review / Query / UI

**ADR**: `docs/adr/0004-wiki-write-and-lint-code-driven.md` (C1.c + B1.c 合并).
**Scope**: 五个维度全做，按 C → B → D → A → E 顺序实施。每个维度以 grilling 决策为契约，不重新设计。

---

## C — Ingest 质量

### C1.c 混合写盘
- 代码写：`entities/` / `concepts/` / `sources/` / `syntheses/` 页 + `index.md` / `log.md` 追加
- Agent 写：仅 `overview.md`
- Agent prompt `__wiki__/.claude/agents/wiki.md` 删除 `generate` action；新增 `overview` action

### C2.b 合并语义
- frontmatter: `sources`/`tags`/`related` 并集；`created` 不动；`updated` 改今天；`confidence` 取 min；`title`/`type` 不可自动改，不同则推 ReviewItem
- body: 追加 `## Update <date> (from <source-path>)` 段
- `analysis.contradictions` 命中字段不追加 body，推 ReviewItem

### C3.b overview 触发
- 整批 ingest 完后调一次 agent `overview` action
- 输入：当前 overview + index + purpose + 本次变更页面列表 `{path, title, type, sources}`
- 输出：仅 `overview.md` 正文（≤ 30 行）

### C4.b kebab 碰撞
- 检测碰撞，不写盘
- 推 `structure_change` ReviewItem（checkId=`kebab_collision`）
- `toKebabCase` 抽到共享 util（`apps/desktop/src/utils/wikiNaming.ts`），代码与 ingest 服务共用

### C5.a confidence 规则
- 命中 contradiction → low
- `sources.length >= 2` → high
- 否则 → medium
- merge 取 min；本次 contradiction 强制降 low

### C6.a 空摄入
- 仍写 `sources/<kebab>.md`，body 标注"未识别到实体或概念"
- 附 `analysis.structureRecommendations`
- frontmatter `confidence: low`
- `log.md` 追加一条

### C7.b schema 归属 + index/log 格式
- `schema.md` 用户手维护；lint 检测与 TS `WikiFrontmatter` 字段集合漂移
- `index.md` 追加格式：`- [[wiki://<path>]] <title>  _(<source>)_`（仅新增页，去重按行首链接 path）
- `log.md` 追加格式：`- <date> ingest <source> → +<n>new / ~<m>updated entities, +<p>new / ~<q>updated concepts, <r> contradictions`

---

## B — Lint 深度

### B1.c 执行模型
- 代码做结构性 lint（13 条，见 B2）
- Agent 做 `lint_semantic`（S1）
- `wikiLintService` 拆成 `runStructuralLint()` 和 `runSemanticLint()`

### B2 MVP 检查清单
代码侧 13 条（checkId）：
1. `missing_page` (existing)
2. `orphan_page` (existing)
3. `stale_content` (existing)
4. `frontmatter_invalid`
5. `sources_path_invalid`
6. `related_asymmetric`
7. `schema_drift`
8. `kebab_collision`
9. `confidence_violation` (C5.a 反向校验)
10. `updated_older_than_source_mtime`
11. `cache_orphan` (cache 残留已删源路径)
12. `index_missing_page`
13. `log_missing_ingest`

Agent 侧 1 条：
- S1 `semantic_duplicate_merge_suggestion`

### B3 action 映射
见 grilling 决策表。关键点：
- accept 自动执行；reject 标 dismissed 不删；merge 分代码路径（kebab_collision）与 agent 路径（S1）；research 调 `runWikiQuery`
- 每个 ReviewItem 的 `suggestedActions` 按 checkId 注册的 handler 暴露

### B4 触发
- 代码结构性 lint：ingest 整批完后自动 + UI 手动"重新检查"
- Agent S1：仅手动触发（"运行深度语义 lint"）
- 去重：相同 dedupKey 已 pending → 更新 lastSeenAt；已 resolved/dismissed → 静默丢

### B5 性能 + 原子性
- 无缓存，全量扫
- accept/merge/reject 批写 → `<vault>/__wiki__/.staging/` → 同卷 atomic rename
- `.staging/` 必须在 `__wiki__/` 内（同卷约束）

---

## D — Review 闭环

### D1.b 执行器架构
- `apps/desktop/src/services/reviewActionHandlers.ts` 导出 `Map<checkId, ActionHandler>`
- `ActionHandler` 接口：`accept/reject/merge?/research?` 各返回 `Promise<{applied, log}>`
- `ReviewItem` 类型扩：`checkId`、`dedupKey`、`lastSeenAt`、`resolvedAt?`、`dismissedAt?`

### D2.a 生命周期
- dedup key = `checkId + affectedPages.sort().join('|')`
- pending → resolved (accept/merge 成功) / dismissed (reject)
- 30d 后 resolved/dismissed 移到 `cache/reviews-archive.json`
- `reviews.json` 仅 pending + 30d 内
- `clearResolvedReviews` 改为"归档"而非"删除"

### D3 触点 MVP
- WikiFileTree 顶部 pending 徽标
- Ingest 完成提示带"查看 N 项"跳转
- Reviews 面板（侧栏 sub-tab）：按 checkId 分组，每条带 accept/reject/merge/research 按钮
- command palette 三命令："打开 Wiki Reviews" / "运行结构性 lint" / "运行深度语义 lint"

### D4 research 契约
- 调 `runWikiQuery(item.title, {item.description, affectedPages frontmatter})`
- 返回 Markdown 渲染在 ReviewItem 下方展开区
- 不改 item status，仅更新 lastSeenAt

### D5 merge 契约
- 用户在 UI 选保留页（affectedPages 之一）
- 非保留页移到 `.staging/`，事务提交后删
- `log.md` 追加 `- <date> merged <deleted> into <kept>`
- kebab_collision 走代码合并（body concat + frontmatter union）
- S1 走 agent merge（新增 `merge` action：输入多页内容，输出单页 body + frontmatter JSON）

---

## A — Query 召回

### A1.e 召回算法
- BM25 召回所有 wiki 页 body，top 20 → seed
- 沿 `WikiGraphStore.getNeighborIds` 扩 1 跳邻居，并入 candidate set
- rerank：seed 优先，邻居 weight * 0.5
- stretch：向量召回（不上 MVP）

### A2.d context 预算
- 滑动窗口：按 rerank 顺序塞页，累计 token 超过 `AI_CONTEXT_BUDGET_TOKENS=6000` 就停
- 单页 > 4000 字符截断到 4000（保 frontmatter + 前 N 段）
- 超预算页走 A3 摘要

### A3.b 摘要策略
- 批量摘要 LLM 调用：一次喂 N 页 → 返回 `[{path, summary}]` JSON；每页 ≤ 200 字
- batch 大小上限 20 页，超过分批
- 摘要失败 fallback 到代码截断（取前 200 字 + 前 2 段）
- 缓存：`cache/summaries.json`，键 = page path + page content hash；ingest 写盘后失效

### A4.b 多轮
- `wikiQueryStore`（新建）持 `sessionId: string | null`
- 首次 query: null → rig backend 新建 session
- 后续: 传 sessionId → agent 保留上下文
- UI 有"新建会话"按钮清 sessionId
- 召回缓存（A3）按 query 字符串缓存，与 sessionId 无关

### A5 synthesis + 失败兜底
- `saveToWiki(title, content, relatedQuery, sourcePaths, relatedPages)` 扩签名
  - sourcePaths → frontmatter `sources:`
  - relatedPages → frontmatter `related:`
  - confidence: low
  - 调 `appendIndexLog` 共享 util
- 失败兜底：
  - 空召回：不调 agent，UI 显示"wiki 未找到相关页"
  - agent 输出非 Markdown：剥离代码块后展示；仍非文本 → 空答案
  - LLM 异常：UI 错误 + 重试按钮，保留 sessionId

---

## E — UI/UX

### E1 ingest 入口
- WikiFileTree 顶部"添加源文件"按钮 → 弹 picker
- Vault 文件树右键 .md "Ingest to Wiki"
- Vault 树多选右键批 ingest
- command palette "Ingest current file to Wiki"
- 进度：复用 `wikiStore.activityLog` + `currentIngestStep`；WikiFileTree 底部进度区
- 取消按钮：MVP 砍

### E2.b query UI 形状
- 主区独立 `wiki-query` tab 类型
- 布局：上=历史 + 输入框 + "新建会话" + "保存为综合页"；中=答案 Markdown + 召回链接；下=进度
- 关闭 tab = 清 sessionId

### E3.c 布局整合
- 侧栏单 "Wiki" tab，内部 sub-tab：Files（现有 WikiFileTree）/ Reviews（新建 WikiReviewsPanel）
- 主区 tab 类型：`wiki-query`（E2）、`wiki-graph`（迁移 WikiGraphView 到主区）
- Tab 持久化：vault 切换时关闭 wiki-query / wiki-graph
- Activity bar 不新增图标（复用现有 Wiki 入口）

### E5.b 可配置项
- `wiki.lint.autoAfterIngest: boolean` (default true)
- `wiki.lint.semanticManualOnly: boolean` (default true)
- `wiki.review.archiveRetentionDays: number` (default 30)
- `wiki.query.cacheTtlMinutes: number` (default 5)
- 位置：SettingsPage 新增 "Wiki" section；i18n 走现有 locales
- 配置变更不 hot reload，下次 lint/重启生效

---

## 实施顺序

1. **C 全部**（先 C7 共享 util → C1 代码写盘 → C2 合并 → C5 confidence → C4 碰撞 → C6 空摄入 → C3 overview agent action）
2. **B 全部**（B1 拆服务 → B2 13 条 check 实现 → B5 事务 → B4 触发 → B3 action handler 接口预留 D1）
3. **D 全部**（D1 handler 实现 → D2 生命周期 → D5 merge → D4 research → D3 UI 触点）
4. **A 全部**（A1 BM25 + 图扩展 → A2 token 预算 → A3 摘要 + 缓存 → A4 多轮 → A5 synthesis）
5. **E 全部**（E3 布局 → E1 ingest 入口 → E2 query tab → E5 settings → 收尾）

---

## 已知未闭合项（不进 MVP）

- 并发 ingest 互斥（单进程串行，假设不撞）
- 取消 ingest（adapter.stop 后半成品状态靠 hash dedup 续传）
- Ingest 中途 agent 崩 → 部分写入 entity 页留作半成品，lint 兜底标 stale
- 行内编辑器顶部横幅提示（D3 #4）
- WikiGraphView 节点标红（D3 #6）
- 向量召回（A1.c stretch）
- 拖拽 ingest 入口（E1 #3）
- 缓存 frontmatter 解析（B5.b 跨 stretch）
- 摘要滑动窗口的事务回滚（B5.y 同）
