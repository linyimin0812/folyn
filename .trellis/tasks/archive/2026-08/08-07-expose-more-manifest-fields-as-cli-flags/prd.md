# 扩展 CLI 参数覆盖

## 目标

scaffolder 暴露更多 manifest 字段作为 flag + interactive prompt，不再只有 `--author`。

## 范围

新增 flag（均有默认值，可省略）：
- `--display-name`（默认 = name）→ manifest.name
- `--version`（默认 `0.1.0`）→ manifest.version + package.json.version
- `--quill`（默认 `>=0.1.0`）→ manifest.quill

保留：`[name]`/`--name`、`--author`、`--yes/-y`、`-h/--help`。

交互式（TTY，未通过 flag 提供）：prompt name、display-name、author、version、quill。非 TTY 或 `--yes` 用默认。

模板改动：
- `template/manifest.json`：`"version"` → `__version__`，`"quill"` → `__quill__`
- `template/package.json`：`"version"` → `__version__`

## 非目标

- 不加 `--tier`（模板只有 trusted，sandbox 后续任务）
- 不加 `--description`（manifest 无顶层 description 字段；package.json description 留空让用户自填）
- 不加 `--permissions.*` 复杂对象（用户直接改 manifest 更清晰）

## 验收

- `--version 1.2.3 --quill ">=0.2.0" --display-name "My Plugin"` 全部反映到 manifest
- `pnpm test` 跑通，新增 version + quill 断言
