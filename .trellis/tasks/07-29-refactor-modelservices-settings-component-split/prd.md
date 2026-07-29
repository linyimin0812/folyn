# refactor: ModelServicesSettings 组件拆分

## Goal

`apps/desktop/src/components/settings/ModelServicesSettings.tsx` 已 1594 行,成为 settings 目录最大文件(次大 656 行,相邻文件多在 100–500 行)。将其按既有的自然边界拆分为多个小子文件,降低单文件认知负担,便于后续改动定位。**纯结构调整,不改行为**。

## Requirements

- 新建 `apps/desktop/src/components/settings/model-services/` 子目录(决策 1)。
- 拆分后文件布局:

```
apps/desktop/src/components/settings/
├─ ModelServicesSettings.tsx              # 主组件,目标 ~250 行(state + 组合)
├─ model-services/
│  ├─ helpers.tsx                          # familyGroup / avatarColor / ModelAvatar / CapabilityPills / Avatar / modelOptionTitle / CAPABILITY_PILL / EMPTY_*
│  ├─ ProviderListAside.tsx                # 左侧: 搜索 + provider list + add-custom
│  ├─ ProviderDetailSection.tsx            # 右侧: header + API key + base URL + Azure + model list + info links + set-as-chat
│  ├─ CustomProviderDrawer.tsx             # 编辑/新增 custom provider 弹窗
│  ├─ ModelPickerModal.tsx                 # 模型选择器
│  ├─ AddManualModelModal.tsx              # 手动添加 model
│  ├─ TestChatModal.tsx                    # 从主组件内联的 test modal 抽出(L803–877)
│  ├─ DeleteProviderConfirmDialog.tsx      # 从主组件内联的 delete confirm 抽出(L920–941)
│  └─ RefetchOverlay.tsx                   # 从主组件内联的 refetch overlay 抽出(L943–964)
```

- 共享 helpers(`familyGroup` / `avatarColor` / `ModelAvatar` / `CapabilityPills` / `Avatar` / `modelOptionTitle` / `CAPABILITY_PILL` / `EMPTY_*`)集中到 `model-services/helpers.tsx`,避免循环依赖。
- 主组件保持导出名 `ModelServicesSettings` 不变。
- 视觉与交互零回归。
- `ponytail:` 标记纯迁移(决策 2):跟着代码走,不补升级触发条件、不改语义。补 trigger 属于另一个 task。

## Acceptance Criteria

- [ ] `ModelServicesSettings.tsx` 主文件 < 800 行(目标 ~250 行)
- [ ] `model-services/` 子目录下 9 个文件各单一职责,无循环依赖
- [ ] 主组件导出名 `ModelServicesSettings` 不变
- [ ] `tsc` / lint / 既有 build 通过
- [ ] 手动验证 golden path + edge cases 行为一致:
  - provider 切换
  - 新增 / 编辑 / 删除 custom provider
  - API key 输入 + show/hide + test
  - base URL 输入 + reset + preview
  - Azure fields(API version / deployment id)
  - fetch models / refetch-all / refetch overlay 显隐
  - model picker(搜索 / category tab / 选中 / 取消 / 折叠分组)
  - manual model 增删 + 折叠分组
  - set-as-chat
  - delete confirm dialog
  - ESC 关闭弹窗(picker)

## Definition of Done

- 类型检查 / lint / build 绿
- 视觉与交互零回归(已手动验证 golden path + edge cases)
- `ponytail:` 标记按归属迁移到拆分后的文件,不丢
- 主文件行数显著下降

## Technical Approach

**策略**: 自底向上、最小 diff 串行,每步后跑 `tsc` / lint + 手动验证。

**PR1 — 零风险奠基**:
- 建 `model-services/helpers.tsx`,迁入 `familyGroup` / `avatarColor` / `ModelAvatar` / `CAPABILITY_PILL` / `CapabilityPills` / `Avatar` / `modelOptionTitle` / `EMPTY_MODELS` / `EMPTY_MANUAL` / `EMPTY_SELECTED`。
- 主文件改 import,无 JSX 改动。

**PR2 — 独立弹窗迁移**:
- 抽 `CustomProviderDrawer`(L971–1198)→ `model-services/CustomProviderDrawer.tsx`
- 抽 `ModelPickerModal`(L1200–1496)→ `model-services/ModelPickerModal.tsx`
- 抽 `AddManualModelModal`(L1498–1594)→ `model-services/AddManualModelModal.tsx`
- 这 3 个本就是独立组件,纯挪动 + 改 import。

**PR3 — 内联弹窗抽离**:
- 抽 `TestChatModal`(主组件 L803–877 的 test modal JSX),状态(`chatTestStatus` / `testModelId` / `testModalOpen`)保留主组件,props 下传。
- 抽 `DeleteProviderConfirmDialog`(L920–941),`pendingDeleteProvider` / `setDeleteConfirmId` 通过 props 下传。
- 抽 `RefetchOverlay`(L943–964),`refetchStatus` 通过 props 下传。

**PR4 — 大件抽离**:
- 抽 `ProviderListAside`(L289–386):`search` / `setSearch` / `filtered` / `chatProvider` / `setChatProvider` / `providerSettings` / `refetchStatus` / `setRefetchStatus` / `setDrawer` / `setDeleteConfirmId` 等通过 props 下传。
- 抽 `ProviderDetailSection`(L388–778):接口最大(~20 个 store 选择器 + 派生值 + setters)。考虑用 children prop 或 render-prop 模式避免 prop 爆炸,但优先直接 props,保持简单。

## Decision (ADR-lite)

**Context**: 文件 1594 行,需选择拆分粒度 + helper 文件归属 + `ponytail:` 标记处理方式。
**Decision**:
- 粒度 B(中等,6–8 个文件,主文件目标 ~250 行)。
- 新建 `model-services/` 子目录(决策 1):这些 helpers 是 model-services 专用,塞进通用 `primitives.tsx` 会污染。
- `ponytail:` 标记纯迁移(决策 2):补 trigger 属于另一个 task,本 task 保持零行为变化。
**Consequences**:
- 优点: 主文件可读、单职责、后续改动定位快。
- 风险: PR4 的 `ProviderDetailSection` prop 接口较大,需仔细设计;若 prop 爆炸可考虑 children/render-prop,但优先简单。
- 留白: 未进一步拆 `ApiKeyField` / `BaseUrlField` 等,保留未来演进空间,不预先抽象。

## Out of Scope

- 不改业务逻辑、store、API、翻译
- 不引入新依赖
- 不引入虚拟化(列表 20–30 项,仍无需)
- 不重写 `ponytail:` 标记的简化项(只迁移,不改其语义)
- 不补 `ponytail:` 标记的升级触发条件
- 不拆 `ApiKeyField` / `BaseUrlField` / `AzureFields` / `ModelList`(C 档,留待未来)
- 不新增单元测试(纯结构重构,依赖手动验证)

## Technical Notes

- 文件:`apps/desktop/src/components/settings/ModelServicesSettings.tsx`(1594 行)
- 共享原语:`apps/desktop/src/components/settings/primitives.tsx`(已有 `Toggle`)
- store:`@/store/aiConfigStore`, `@/store/modelRegistryStore`
- catalog:`@/services/providers/catalog`, `@/services/providers/providersCatalog`, `@/services/providers/icon`
- 类型:`@/services/modelRegistry/types`(`Capability`, `Model`)
- 主组件内 `ponytail:` 标记 11 处,纯迁移到对应拆分后文件。
