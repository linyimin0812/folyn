# persist-fetched-and-cache-fallback

## Goal

「获取模型」按钮（`ModelServicesSettings` / `ModelPickerModal` refresh）目前拉取的 `Model[]` 只存内存 store。用户要：
1. 拉取成功 → 把数据写入 `~/.quill/providers/{providerId}/models.json`（落盘缓存）
2. 拉取失败 → 读 `{providerId}/models.json` 兜底回填 store，并提示用户"拉取失败，使用缓存数据"

## What I already know

- 按钮 onClick：`ModelServicesSettings.tsx:314-323` → `fetchModelsForProvider(pid, key, base, azureApiVer, isCustom, adapterFamily)`
- Store action：`modelRegistryStore.ts:89-120` — 设 `fetchStatus='loading'` → `fetchModelsRaw` (Tauri `list_models`) → 成功写 `modelsByProvider[pid]` + `lastFetchedAtByProvider[pid]` + `schedulePersist()`；失败设 `fetchStatus='error'` + `fetchErrorByProvider[pid]`
- 拉取数据形状：`Model[]`（`{id, providerId, capabilities, inputModalities, pricing, displayName?, group?}`）
- 已有原语：`userProvidersCatalog.ts` 的 `readUserProviderModels(pid)` / `writeUserProviderModels(pid, file)` — 但 on-disk shape 是 `Record<string, ModelsDevModel>`（models.dev raw slice），与 `Model[]` 不兼容
- `refetchAllFromModelsDev` 是已死 infra（同步按钮已删，无调用点）；`readUserProviderModels`/`writeUserProviderModels` 也未 wired 进 loader
- 错误 UI：`ModelPickerModal.tsx:185-189` 内联红字 banner，已有 `fetchError` 显示

## Open Questions

* on-disk shape 冲突：`ProviderModelsFile` 文档说是 models.dev raw shape，但拉取路径产生的是 `Model[]`。是改 shape 为 `Model[]`（顺带清掉已死的 `refetchAllFromModelsDev` + `buildModelsFile` + models.dev shape 类型），还是用独立 cache 文件？

## Requirements (evolving)

1. `fetchModelsForProvider` 成功路径：调 `writeUserProviderModels(pid, result.models)` 落盘。
2. `fetchModelsForProvider` 失败路径：调 `readUserProviderModels(pid)`，若非空，回填 `modelsByProvider[pid]` + 给 `fetchErrorByProvider[pid]` 附加"（已使用缓存数据）"提示。
3. `ProviderModelsFile` shape 改为 `Model[]`（或等价）；更新 `userProvidersCatalog.ts` 模块头部注释反映新 shape。
4. 顺带清掉已死的 `refetchAllFromModelsDev` + `RefetchResult` + `buildModelsFile` + 不再用的 `fetchModelsDevCatalog` / `fetchOwnerMap` / `ownerLookupKey` import（在 `userProvidersCatalog.ts` 内）。
5. 不动 Tauri `list_models` Rust 侧——它已经返回正确的 merge 后数据。

## Acceptance Criteria (evolving)

- [ ] 拉取成功 → `~/.quill/providers/{pid}/models.json` 存在，内容是 `Model[]` JSON
- [ ] 拉取失败 + 缓存文件存在 → store 仍能展示模型列表，UI 显示"拉取失败，使用缓存数据"提示
- [ ] 拉取失败 + 无缓存 → 仍按现有行为报错（空列表 + fetchError）
- [ ] `pnpm typecheck` 全绿
- [ ] `pnpm test` 相关测试通过（新增 store 测试覆盖两条路径）

## Out of Scope

- Tauri Rust 侧改动
- 跨页面通用 toast 系统（沿用 `ModelPickerModal` 内联 banner）
- models.dev-shape 未来 wiring（本次清掉相关 dead infra 后，文件路径仍存在但 shape 改为 `Model[]`）

## Technical Notes

- 按钮 + store action 路径：`ModelServicesSettings.tsx:314` → `modelRegistryStore.ts:89-120`
- 已有原语：`userProvidersCatalog.ts:43,55`（read/write）
- 错误 UI：`ModelPickerModal.tsx:185-189`
- `Model` 类型：`apps/desktop/src/services/modelRegistry/types.ts`
- 落盘原语内部已 try/catch 吞错（`readUserProviderModels` 返 null）—— write 路径需要决定是否吞错（建议吞，缓存写失败不应阻塞主流程）
