# restore-owner-field-in-models-json

## Goal

`1aad190` 改了 `models.json` shape 为 `Model[]`，丢掉了旧的 `owner` 字段（之前 `refetchAllFromModelsDev` 写盘时从 `fetchOwnerMap()` 给每条模型注入 `owner: ownerMap[ownerLookupKey(m.id)] ?? m.providerId`）。用户要 owner 字段回来。

## What I already know

- `Model` 类型（`services/modelRegistry/types.ts:23`）没有 `owner` 字段。catalog `data/models-catalog.json` 也没有。
- owner 数据源：`fetchOwnerMap()`（OpenRouter `/models` + `/embeddings/models`）→ `Record<modelId, provider>`，`ownerLookupKey(id)` 解析 `~openai/gpt-latest` → `gpt-latest`。
- 旧实现（已删）：`refetchAllFromModelsDev` 在 `buildModelsFile` 里 `out[id] = { ...m, owner: ownerMap[key] ?? defaultOwner }`。
- 当前写盘：`modelRegistryStore.ts:fetchModelsForProvider` 成功后 `void writeUserProviderModels(pid, result.models)`，纯 `Model[]`，无 owner。
- owner 没有 UI 消费者（grep `owner` 只在 `fetchModelsDev.ts:95` 和 `fetchOwnerMap.ts` 注释里）—— owner 是给未来 wiring / 用户检视文件用的。

## Requirements

1. `modelRegistryStore.ts:fetchModelsForProvider` 成功路径：写盘前用 `fetchOwnerMap()` 拉一份 owner map，给 `result.models` 每条注入 `owner: ownerMap[ownerLookupKey(m.id)] ?? m.providerId`，再写 `models.json`。
2. owner 注入只在写盘前做；in-memory `Model` 类型和 `modelsByProvider` store 状态不动（owner 是文件层关心的事，UI 不消费）。
3. `fetchOwnerMap()` 失败时，写盘回退为不注入 owner（或全部 owner=providerId）—— 保持 fire-and-forget，不阻塞主流程。
4. 不改 `Model` 类型（不在 TS 契约里加 `owner`，避免 catalog/merge 链路需要同步处理）。

## Acceptance Criteria

- [ ] 成功拉取后 `~/.quill/providers/{pid}/models.json` 每条 model 有 `owner` 字段，值来自 OpenRouter owner map（未匹配则 `= providerId`）
- [ ] OpenRouter owner 拉取失败时，文件仍写入（owner 字段可省略或全为 providerId）
- [ ] in-memory `modelsByProvider[pid]` 不含 owner（保持 `Model[]` 契约）
- [ ] `pnpm typecheck` 全绿
- [ ] `pnpm test` 新增/既有 store 测试通过

## Out of Scope

- 在 `Model` 类型加 `owner`（不动 TS 契约）
- UI 消费 owner（暂无消费者，不预先做）
- OpenRouter owner map 缓存/去重（每次成功拉取都重拉 owner map，ponytail：YAGNI，等慢了再加）

## Technical Notes

- 写盘位置：`apps/desktop/src/store/modelRegistryStore.ts:fetchModelsForProvider` 成功路径末尾 `void writeUserProviderModels(...)`
- owner 数据源：`apps/desktop/src/services/modelRegistry/fetchOwnerMap.ts:fetchOwnerMap()` + `ownerLookupKey(id)`
- 旧实现参考（已删）：`refetchAllFromModelsDev` 的 `buildModelsFile`
