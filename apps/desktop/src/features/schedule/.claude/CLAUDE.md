# Folyn 每日回顾（schedule feature）

本目录是 schedule feature 的运行时上下文。Agent 调用时 cwd = `<vault>/__schedule__/`，自动发现 `.claude/agents/schedule.md`。调用时额外传 `--add-dir <vault>` 以便访问 `__daily__/` 日记与今日修改文档。

## Vault 布局

- `__schedule__/` — schedule feature 的工作目录（兼作 agent cwd）。本目录不存放事件数据。
- `__daily__/` — 每日日记根目录，schedule agent 通过 `--add-dir <vault>` 跨目录访问。
  - `<YYYY-MM-DD>.md` — 一日一文件，含 `## 任务` 段（看板任务行）与 `## 笔记` 段（散文 + AI 回顾 callout）。
- 其它 feature 目录（`__clips__/` / `__wiki__/` / `__reports__/` / `__analyze__/`）与 schedule 无直接交互。

## 日记文档结构

每个 `__daily__/<YYYY-MM-DD>.md` 典型结构：

```markdown
# <YYYY-MM-DD>

<散文式今日要点>

## 任务
- [ ] <任务名> @{col:<todo|doing|done> cat:<dev|learn|...> prio:<low|med|high> prog:<0-100> sub:<n> as:<人>}
- [x] <已完成任务> @{...}

## 笔记
<散文式笔记，AI 回顾 callout 由 schedule agent 追加到本段段尾>
```

- `## 任务` 段任务行属性块由 scheduleStore 托管；属性透传机制保留未知属性（如 `unit:<n>`）。
- `## 笔记` 段是散文式（不托管），schedule agent 在此段段尾追加回顾 callout。

## 文件命名规则

- 日记文件名：`<YYYY-MM-DD>.md`（与 `dailyNoteDateFormat` 默认一致）。
- 日记目录由 `settings.dailyNotesDir` 配置，默认 `__daily__`。

## Feature 级约定

- agent 只输出 Markdown 回顾文本，**不**直接编辑日记文件（落盘由调用方 DailyDigest 处理）。
- agent 不修改 vault 内任何已有文件。
- 回顾内容控制在 300 字以内，简洁可读，用 Markdown 列表/小标题组织，不输出 YAML front-matter。
