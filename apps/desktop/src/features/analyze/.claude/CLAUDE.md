# Quill 项目分析（analyze feature）

本目录是 analyze feature 的运行时上下文。Agent 调用时 cwd = `<vault>/__analyze__/`，自动发现 `.claude/agents/analyze.md`。

## Vault 布局

- `__analyze__/` — analyze feature 的工作目录（兼作 agent cwd）。agent 在此克隆仓库、探索源码，**不**写入 vault。
- `__reports__/` — 项目分析报告落盘目录（由调用方 githubAnalysisService.saveReport 写入，非 agent 直接写）。
  - `<YYYY-MM-DD>-<repo>.html` — 自包含 HTML 报告。
  - `<YYYY-MM-DD>-<repo>.tags.json` — 标签边车 JSON。
- 其它 feature 目录（`__study__/` / `__clips__/` / `__wiki__/` / `__daily__/` / `__schedule__/`）与 analyze 无直接交互。

## 报告文件命名规则

- 文件名：`<YYYY-MM-DD>-<repo>.html`，repo 取 GitHub 仓库名（去掉 `.git` 后缀与尾部斜杠）。
- 标签边车：与报告同名，扩展名 `.tags.json`，内容 `{ "tags": ["tag1", "tag2"] }`。

## Feature 级约定

- agent 克隆仓库用临时目录（Bash），**不**写入 vault（`__analyze__/` 仅用于 agent 自发现，不存放克隆产物）。
- agent 只输出 `---TAGS---` 块 + HTML 代码块；落盘（写 `__reports__/`）由调用方处理。
- agent 不修改 vault 内任何已有文件。
