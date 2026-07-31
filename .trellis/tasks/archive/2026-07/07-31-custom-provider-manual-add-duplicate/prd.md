# custom-provider-manual-add-duplicate

## Goal

Custom provider 设置页手动添加模型后，模型列表显示两行相同的条目。根因：b916f25 让 `AddManualModelModal.onSave` 同时写 `manualModels`（存 displayName/group 元数据）和 `selectedModelIds`（让 TestChatModal 下拉框能看到手动模型），但 `ProviderDetailSection.tsx` 渲染了两个独立列表——Selected models list（遍历 `selectedModelIds`）和 Manual-added models list（遍历 `manualForCurrent`）——手动模型两个都进。

## Requirements

1. 去掉 Manual-added models list 冗余渲染段（`ProviderDetailSection.tsx:368-452`）。Selected models list 已通过 `modelsForCurrent`（行 98-110，从 `manualForCurrent` 合成 Model 条目含 displayName/group）正确显示手动模型。
2. `AddManualModelModal.onSave` 双写不动（`manualModels` 存元数据 + `selectedModelIds` 喂 TestChatModal）——两者职责不同，保留。
3. `onRemoveManualModel` 仍保留用于清理 manual 元数据；但移除 Manual list 后调用点消失——检查是否需要同步删 store action。优先删调用点，store action 留着无害（YAGNI 反向：留 dead code 不如删）。
4. `modelsForCurrent` 合成逻辑不动。

## Acceptance Criteria

- [ ] 手动添加一个模型 → 设置页只显示一行
- [ ] 手动模型的 displayName/group 在 Selected models list 中正确展示（通过 `modelsForCurrent` 合成）
- [ ] TestChatModal 下拉框仍能看到手动模型（`selectedModelIds` 不变）
- [ ] 移除手动模型（Selected list 上的 remove 按钮 → `onRemoveSelectedModel`）后不再显示；同时 `manualModels` 中的元数据保留还是清理（看现有 remove 链路）
- [ ] `pnpm typecheck` 全绿
- [ ] `pnpm test` 相关测试通过

## Out of Scope

- 把 `manualModels` 和 `selectedModelIds` 合并成单一来源（b916f25 已选 selectedModelIds 作为 picker 统一来源，但 manual 元数据仍需独立存储——重构成本超出 bug 修复范围）
- 迁移历史数据（既有 manualModels 条目继续工作，因为 modelsForCurrent 合成路径不变）

## Technical Notes

- 根因 commit: b916f25
- 双写位置: `apps/desktop/src/components/settings/ModelServicesSettings.tsx:347-351`
- 冗余渲染段: `apps/desktop/src/components/settings/model-services/ProviderDetailSection.tsx:368-452`
- `modelsForCurrent` 合成: `apps/desktop/src/components/settings/ModelServicesSettings.tsx:98-110`
- `addManualModel` store action: `apps/desktop/src/store/aiConfigStore.ts:561-571`
- `addSelectedModelId` store action: `apps/desktop/src/store/aiConfigStore.ts:585-596`
