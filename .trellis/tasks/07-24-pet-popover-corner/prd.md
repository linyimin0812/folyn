# Pet notification: popover card + corner toast

## Status (2026-07-24)

**Part 1 done, Part 2 deferred.** Committed incrementally because the two
parts are independent: Part 1 is a complete, type-check-passing,
test-covered refactor of the existing bubble + notification routing. Part 2
(corner toast) is a new component and can be built against the stable
contract Part 1 leaves behind (the `pet://corner-show` event is already
emitted by the dispatcher; the corner toast just needs to listen for it).

- **Done (this commit):** Popover card 12-placement refactor, `NotificationForm`
  `'system'` → `'corner'` routing change, OS native notification path
  removal, settings UI, i18n, all related tests.
- **Deferred (follow-up):** `pet-corner` NSPanel window + `PetCornerApp.tsx`
  + Rust `pet_corner_*` commands + CSS + `main.tsx` route. The
  `pet://corner-show` event is emitted but has no listener until Part 2
  lands — `notificationForm = 'corner'` will silently drop notifications
  until then. `@tauri-apps/plugin-notification` dependency removal is also
  deferred to Part 2 (so Part 1's diff stays focused on the routing
  rewrite, not the package.json churn).

## Goal

重构桌宠通知弹窗，把现有的"上下翻转"bubble 升级为支持 12 方向 placement 的 Popover 卡片；同时新增独立的 corner toast 组件，固定在屏幕某一角堆叠显示被动提醒，取代 OS native notification。

## Background

现有通知体系（`pet://notify` → `petNotifyDispatcher` → `notificationForm` 路由）有三条出口：

- `bubble` → `pet://bubble-show` → `pet-bubble` NSPanel 窗口（`PetBubbleApp.tsx`）。位置由 `computeBubblePosition` 计算：上方优先，空间不足翻到下方，X 轴 clamp 进 work area。
- `system` → `osNotify()` → `@tauri-apps/plugin-notification` OS 原生通知（含 `查看详情` action + id→target 路由）。
- `both` / `off`。

bubble 已支持 template 系统（`bubbleTemplate.ts`）、kind accent（info/reminder/message/event）、≤2 action 按钮、launch 跳转、target 路由。TTL 6s（authorize 12s）。

痛点：

1. bubble 的 placement 只有"上 / 下"二态，触发源无法控制 bubble 出现在 pet 的左/右/角位置。
2. OS native notification 和桌宠角色重叠——桌宠本身就该是"活泼通知层"，OS 通知中心把视线拉离桌宠，体验割裂；且依赖 OS plugin + 权限请求，多一套生命周期。
3. 缺少"被动堆叠提醒"层——bubble 是短时强提示（6s 消失），OS native 不可控，没有中间态。

## What I'm building

### 1. Popover 卡片（重构现有 `pet-bubble`）

复用现有 `pet-bubble` NSPanel 窗口、template 系统、kind/TTL/actions/launch/target 体系。新增 12 方向 placement：

- `top` / `topLeft` / `topRight`
- `bottom` / `bottomLeft` / `bottomRight`
- `left` / `leftTop` / `leftBottom`
- `right` / `rightTop` / `rightBottom`

**Placement 语义**（antd Tooltip 同构）：

- 单方向（`top`/`bottom`/`left`/`right`）：bubble 在该轴上居中对齐 pet，垂直/水平方向贴 pet 边。
- 角方向（`topLeft` 等）：bubble 在该轴对齐 pet 的对应角。

**Flip 规则**（insufficient 轴翻转，另一轴保持）：

- `top ↔ bottom`
- `topLeft ↔ bottomLeft`、`topRight ↔ bottomRight`
- `left ↔ right`
- `leftTop ↔ rightTop`、`leftBottom ↔ rightBottom`

"insufficient" 判定：bubble 按该 placement 摆放后，其包围盒超出 work area（`NSScreen.visibleFrame`，已扣 Dock + menu bar）即翻。

**Auto-shift 规则**（仅单方向 placement，`top`/`bottom`/`left`/`right`）：

- `top`/`bottom`：bubble X 轴 clamp 进 work area（`top` 现有行为保留，扩展到 `bottom`）。
- `left`/`right`：bubble Y 轴 clamp 进 work area（新）。

角方向 placement 不做 auto-shift——若超界则按 flip 规则翻到对角。

**配置**：

- `PetBubblePayload.placement?: Placement`（per-notification 覆盖）
- `petStore.bubblePlacement: Placement`（全局默认，设置 UI 可选，默认 `top`）

