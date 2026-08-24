# PRD: Provider 设置页已选模型初始加载缺失能力图标

## 问题

打开 provider 设置页时，已选 models 列表不显示能力图标（vision / reasoning / web-search / function-call）。点击「获取模型」打开 picker（触发 `fetchModelsForProvider`）后图标才显示。

## 根因

`apps/desktop/src/components/settings/ModelServicesSettings.tsx:105-120` 的 `modelsForCurrent` useMemo：

- `manualForCurrent` 分支会用 `ownerMap` 补 `capabilities`（line 108-118）
- 但 `fetchedModels` 分支（line 106 `return fetchedModels`）原样返回，**没有**应用 ownerMap enrichment

持久化的 `modelsByProvider[providerId]` 在以下情况 `capabilities` 为空：
1. commit `52b7865` 之前持久化的旧数据（enrichment 只对 custom providers 生效）
2. fetch 时 ownerMap 尚未加载完成（`modelRegistryStore.ts:124-131` fallback 为 `{}`）

`fetchModelsForProvider` 的写路径（`modelRegistryStore.ts:133-145`）会对所有 provider 做 enrichment 并写回 `modelsByProvider`，所以重新 fetch 后图标出现。**hydrate/读路径缺少同样的 enrichment**。

`ownerMap` 不在 `PERSIST_KEYS_MODEL_REGISTRY`（line 69-72），每次 mount 异步 `loadOwnerMap()` 加载。

## 修复

在 `modelsForCurrent` useMemo 中，对 `fetchedModels` 也应用 ownerMap enrichment —— 镜像 manual 分支的逻辑：仅当 `m.capabilities` 为空时用 `ownerMap[ownerLookupKey(m.id)]?.capabilities` 填充。

```ts
const modelsForCurrent = useMemo(() => {
  const enrichFetched = fetchedModels.map((m) => {
    if (m.capabilities.length) return m;
    const entry = ownerMap[ownerLookupKey(m.id)];
    return entry ? { ...m, capabilities: entry.capabilities ?? [] } : m;
  });
  if (manualForCurrent.length === 0) return enrichFetched;
  const existingIds = new Set(enrichFetched.map((m) => m.id));
  const manual: Model[] = manualForCurrent.map((m) => { /* unchanged */ });
  return [...enrichFetched, ...manual.filter((m) => !existingIds.has(m.id))];
}, [fetchedModels, manualForCurrent, chatProvider, ownerMap]);
```

**为什么选这个方案**：
- 最小改动，在已有 useMemo 里加一层 enrichment，复用已加载的 `ownerMap`
- `ownerMap` 异步加载，加载完成后 useMemo 重新计算，图标自动出现
- 与写路径 enrichment 逻辑一致，不引入新依赖
- 不需要持久化迁移：纯 render 时 enrichment，下次 fetch 会覆盖持久化数据

**替代方案（不选）**：在 `hydrate` 时跑一次迁移重新 enrich `modelsByProvider`。需要 await `loadOwnerMap`，hydrate 签名要改，且 ownerMap 失败时 fallback 行为更复杂。render 方案更简单。

## 扩展：fetch 时把 capabilities 反写到 ownerMap 缓存

**问题**：ownerMap 仅来自 OpenRouter 的 `/models`，覆盖不全（如 `claude-opus-4-7` / `glm-5.2` 老版本或非 OpenRouter 列出的模型查不到）。用户 fetch 自定义 provider 时，catalog（models.dev）提供的 capabilities 没回流到 ownerMap，下次别的 provider 用到同 id 仍然查不到。

**修复**：在 `fetchModelsForProvider` 的写路径，enrichment 完成后，把 enriched 中 capabilities 非空的条目合并写入 `~/.folyn/providers/provider-models.json`（ownerMap 缓存）+ 更新 store 的 in-memory ownerMap。

**去重规则**（用户要求 "注意去重"）：
- 同一 `ownerLookupKey(id)` 已存在且 capabilities 非空 → **跳过**（保留 OpenRouter 原始数据）
- 已存在但 capabilities 为空 → 用新数据填充
- 不存在 → 新增

**实现位置**：
1. `fetchOwnerMap.ts` 导出 `mergeCapabilitiesIntoOwnerMap(entries)`：读缓存 → 按 key 合并 → 写回 → 返回合并后的 map
2. `modelRegistryStore.fetchModelsForProvider` 在 `writeUserProviderModels` 之后调用，传入 `enriched.filter(m => m.capabilities.length).map(...)`，更新 store `ownerMap`

**验收**：
- fetch 一个 catalog 有 caps 但 ownerMap 没有的模型 → 重启后 ownerMap 有该 entry
- 同 id 在 ownerMap 已有 caps → 不被覆盖（OpenRouter 数据保真）
- store `ownerMap` 在 fetch 完成后立即更新（不必重启即可让 orphan 分支拿到 caps）

## 验收

1. 打开一个已选 models 但未 fetch 过的 provider 设置页 → 已选列表立即显示能力图标（ownerMap 加载完成后）
2. 关闭/重开设置页 → 图标仍然显示
3. 点击「获取模型」→ 图标数量与之前一致（fetch 不会减少图标）
4. 无 ownerMap 数据的模型 → 仍不显示图标（与现状一致，非本次回归）
