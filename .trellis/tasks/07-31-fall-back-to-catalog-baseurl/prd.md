# fall-back-to-catalog-baseurl

## Goal

bundled provider（如 OpenRouter）在 settings 没填 baseUrl 时，前端发空 `baseUrl` → Rust `_` 臂默认 `https://api.openai.com/v1` → 请求打到 OpenAI 而不是 OpenRouter，401 报"platform.openai.com"。

用户要的修法：把 catalog 里的默认 baseUrl（来自 `providers.json`）从"placeholder 显示"改成"真实填进输入框并写入 settings.json"。这样：
- 用户切到 OpenRouter 时，baseUrl 输入框直接显示 `https://openrouter.ai/api/v1/`
- 该值被保存到 `providerSettings.openrouter.baseUrl`
- send/test 路径读 `slot.baseUrl` 自然就有值，无需 fallback

## Requirements

1. `aiConfigStore.ts:setChatProvider(v)`：切到 bundled provider 且 `newSlot.baseUrl` 为空时，从 catalog 拿 `providerBaseUrl(entry)` 填进 slot 并持久化。custom provider 不填（无 catalog 条目）。
2. `aiConfigStore.ts:loadFromDisk()`：初始加载时，当前 `chatProvider` 若是 bundled 且 slot.baseUrl 空，同样 seed。避免初次启动时输入框为空。
3. 抽 helper（`seedBundledBaseUrl(slot, id, isCustom)`）承载逻辑，避免两处重复。
4. send/test 路径不动（resolvePairConfig/TestChatModal 仍只读 `slot.baseUrl`）——seed 后 slot 自然有值。

## Acceptance Criteria

- [ ] 切到 OpenRouter（bundled，slot.baseUrl 空）→ 输入框显示 `https://openrouter.ai/api/v1/`，`providerSettings.openrouter.baseUrl` 写入该值
- [ ] 切到 Anthropic（bundled，slot.baseUrl 空）→ 输入框显示 `https://api.anthropic.com`
- [ ] Custom provider 切入 → 输入框为空（不 seed）
- [ ] 用户清空 baseUrl 后不自动回填（只在切换/加载时 seed）
- [ ] OpenRouter 不填 baseUrl + 填有效 key + 检测连接 → 请求打到 `https://openrouter.ai/api/v1/`，不再 401 OpenAI
- [ ] `pnpm typecheck` 全绿
- [ ] `pnpm test` aiConfigStore 测试通过

## Out of Scope

- `resolvePairConfig` / `TestChatModal` 加 catalog fallback（seed 落实后不需要）
- Rust `_` 臂默认值（前端始终发非空 baseUrl）