选 placement 顺序同 template 模式：`payload.placement` → `petStore.bubblePlacement` → `'top'`。

### 2. Corner toast（新增 `pet-corner` NSPanel 窗口）

固定在屏幕某一角的堆叠通知 toast，紧凑写死 UI，不接 template 系统。

**UI 规格**：

- 尺寸 ~320×80（逻辑点），圆角卡片，kind accent 色（复用 bubble 的 4 kind）。
- 内容：title（可点跳转）、text、≤2 action 按钮、✕ 关闭按钮。
- 写死布局，不走 `bubbleTemplate.ts`。

**配置**：

- `petStore.cornerPlacement: 'topLeft' | 'topRight' | 'bottomLeft' | 'bottomRight'`（全局，默认 `bottomRight`）。
- `petStore.cornerTtlMs: number | 'never'`（默认 10000；`'never'` = 不自动消失，必须用户点 ✕ 或 action）。

**堆叠行为**：

- 最多 3 条同时可见。超出时隐藏最旧。
- newest on top：新 toast 入栈堆顶（最靠屏幕角点），旧的下沉。
- 每条独立 TTL；到点自动 dismiss 本条。`'never'` 模式下该条不自动消失。
- 堆叠中某条消失，下方 toast 上移重排。

**交互**：

- 整卡可点 → emit `pet://bubble-action { type: 'navigate', target, source }`（复用 App.tsx 现有 jump router）。
- action 按钮 → emit `pet://bubble-action { type: 'action' | 'launch', actionId, target, source, launch }`。
- ✕ → 本地 dismiss（不 emit）。
- authorize 流程 **不走 corner**——authorize 只在 bubble，保留 12s TTL。

### 3. 路由改动

`notificationForm` 枚举值变更：

- `'bubble'` → emit `pet://bubble-show`
- `'corner'` → emit `pet://corner-show`（**新事件**）
- `'both'` → 两者都 emit
- `'off'` → drop

`'system'` 枚举值移除。

**砍掉 OS native notification 整条路径**：

- 删 `petNotifyDispatcher.ts` 中的 `osNotify`、`startNotificationClickListener`、`targetById` Map、`actionTypesRegistered`、`PET_NOTIFY_ACTION_TYPE_ID`/`PET_NOTIFY_VIEW_ACTION_ID`。
- 删 `@tauri-apps/plugin-notification` 依赖（`apps/desktop/package.json`）。
- App.tsx 不再调用 `startNotificationClickListener`。
- 设置 UI `NotificationsSettings.tsx` 把 `notificationForm` 选项从 `bubble/system/both/off` 改为 `bubble/corner/both/off`。

## Decision Log

### D1: 砍 OS native notification，由 corner toast 取代

**决策**：移除 `@tauri-apps/plugin-notification` 整条路径，新增 in-app corner toast 作为"系统级提醒"层。

**理由**：

- 桌宠本身是 always-on-top 的"活泼通知层"，OS native notification 把视线拉离桌宠，角色重叠、体验割裂。
- OS native 在桌宠场景下冗余——桌宠 always-on-top 默认开，OS native "应用不在前台时仍能提醒"的优势基本不存在。
- corner toast 复用 `pet://bubble-action` 跳转路由，App.tsx 现有 jump router 零改动。
- 少一套 plugin 依赖 + macOS 权限请求流程 + action-type 注册生命周期，代码量净减。

**Trade-off 备选**：保留 `system` + 新增 `corner`（两者并存）——路由矩阵膨胀（bubble/corner/system + 组合），设置 UI 变多选，用户心智负担增。否决。

**Hard to reverse**：删 plugin + 权限流程 + action-type 注册，后续若要恢复 OS native 需重接 plugin、重新申请权限、重写 action 路由。**Surprising without context**：future reader 会问"为什么没 OS 通知"。**Real trade-off**：见上。够格记入 Decision Log。

### D2: Popover 和 corner toast 是两个独立组件，不是同组件两 mode

**决策**：Popover 卡片（锚定 pet、12 placement、富 template）和 corner toast（固定角、堆叠、写死 UI）分开实现，不做成同一组件的两种 mode。

**理由**：placement 算法只对"有锚点"的 popover 有意义；corner 是"无锚点、固定角"，两者 UX 和几何完全不同。硬塞同组件两 mode 会把 placement 逻辑和角落堆叠逻辑耦合，后续每加一个 placement 都要考虑 corner mode 的退化。

### D3: Corner toast 写死 UI，不接 template 系统

