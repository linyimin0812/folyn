# merge-owner-map-into-custom-fetched-models

## Goal

自定义 provider 点「获取模型」后，fetched `Model[]` 缺 `capabilities`（Rust `list_models` 只返回 id，merge step 对 custom provider 不命中 bundled catalog → fallback `capabilities: []`）和 `group`（catalog 不设 group，只有 manualModels 有）。导致：
1. 分组没按内置 provider 的 family-style 分组（custom 的模型 id 杂，`familyGroup(id)` 正则匹配不上 → 每条独立成组）
2. `CapabilityPills` 因 `capabilities` 为空返回 null → 没有能力图标

修法：fetch 成功后，把 24h-cached 的 owner map（`~/.quill/providers/provider-models.json`，含 `{modelId, providerId, capabilities}`）合并进 in-memory `Model[]`——custom provider 模型从 owner map 填 `capabilities` 和 `group`（group = ownerEntry.providerId）。

## What I already know

- Fetch 路径：`ModelServicesSettings.tsx:314` → `modelRegistryStore.ts:fetchModelsForProvider` → `fetchModelsRaw` (Tauri `list_models`) → `merge.ts:19-36` 与 bundled catalog 合并
- Rust `list_models.rs` 返回 `ModelDto { id }`——不填 capabilities/group
- merge step `merge.ts:32` fallback：`{ id, providerId, capabilities: [], inputModalities: ['text'] }`
- catalog match 仅对 bundled provider 有效（keyed by bundled providerId）；custom provider catalog match 全空 → 全走 fallback
- Owner map cache（上一轮 commit `df7e095`）：`fetchOwnerMap()` 返回 `Record<string, OwnerEntry>`，`OwnerEntry = {modelId, providerId, capabilities: Capability[]}`，24h 磁盘缓存
- 当前 owner map 只用于写 `models.json` 文件时注入 `owner` 字段——in-memory 不消费
- 渲染：`ProviderDetailSection.tsx:283-285` group 用 `m?.group ?? familyGroup(mid)`；`CapabilityPills`（`helpers.tsx:80`）按 `m.capabilities` 渲染，空返回 null

## Requirements

1. `modelRegistryStore.ts:fetchModelsForProvider` 成功路径：把 `fetchOwnerMap()` 调用从 fire-and-forget IIFE 提到 `set()` 之前（24h cached，cheap）
2. 在 `set()` 之前 enrich `result.models`（**仅当 `customProvider === true`**）：
   - `capabilities: m.capabilities.length ? m.capabilities : (entry?.capabilities ?? [])`
   - `group: m.group ?? entry?.providerId`
3. `set({ modelsByProvider: ... enriched })` 使用 enriched 数组（UI 立刻看到 capabilities + group）
4. 文件写仍 fire-and-forget，使用 enriched 数组 + 注入 `owner` 字段（不退回上一轮的 owner-in-file 行为）
5. **不动 `Model` 类型契约**（不在 TS interface 加 `owner`；owner 仍是 file-only 字段，运行时对象上加）
6. bundled provider 不受影响——不 enrich（catalog 已经给了 capabilities）

## Acceptance Criteria

- [ ] Custom provider 拉取后，`modelsByProvider[customPid]` 的 model 在 owner map 命中时含 capabilities + group
- [ ] Custom provider 设置页 Selected models list 按 ownerEntry.providerId 分组（如 "openai"/"anthropic"），不再每条独立成组
- [ ] CapabilityPills 渲染能力图标（owner map 命中的 custom-provider 模型）
- [ ] Owner map 未命中的 custom-provider 模型：capabilities 仍为 `[]`、group 走 `familyGroup(id)` fallback（不回归）
- [ ] Bundled provider 拉取行为不变（不 enrich）
- [ ] `~/.quill/providers/{pid}/models.json` 仍含 `owner` 字段（不退回）
- [ ] `pnpm typecheck` 全绿
- [ ] `pnpm test` 相关测试通过（新增 store 测试覆盖 custom enrichment 分支）

## Out of Scope

- 给 `Model` 类型加 `owner?` 字段（保持 file-only）
- Bundled provider 也 enrich（catalog 已是权威来源，不动）
- UI 改动（沿用现有 CapabilityPills + familyGroup 渲染逻辑）
- Rust `list_models` 改动（仍只返回 id，enrich 在前端做）

## Technical Notes

- Enrich 位置：`apps/desktop/src/store/modelRegistryStore.ts:fetchModelsForProvider` 成功路径
- Owner map 来源：`services/modelRegistry/fetchOwnerMap.ts:fetchOwnerMap()`（24h cached）
- 渲染：`apps/desktop/src/components/settings/model-services/ProviderDetailSection.tsx:283-285` + `helpers.tsx:80`
- Merge fallback：`apps/desktop/src/services/modelRegistry/merge.ts:32`
- Rust 返回 shape：`apps/desktop/src-tauri/src/list_models.rs:31-34`（`ModelDto { id }`）
