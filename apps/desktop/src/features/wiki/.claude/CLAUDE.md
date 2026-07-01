# Quill 知识库 Wiki（wiki feature）

本目录是 wiki feature 的运行时上下文。Agent 调用时 cwd = `<vault>/__wiki__/`，自动发现 `.claude/agents/wiki.md`。单 agent 多 action（ingest / generate / lint / query）。

## Vault 布局

- `__wiki__/` — wiki 知识库根目录（本 feature 的内容目录，兼作 agent cwd）。
  - `schema.md` — wiki 页面类型与 front-matter 规则（schema 定义）。
  - `purpose.md` — 知识库目标与范围（用户编辑）。
  - `index.md` — wiki 索引页（列出所有页面，含 `[[wiki://path]]` 链接）。
  - `overview.md` — 知识概览页（AI 维护的简短摘要）。
  - `log.md` — wiki 变更日志。
  - `entities/<name>.md` — 实体页（人/组织/项目/技术）。
  - `concepts/<name>.md` — 概念页（理论/方法/模式/原则）。
  - `sources/<name>.md` — 源文档摘要页（每个被摄入的源文件一个）。
  - `syntheses/<name>.md` — 综合页（高价值查询答案）。
  - `cache/hashes.json` — 源文件内容哈希缓存（摄入去重用）。
  - `cache/reviews.json` — review items 缓存。
- 其它 feature 目录（`__study__/` / `__clips__/` / `__daily__/` / `__reports__/` / `__analyze__/` / `__schedule__/`）与 wiki 无直接交互。

## 页面文档结构

每个 wiki 页面固定 front-matter + 正文：

```markdown
---
title: "<页面标题>"
type: <entity|concept|source|comparison|synthesis>
sources:
  - <vault 相对源文件路径>
tags: ["tag1", "tag2"]
created: <YYYY-MM-DD>
updated: <YYYY-MM-DD>
confidence: <high|medium|low>
related: []
---

# <页面标题>

<正文>
```

## 链接格式

- wiki 页面间互引：`[[wiki://entities/react]]` 或 `[[wiki://entities/react.md]]`（`.md` 可省）。
- 引用 vault 源文件：`[[notes/tech/react-hooks]]`（vault 相对路径，无 `wiki://` 前缀）。

## 文件命名规则

- 文件名 kebab-case：`react-hooks.md`、`state-management.md`。
- 实体页 `entities/<kebab>.md`、概念页 `concepts/<kebab>.md`、源摘要页 `sources/<kebab>.md`（kebab 取源文件 vault 相对路径，`/` 折叠为 `-`、去扩展名）。

## Feature 级约定

- ingest action：分析源文档 → 输出 JSON（entities/concepts/connections/contradictions/structureRecommendations）。
- generate action：基于 ingest 分析结果，用 Edit/Write 直写 `entities/` / `concepts/` / `sources/` 下 wiki 页面 + 更新 index.md/log.md/overview.md（ingest 流程的写盘步骤）。
- lint action：扫描 wiki 页面，输出 ReviewItem[] JSON（缺失页面 / 孤立页面 / 过时内容等）。
- query action：基于 wiki 上下文回答用户问题，输出 Markdown，用 `[[wiki://path]]` 引用来源。
- agent 不修改 vault 内 wiki 目录以外的文件。