**决策**：corner toast 用固定紧凑布局，不接 `bubbleTemplate.ts`。

**理由**：bubble 的 template（如 Cloudia 540×280 胖卡）专为 pet-anchored 富信息卡设计，挤不进 320×80 的 corner toast。corner 是系统级被动提醒，安全和一致性都不该让用户用 HTML 自定义。YAGNI——后续真有需求再抽 `cornerTemplate` 系统，到时已有写死 UI 作 baseline。

### D4: Corner toast 带 ≤2 action 按钮，复用 `pet://bubble-action` 事件

**决策**：corner toast 整卡可点跳转 + 最多 2 action 按钮 + ✕ 关闭，事件复用 `pet://bubble-action`。

**理由**：corner 空间紧但 320×80 仍放得下两个小按钮。"跳转 + 选择"是通知的基本能力，省掉 action 按钮会让 corner 沦为只能跳转的弱提示。复用 `pet://bubble-action` 让 App.tsx jump router 零改动。authorize 这类强交互只在 bubble（保留 12s TTL），corner 永远只承担被动通知 + 跳转。

### D5: Corner TTL 可配（含 `'never'`），最多 3 条堆叠

**决策**：`petStore.cornerTtlMs: number | 'never'`，默认 10000。堆叠上限 3，超出隐藏最旧。

**理由**：bubble 6s 是"主动吸引注意"，corner 是"被动留痕"，TTL 应更长。`'never'` 满足"重要通知常驻直到处理"场景。可配让不同用户按需调（高频通知 → 短 TTL；低频重要 → 长 TTL 或 never）。最多 3 条防止屏幕角被通知淹没。

## Requirements

### Popover 卡片

- [ ] `Placement` 类型定义为 12 个 antd 风格值的 union。
- [ ] `PetBubblePayload` 增加 `placement?: Placement` 字段。
- [ ] `petStore` 增加 `bubblePlacement: Placement`（默认 `'top'`），持久化。
- [ ] `computeBubblePosition` 重构为接收 `placement`，按 flip 规则翻、按 auto-shift 规则 clamp。
- [ ] `PetBubbleApp.tsx` 在 `pet://bubble-show` 监听里读 `payload.placement ?? petStore.bubblePlacement`，传给 `computeBubblePosition`。
- [ ] 现有 bubble 单元测试（`petPosition.test.ts`）扩充 12 placement × flip × shift 用例。
- [ ] `bubbleTemplate.ts` 不改动。

### Corner toast

- [ ] 新 `pet-corner` NSPanel 窗口（`tauri.conf.json` 配置 + Rust `pet_corner_*` invoke 命令，参考 `pet-bubble` 实现）。
- [ ] 新 `PetCornerApp.tsx` 组件，挂载在 `#/pet-corner` 路由。
- [ ] 监听 `pet://corner-show`（`PetCornerPayload`，复用 `PetBubblePayload` 的 title/text/kind/target/actions/launch/source/data，忽略 `template`/`placement`）。
- [ ] 堆叠状态：最多 3 条，newest on top，超出隐藏最旧。
- [ ] TTL：每条独立计时，到点自动从堆叠移除。`'never'` 模式不计时。
- [ ] 交互：整卡可点 + ≤2 action 按钮 + ✕，全部 emit `pet://bubble-action`（同 bubble 的事件）。
- [ ] 窗口位置：根据 `petStore.cornerPlacement` 定位到对应屏幕角；窗口高度按堆叠数动态计算（3 条时高度 = 3 × card + gaps，1 条时 = 1 × card）。
- [ ] `petStore` 增加 `cornerPlacement`（默认 `'bottomRight'`）和 `cornerTtlMs`（默认 10000），持久化。

### 路由改动

- [ ] `petStore.notificationForm` 枚举改为 `'bubble' | 'corner' | 'both' | 'off'`。
- [ ] `petNotifyDispatcher.ts` 重写 `dispatchNotification`：`bubble` → emit `pet://bubble-show`，`corner` → emit `pet://corner-show`，`both` → 两者，`off` → drop。
- [ ] 删 `osNotify`、`startNotificationClickListener`、`targetById`、`actionTypesRegistered`、`PET_NOTIFY_*` 常量、`__resetForTesting` 中的 actionTypesRegistered 重置。
- [ ] `decideNotification` 改为返回 `{ bubble: boolean; corner: boolean }`。
- [ ] App.tsx 移除 `startNotificationClickListener()` 调用。
- [ ] `apps/desktop/package.json` 移除 `@tauri-apps/plugin-notification` 依赖。
- [ ] `NotificationsSettings.tsx` UI 改为 `bubble/corner/both/off` 四选一。
- [ ] `petNotifyDispatcher.test.ts` 重写 `decideNotification` 用例 + `dispatchNotification` 用例（emit `pet://corner-show`）。

