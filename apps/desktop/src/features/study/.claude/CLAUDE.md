# Quill 学习工作台（study feature）

本目录是 study feature 的运行时上下文。Agent 调用时 cwd = `<vault>/__study__/`，自动发现 `.claude/agents/study.md`。

## Vault 布局

- `__study__/` — 学习主题文档根目录（本 feature 的内容目录，兼作 agent cwd）。
  - `<slug>.md` — 一个学习主题一个文件，slug 来自标题（CJK 保留，非字母数字折叠为 `-`）。
  - `<slug>/<link>.md` — 主题下的子文档（精细加工笔记、SQ3R 预读等）。SQ3R 子文档命名 `sq3r-<materialSlug>.md`，每资料一个，保留时由前端写入、再次点击直接读出展示（不调 AI）。
- `__daily__/` — 每日日记，学习单元排期回链寄居在 `## 任务` 段的任务行属性块中。
- `__clips__/` / `__wiki__/` / `__reports__/` / `__analyze__/` — 其它 feature 目录，与 study 无直接交互。

## 主题文档结构

每个 `__study__/<slug>.md` 固定五段（front-matter + H2 段）：

```markdown
---
title: "<主题标题>"
slug: <slug>
created: <YYYY-MM-DD>
---

## 资料

## 计划

## 笔记

## 复习

## 检测
```

- `## 资料` 段由 studyStore 托管：每行 `- @book <书名> | <作者> | <简介> | 难度:<易|中|难> | <链接>` 或 `- @web <标题> | <链接> | <简介>`。
- `## 计划` 段由 studyStore 托管：每行 `- [ ] <序号>. <单元名> @{est:<估时> dep:<先修序号|-> prog:<0-100>}`。
- `## 笔记` 段是散文式（不托管）：用户自由写，feynman/selftest 动作在此段段尾追加 callout 块；sq3r 不再寄生此段，单独落子文档（见上）。
- `## 复习` 段由 studyStore 托管：SM-2 复习原子行。
- `## 检测` 段由 studyStore 托管：每行 `- [ ] Q. <题目> | <答案> | <来源>`（答案内不含 `|`）。

## 文件命名规则

- slug 小写、CJK 保留、非字母数字折叠为 `-`、首尾不留 `-`、最长 60 字符；空串回退 `topic`。
- 文件名 stem 必须与 front-matter `slug` 一致（createTopic 保证）。

## Feature 级约定

- 始终 append-only：feynman/selftest 动作只在 `## 笔记` 段段尾追加 callout，不删除或改写已有内容；sq3r 写独立子文档（覆盖写）。
- research/plan/atoms/quiz 动作只输出文本建议行，绝不直接编辑主题文档（落盘由 studyStore 捕获 effect 处理）。
- 主题文档路径以运行指令中的 `topicPath` 为准（vault 相对路径，如 `__study__/agent-dev.md`）。
- 学习单元排期回链属性 `study:<slug>` / `unit:<order>` 寄居在 daily note 任务行的属性块中，由 schedule 侧透传机制保留。
