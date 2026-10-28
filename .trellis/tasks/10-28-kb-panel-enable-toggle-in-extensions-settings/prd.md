# 知识库面板启用开关（扩展设置页）

## Goal

知识库面板目前恒注册恒可见。按 Translation/Activity/Sessions 的既有模式，在扩展设置页（ExtensionsSettings）加开关控制是否启用知识库面板。

## Requirements

* `appearanceStore`：新增 `enableKnowledgePanel`（默认 true）+ setter + `settings:all` 持久化与水合 patch（照 `enableSessionsPanel` 全套）。
* `extensionStore.ts` 的 BUILTIN 行：新增 `builtin:knowledge`（nameKey/descKey 用 `settings:appearance.panels.knowledge.*`，i18n zh/en 补 key，其他 locale 参照既有 builtin 行的覆盖方式）。
* `registerBuiltinPanels.tsx`：knowledge 面板注册时 `visible: enableKnowledgePanel`，并加 flag → `setVisible('knowledge', …)` 订阅镜像（照 sessions 的写法）；面板被禁用时若它是当前 activePanel，走既有「重路由到 files」逻辑（确认覆盖，不另造）。
* `ExtensionsSettings.tsx`：builtin:knowledge 行的开关绑定 `enableKnowledgePanel`（hook 无条件订阅 + isActive 映射，照现有三个）。
* `PetPanelSearchResults.tsx`：如有按 flag 过滤 builtin 行的逻辑，把 knowledge 纳入同规则。
* 禁用后：ActivityBar 不显示入口、⌘P gotoPanel 不出现；重新开启即恢复（数据不受影响）。

## Acceptance Criteria

* [ ] 扩展设置页出现「知识库」行与开关；关闭后侧栏/活动栏无知识库入口，重启后状态保持（持久化）。
* [ ] 禁用当时知识库若是活动面板 → 自动切回 files，不出现空白。
* [ ] 相关测试（appearanceStore/extensionStore/registerBuiltinPanels/ExtensionsSettings 如有）适配后全绿，新增开关行为用例。

## Out of Scope

* 知识库数据/功能的任何变化（只是入口开关）。
* 其他面板的开关行为改动。

## Technical Notes

* 模式先例：`appearanceStore.ts:61-63/175-177/194-196`（flag/setter/persist）、`extensionStore.ts:172-173`（BUILTIN 行）、`registerBuiltinPanels.tsx:88-140`（visible 初值 + sessions 的 flag 镜像订阅）、`ExtensionsSettings.tsx:174-199`（开关绑定）。
