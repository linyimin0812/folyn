# extract pet host bridge from App

## Goal

把 `App.tsx` 里焊死的 pet 事件总线（`pet://menu-action` 路由 / `pet://bubble-action` 跳转路由 /
`pet://visibility-changed` 同步 + 启动恢复 / pet 图标 orphan sweep）抽进一个 hook/service，
App 只调一次。pet 是可选功能，其 Tauri 事件总线 plumbing 不该无条件焊在根组件里。
纯重构，行为零变化。

## What I already know

### App.tsx pet 焊接（4 块，约 :167-397）
1. **pet 图标 orphan sweep + fallback**（`:167-233`）——主窗口清理 pet-icon 文件，isTauri 守卫。
2. **`pet://menu-action` 路由**（`:257-340`）——switch：hide-pet/disable-pet/set-pet-size
   （invoke set_pet_size + emit pet://size-changed）/open-pet-panel/open-settings 等，调 navStore/petStore/invoke/emit。
3. **`pet://bubble-action` 跳转路由**（`:345-365`）——bubble 导航跳到 editor tab / pet-panel chat session + invoke pet_panel_show。
4. **`pet://visibility-changed` 同步 + 启动恢复**（`:381-397`）——pet mode 启动恢复 + 可见性菜单同步。

### 已抽离的
- `services/petNotifyDispatcher.ts`（172 行）已处理 `pet://notify` → bubble/system/both +
  通知点击监听器。App.tsx 只调 `dispatchNotification`/`startNotificationClickListener`。
- 所以本任务只抽剩下 4 块；`pet://notify` 已在 service。

### 不抽的（out of scope）
- `hide_all_webviews` on page change（`:241-243`）——webview 生命周期，非 pet:// 事件总线。
- MutationObserver（`:77`）——禁用输入自动大写，非 pet 相关（审计描述有误）。
- `petNotifyDispatcher.ts` 本身不动（已内聚）。

### 消费者
- App.tsx 是唯一持有这些 pet:// listen 的地方。抽进 hook 后 App 调一次。
- pet 组件（PetApp/PetMascot 等）在 pet 窗口内，不共享主窗口 App 的事件总线（窗口隔离）。

## Assumptions (temporary, to validate)

- 纯重构，行为零变化：所有 pet:// 事件路由、invoke、emit、启动恢复、图标清理行为不变。
- 抽取形状：hook vs service-module——见 Open Question。
- petNotifyDispatcher 不合并（已内聚，避免 churn）。

## Open Questions

- （已收敛）抽取形状：Approach A（usePetHostBridge hook）。

## Requirements

- 新建 `apps/desktop/src/hooks/usePetHostBridge.ts`：一个 hook，useEffect 里装配：
  - `listen('pet://menu-action')` → 调 `routePetMenuAction(action,size)` helper。
  - `listen('pet://bubble-action')` → 调 `routePetBubbleAction(target)` helper。
  - `listen('pet://visibility-changed')` → 同步 pet mode 状态。
  - 启动恢复（pet mode launch restore，调 invoke('toggle_pet_mode') 条件）。
  - pet 图标 orphan sweep + fallback（isTauri 守卫）。
  - 调 `petNotifyDispatcher`（dispatchNotification + startNotificationClickListener）。
  - 所有 listen 返回 unlisten，effect cleanup 全部 disconnect。
- 新建纯函数 helper（路由逻辑，可单测，不依赖 React）：
  - `routePetMenuAction(action, size?)`：hide-pet/disable-pet/set-pet-size（invoke set_pet_size + emit pet://size-changed）/open-pet-panel/open-settings 等 switch。逻辑逐字搬自 App.tsx :257-340。
  - `routePetBubbleAction(target)`：bubble 导航跳转 editor tab / pet-panel chat session + invoke pet_panel_show。逐字搬自 :345-365。
  - helper 用 store getState + invoke + emit（非 React）。
- App.tsx：删上述 4 块内联 pet 焊接，改成 `usePetHostBridge();` 一行。
- petNotifyDispatcher.ts 不动。

## Acceptance Criteria

