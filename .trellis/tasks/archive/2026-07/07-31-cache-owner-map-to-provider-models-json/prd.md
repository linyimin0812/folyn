# cache-owner-map-to-provider-models-json

## Goal

`fetchOwnerMap()` 每次成功拉取都直接请求 OpenRouter `/models` + `/embeddings/models`。用户要：
- 缓存到 `~/.folyn/providers/provider-models.json`（**单一文件**，跨 provider 共享）
- 文件 mtime 在 1 天内 → 直接读缓存，不请求 HTTP
- 文件不存在或 mtime > 1 天 → 请求 OpenRouter，写回缓存
- 文件 shape 扩展为 `{ "{modelId}": { modelId, providerId, capabilities: [] } }`（不只是 `modelId → provider` 字符串）

## What I already know

- 当前 `fetchOwnerMap()`（`services/modelRegistry/fetchOwnerMap.ts:59-82`）返回 `Record<string, string>`（modelId → provider），每次都请求 HTTP
- 消费者：`modelRegistryStore.ts:fetchModelsForProvider` 成功路径——`owner: ownerMap[ownerLookupKey(m.id)] ?? m.providerId`
- OpenRouter `/models` 响应只解析了 `id` 字段（`interface OrModel { id: string }`），没有 capability 数据 → capabilities 暂时只能留空 `[]`
- 路径原语：`userProvidersCatalog.ts` 的 `getUserProvidersDir()` 返回 `~/.folyn/providers`，可复用做缓存目录
- 现有 per-provider `models.json` 在 `~/.folyn/providers/{pid}/models.json`；本缓存文件名为 `provider-models.json`（放在 providers/ 根目录下，**不**是 per-provider）

## Open Questions

* ~~capabilities 字段当前无数据源~~ — **已确认：从 OpenRouter /models 响应填充**

## OpenRouter → Capability 映射

OpenRouter `/api/v1/models` 单条模型 entry 关键字段：
- `architecture.input_modalities: string[]`（如 `["text", "image", "file"]`）
- `supported_parameters: string[]`（如 `["tools", "reasoning", "structured_outputs", ...]`）
- `pricing.web_search: string`（每调用成本，存在即支持）
- `reasoning: { default_enabled, ... }`（reasoning 对象存在表示支持）

映射到我们的 `Capability` union (`vision | reasoning | web-search | function-call | structured-output`)：
- `vision` ← `architecture.input_modalities` 含 `image` / `video` / `file`
- `reasoning` ← `supported_parameters` 含 `reasoning` 或 `include_reasoning`
- `function-call` ← `supported_parameters` 含 `tools`
- `structured-output` ← `supported_parameters` 含 `structured_outputs`
- `web-search` ← `pricing.web_search` 字段存在（非 undefined/null）

## Requirements

1. `fetchOwnerMap.ts` 改返回类型为 `Record<string, OwnerEntry>` where `OwnerEntry = { modelId: string; providerId: string; capabilities: never[] }`。capabilities 暂留空 `[]`。
2. 加缓存逻辑：
   - 缓存路径：`~/.folyn/providers/provider-models.json`（用 `getUserProvidersDir()`）
   - 读缓存：用 `exists` + `stat`（或读文件后比较 mtime）—— 文件存在 AND mtime 在 24h 内 → 返回 `JSON.parse`
   - 否则请求 OpenRouter HTTP（现有逻辑），写回缓存文件，返回
3. 缓存读写失败不阻塞：read 失败 → 走 HTTP；write 失败 → 返回内存 map 不写盘
4. `modelRegistryStore.ts:fetchModelsForProvider` 改 `owner: ownerMap[ownerLookupKey(m.id)]?.providerId ?? m.providerId`
5. 测试：mock HTTP（invoke('fetch_url')）+ FS，覆盖三条路径：缓存命中、缓存过期、无缓存

## Acceptance Criteria

- [ ] 首次拉取：请求 OpenRouter，写 `~/.folyn/providers/provider-models.json`
- [ ] 文件 mtime < 24h：不再请求 HTTP，直接读缓存
- [ ] 文件 mtime > 24h 或不存在：请求 HTTP，覆盖写
- [ ] 文件 shape 是 `{ "{modelId}": { modelId, providerId, capabilities: [] } }`
- [ ] `models.json`（per-provider）的 owner 注入逻辑仍工作（`ownerMap[key].providerId` 兜底 `m.providerId`）
- [ ] `pnpm typecheck` 全绿
- [ ] `pnpm test` 通过（更新后的 modelRegistryStore + fetchOwnerMap 测试）

## Out of Scope

- capabilities 字段从 OpenRouter 响应解析填充（无现成数据源；留空 `[]`）
- 缓存失效策略细化（如按 model 数量增量更新；简单 mtime 即可）
- 手动强制刷新缓存的 UI 入口

## Technical Notes

- `fetchOwnerMap.ts` 当前实现：`services/modelRegistry/fetchOwnerMap.ts:59-82`
- 缓存目录原语：`services/modelRegistry/userProvidersCatalog.ts:getUserProvidersDir()`
- 消费者：`apps/desktop/src/store/modelRegistryStore.ts:fetchModelsForProvider` 成功路径
- 测试文件：`apps/desktop/src/store/modelRegistryStore.test.ts`（已 mock fetchOwnerMap）
- 需要新增 `apps/desktop/src/services/modelRegistry/fetchOwnerMap.test.ts` 覆盖缓存读写