## Acceptance Criteria

- [ ] bubble 携带 `placement: 'left'` 时，bubble 出现在 pet 左侧、垂直居中；pet 在屏幕底部时 Y 轴 auto-shift 上移。
- [ ] bubble 携带 `placement: 'topLeft'` 且 pet 在屏幕顶部（上方空间不足）时，bubble 翻到 `bottomLeft`。
- [ ] 无 `payload.placement` 时，bubble 用 `petStore.bubblePlacement`（默认 `top`）。
- [ ] `notificationForm = 'corner'` 时，触发 `pet://notify` → `pet://corner-show` → corner toast 出现在 `petStore.cornerPlacement` 指定角。
- [ ] 连续触发 5 次 `pet://notify`（`notificationForm = 'corner'`）→ corner 堆叠只显示最新 3 条，最旧 2 条被隐藏。
- [ ] `cornerTtlMs = 10000`，10s 后该 toast 自动从堆叠消失，下方上移重排。
- [ ] `cornerTtlMs = 'never'`，toast 不会自动消失，需用户点 ✕ 或 action。
- [ ] 点 corner toast 整卡或 action 按钮 → emit `pet://bubble-action` → App.tsx jump router 正确跳转到 `target`。
- [ ] `notificationForm = 'both'` → bubble 和 corner toast 同时出现。
- [ ] OS native notification 相关代码（`@tauri-apps/plugin-notification` import、`osNotify`、`startNotificationClickListener`）全部删除，`cargo check` / `tsc --noEmit` 通过。
- [ ] `petNotifyDispatcher.test.ts` / `petPosition.test.ts` / `PetBubbleApp.test.tsx` 全绿。

## Out of Scope

- bubble 的 template 系统改动（Cloudia 等 built-in template 视觉不变）。
- bubble 的 authorize 流程改动（保留 12s TTL，保留在 bubble，不进 corner）。
- corner toast 的自定义 template 系统（YAGNI，按 D3 推迟）。
- 非 macOS 平台的 corner 窗口行为（先 macOS，其他平台 best-effort）。
- bubble / corner 的入场/退场动画 polish（功能优先，动画后置）。

## Technical Notes

### 关键文件

- `apps/desktop/src/components/pet/PetBubbleApp.tsx` — bubble 组件，接 placement
- `apps/desktop/src/components/pet/petPosition.ts` — `computeBubblePosition` 重构 + 新增 corner 位置计算函数
- `apps/desktop/src/components/pet/PetCornerApp.tsx` — 新组件
- `apps/desktop/src/services/petNotifyDispatcher.ts` — 路由改动 + 删 OS native
- `apps/desktop/src/store/petStore.ts` — `bubblePlacement` / `cornerPlacement` / `cornerTtlMs` / `notificationForm` 枚举改
- `apps/desktop/src/components/settings/NotificationsSettings.tsx` — UI 选项改
- `apps/desktop/src-tauri/tauri.conf.json` — 新增 `pet-corner` 窗口配置
- `apps/desktop/src-tauri/src/commands/pet_commands.rs`（或对应位置）— `pet_corner_*` invoke 命令，参考 `pet_bubble_*`
- `apps/desktop/src/main.tsx` — `#/pet-corner` 路由挂载 `PetCornerApp`

### 单位约定

- 所有 position 计算在逻辑点空间，调用方负责 `* scale_factor` / `/ scale_factor` 边界转换（同现有 `petPosition.ts` 约定）。
- corner toast 卡片尺寸（~320×80）为逻辑点，物理尺寸由 Rust 端 `pet_corner_set_size` 按 `scale_factor` 转换。

### 事件契约

- `pet://bubble-show`（不变，payload 新增可选 `placement`）
- `pet://corner-show`（**新**，payload 同 `PetBubblePayload`，`template`/`placement` 字段被 corner 忽略）
- `pet://bubble-action`（不变，corner 也 emit 这个事件，App.tsx jump router 零改动）
- `pet://bubble-authorize-request`（不变，只在 bubble）

### 参考实现

- `pet-bubble` 窗口 + `PetBubbleApp.tsx` + `pet_bubble_*` Rust 命令是 corner toast 的直接参考——NSPanel 透明窗口、CSP 注入、event delegation、TTL 计时器模式可直接复用。
