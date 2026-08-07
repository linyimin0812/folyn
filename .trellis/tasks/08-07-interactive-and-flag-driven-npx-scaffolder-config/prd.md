# 交互式 + 非交互式 scaffolder

## 目标

`npx create-quill-plugin` 支持两种用法：
- 交互：TTY 下逐项 prompt 缺失字段
- 非交互：所有配置走 flag + `--yes`

## 范围

- 用 `node:util.parseArgs`（stdlib）解析 flag
- 用 `node:readline/promises`（stdlib）做交互 prompt
- 字段：`name`（位置或 `--name`）、`--author`
- `--yes/-y`：跳过 prompt，缺失字段用默认值
- TTY 检测：非 TTY 自动按 `--yes` 行为，避免 piped stdin 卡死
- 模板 manifest 的 `author` 改用 `__author__` 占位符
- 加一个 `test/smoke.mjs`（`node:assert/strict`）跑非交互路径，作为 ponytail 自检

## 非目标

- 不引入 inquirer/prompts/clack 等依赖
- 不加 `--tier`（模板只有 trusted，sandbox 后续任务）
- 不加 `--description`/`--license` 等字段（YAGNI）

## 验收

- `npx create-quill-plugin --yes --name foo --author Jane` 在 cwd 下生成 `foo/`，manifest.author = "Jane"
- 不带参 TTY 下逐项 prompt
- `pnpm test` 跑通 smoke
