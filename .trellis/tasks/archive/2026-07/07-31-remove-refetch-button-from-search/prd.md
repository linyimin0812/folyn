# remove-sync-button-from-model-services-search

## Goal

Model Services 设置页左栏搜索框右侧的「同步」按钮（`ListRestart` icon，title=`refetchModelsDev`，触发 `onRefetchAll` 重新拉取 models.dev providers 元数据）需要移除。用户不再需要从搜索框触发该操作。

## Requirements

1. 删除 `ProviderListAside.tsx:57-65` 搜索输入框内的 `ListRestart` 按钮。
2. 清理随之变成 dead code 的 props：`onRefetchAll`、`refetchStatus`。检查父组件 `ModelServicesSettings.tsx` 对应的 prop 传递和本地 state（`refetchStatus`、`setRefetchStatus`）以及触发 refetch 的逻辑——一并删除。
3. 检查 `RefetchOverlay` 组件是否还被其他位置使用；若否，删组件 + props 传递。
4. `ListRestart` import 若不再用则删。
5. i18n key `settings:models.refetchModelsDev` 可留可删——留着无害（ponytail: 删 i18n key 需要扫所有 locale 文件，diff 大且收益小，留着）。

## Acceptance Criteria

- [ ] 搜索框不再显示同步按钮
- [ ] `pnpm typecheck` 全绿（无 dead props / dead import 报错）
- [ ] `pnpm test` 通过
- [ ] 左栏其他功能（搜索过滤、provider 选中、edit/delete custom、add custom）不受影响

## Out of Scope

- 同步/重拉 models.dev 元数据的其他入口（若存在菜单/命令路径触发 refetch，不动）
- i18n key 清理

## Technical Notes

- 按钮位置：`apps/desktop/src/components/settings/model-services/ProviderListAside.tsx:57-65`
- 父组件：`apps/desktop/src/components/settings/ModelServicesSettings.tsx`（搜 `refetchStatus` / `onRefetchAll` / `RefetchOverlay`）
- `RefetchOverlay` 组件：`apps/desktop/src/components/settings/model-services/RefetchOverlay.tsx`
