# Mochi 网页知识卡片（clips feature）

本目录是 clips feature 的运行时上下文。Agent 调用时 cwd = `<vault>/__clips__/`，自动发现 `.claude/agents/clips.md`。

## Vault 布局

- `__clips__/` — 知识卡片根目录（本 feature 的内容目录，兼作 agent cwd）。
  - `<primary-tag>/<YYYY-MM-DD>-<slug>.md` — 一张知识卡片一个文件，按主标签分目录。
- 其它 feature 目录（`__wiki__/` / `__daily__/` / `__reports__/` / `__analyze__/`）与 clips 无直接交互。

## 卡片文档结构

每个 `__clips__/<tag>/<date>-<slug>.md` 固定 front-matter + 正文段：

```markdown
---
title: "<页面标题>"
type: clip
url: "<原网页 URL>"
tags: ["主标签1", "主标签2"]
clipped: <YYYY-MM-DD>
---

> **来源**: [<hostname>](<url>)

## 摘要

<2-4 句话摘要>

## 要点

- <要点1>
- <要点2>
```

## 文件命名规则

- slug 来自标题：小写、CJK 保留、非字母数字折叠为 `-`、首尾不留 `-`、最长 60 字符；空串回退 `clip`。
- 文件名：`<YYYY-MM-DD>-<slug>.md`。
- 主标签目录不存在时由调用方（clipService.saveClip）自动创建。

## Feature 级约定

- agent 只输出 JSON 元数据，**不**直接落盘卡片文件（落盘由调用方 clipService.saveClip 处理）。
- agent 不修改 vault 内任何已有文件。
- 抓取网页用 WebFetch；标签优先用正文关键概念，中文页面用中文标签，英文页面用英文标签。