- [ ] App.tsx 不再直接 `listen('pet://menu-action'|'pet://bubble-action'|'pet://visibility-changed')`、
      不再内联 menu-action switch / bubble-action 路由 / 启动恢复 / 图标 sweep（grep 0 命中）。
- [ ] `usePetHostBridge` hook 存在 + 所有 unlisten 在 effect cleanup disconnect。
- [ ] `routePetMenuAction` / `routePetBubbleAction` 纯函数 helper 存在 + sibling test 覆盖主要分支。
- [ ] 行为零回归：menu-action 各 case、bubble-action 跳转、visibility 同步、启动恢复、图标 sweep 行为不变。
- [ ] lint / typecheck / build / test 绿（除 master 既有失败）。

## Definition of Done

- hook + helper sibling test（路由分支 + cleanup）。
- 行为零回归。
- lint / typecheck / build / test 绿。

## Out of Scope (explicit)

- `hide_all_webviews` on page change（webview 生命周期，非 pet:// 事件总线）。
- MutationObserver（禁用输入自动大写，非 pet 相关）。
- petNotifyDispatcher.ts 本身（已内聚）。
- pet 窗口内组件（PetApp 等，窗口隔离）。
- 不改 pet 行为语义。

## Decision (ADR-lite)

**Context**: App.tsx 把可选功能 pet 的 Tauri 事件总线（4 个 pet:// listen + 路由 + 启动恢复 +
图标 sweep）无条件焊在根组件，根组件无法脱离 pet 理解/测试。

**Decision**: Approach A——`usePetHostBridge()` hook 装配所有 pet:// listen + 启动恢复 +
图标 sweep + 调 petNotifyDispatcher；路由逻辑（menu-action switch / bubble-action 跳转）拆成
纯函数 helper（`routePetMenuAction`/`routePetBubbleAction`）便于单测。App.tsx 一行调用。
petNotifyDispatcher 不合并（已内聚，避免 churn）。

**Consequences**: hook 内 listen 生命周期贴 useEffect cleanup；路由 helper 纯函数可单测；
App 根组件脱离 pet 耦合。B 方案（service init）风格虽与 petNotifyDispatcher 一致，但 4 listen +
switch 路由用 hook 更顺。

## Technical Approach

### 迁移策略：2 PR
- PR1：建 `usePetHostBridge` hook + `routePetMenuAction`/`routePetBubbleAction` helper +
  sibling test（路由分支 + cleanup）。App.tsx 不改（hook dormant）。
- PR2：App.tsx 调 `usePetHostBridge()` + 删 4 块内联 pet 焊接。行为关键 PR——验证所有
  pet:// 事件流零回归。

## Research Notes

### 可行方案（抽取形状）

**Approach A — `usePetHostBridge()` hook（推荐待定）**
一个 hook，在 useEffect 里装配所有 pet:// listen（menu-action/bubble-action/visibility）+
启动恢复 + 图标 sweep + 调 petNotifyDispatcher（notify + click listener）。App.tsx：`usePetHostBridge();` 一行。
- Pros: React 生命周期 idiomatic（listen/unlisten/cleanup 在 effect 里）；App 一行；集中 pet plumbing。
- Cons: hook 内部逻辑重（4 个 listen + switch 路由），需拆 helper；hook 里调 store getState + invoke。

**Approach B — `petHostBridge.ts` service + init 函数**
service 模块导出 `initPetHostBridge(): () => void`（返回 cleanup），App 在 useEffect 调一次。
延续 petNotifyDispatcher 的 service 模块风格。
- Pros: 与现有 petNotifyDispatcher 风格一致；service 函数易单测；不依赖 hook 语法。
- Cons: service 里用 listen 要 async init + 返回 unlisten，effect 串联稍绕；不如 hook 直观。

两方案行为等价，差别在风格（hook vs service）。

## Technical Notes

- 文件：`apps/desktop/src/App.tsx`（pet 焊接 :167-397）。
- 已抽：`apps/desktop/src/services/petNotifyDispatcher.ts`。
- spec：component-guidelines、hook-guidelines、tauri-window-patterns、quality-guidelines、directory-structure。
- pet 窗口隔离：petNotifyDispatcher.ts 注释提过副窗口不 import 主窗口 dispatcher。
