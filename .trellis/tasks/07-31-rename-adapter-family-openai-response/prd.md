# rename-adapter-family-openai-response

## Goal

把 Custom Provider drawer 里"提供商类型"下拉框的两个显示文本改一下：
- 显示 `openai` → `openai-response`
- 显示 `openai-completions` → `openai`

仅 UI 文案。底层 `adapterFamily` 值（`'openai'` / `'openai-completions'`）和 Rust 路由都不动。

## Requirements

1. `CustomProviderDrawer.tsx` 加一个 label 映射，`<option>` 渲染 label 而非 value
2. 不改 Rust、不改 providers.json、不改 ADR、不改其他 docstring/注释/测试

## Acceptance Criteria

- [ ] drawer 下拉框显示 `anthropic` / `openai` / `ollama` / `gemini` / `openai-response`（排序后）
- [ ] 选 "openai-response" 时存入的 `adapterFamily` 仍是 `'openai'`
- [ ] 选 "openai" 时存入的 `adapterFamily` 仍是 `'openai-completions'`
- [ ] `pnpm typecheck` 全绿

## Out of Scope

- 跨层 rename（chat.rs match arm、providers.json、ADR、tests、docstrings）
