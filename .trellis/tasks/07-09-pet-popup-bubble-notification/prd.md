# 桌面宠物弹窗气泡通知

## Goal

让桌面宠物在事件发生时通知用户,支持两种可配置形式:**宠物头顶气泡** 与 **OS 原生系统通知**。用户在设置页"通知"tab 全局选择通知形式(气泡 / 系统通知 / 两者都发 / 关闭)。统一承接四类触发源:日程提醒、宠物对话新消息、系统/任务事件、外部消息推送。两种形式点击均可跳转到来源实体。

## What I already know (from repo inspection)

* 技术栈: **Tauri 2 + React 18 + Zustand 5 + TS + pnpm 9**(monorepo)。非 Electron。
* 宠物是独立透明 `WebviewWindow`(`label:"pet"`, 96×96, transparent/decorations:false/skipTaskbar),入口 `apps/desktop/src/main.tsx` `#/pet` → `PetApp`。
* `pet` 与 `pet-panel` 两窗口经 `apps/desktop/src-tauri/src/pet_panel_macos.rs` 用 `tauri-nspanel` 转 NSPanel,获得 Dock level + `can_join_all_spaces | full_screen_auxiliary` —— 这是能浮在 fullscreen app 之上的关键。普通 `alwaysOnTop` 做不到。
* 跨窗口事件总线: Tauri `emit`/`listen`,频道 `pet://*`(如 `pet://menu-action`、`pet://visibility-changed`、`pet://shortcut-toggle`)。范式见 `App.tsx:345`。
* 宠物坐标: `getCurrentWindow().outerPosition()` + `scaleFactor()` 转逻辑点;Rust `pet_get_work_area` 返回 `NSScreen.visibleFrame`。布局数学在 `apps/desktop/src/components/pet/petPosition.ts`。
* **无任何通知库**(无 tauri-plugin-notification,无 sonner/react-toast)。
* **无气泡/speech bubble 历史实现**(`pet.css` 无 bubble/speech/tooltip)。全新功能。
* **日程无到点触发器**: `Reminders.tsx`/`TodayTaskList.tsx` 只是渲染时过滤未来/今日事项;`scheduleStore.toast()` + `SwToast` 仅在日程工作台页面内、CSS `sw-*`、非全局。不可复用为桌面气泡。
* **无外部推送通道**: 无 WebSocket/SSE/EventSource。当前所有触发源都在 app 内。
* petChat: `petChatStore`(`PetChatMessage.role` 仅 `user|assistant`,持久化)。新消息目前只在 pet-panel 窗口内渲染,pet mascot 窗口不感知。

## Assumptions (temporary, to validate)

* 气泡窗口复用 NSPanel 转换路径(在 `pet_panel_macos.rs` 的 label 列表加 `"pet-bubble"`),以获得 fullscreen 覆盖能力。
* 气泡状态 runtime-only,不持久化(区别于 petChat 会话)。
* 到点提醒用前端常驻 `setInterval` 轮询 scheduleStore,不引入 cron/后台进程。
* 外部消息推送 MVP 暂不做通道(仓库无现成通道),仅预留事件入口 `pet://bubble-show`,等有推送源再接。

## Open Questions

(已收敛,见 Decisions)

## Decisions

* **MVP 范围 = 气泡骨架 + 富交互/跳转**: 气泡窗口 + `pet://bubble-show` 事件入口 + 富交互(动作按钮 + 标题可点跳转) + demo 触发。验证"能弹、能浮于 fullscreen、能交互、能跳转到来源实体"。四类触发源的**实际到点/事件接入**仍下期,但气泡本身已支持完整交互,接入后即可用。
* **架构 = 独立 `pet-bubble` 窗口 + 事件驱动跳转**: 新建透明无边框 `WebviewWindow`(`label:"pet-bubble"`),加入 `pet_panel_macos.rs` NSPanel 转换 label 列表以获得 fullscreen 覆盖。mascot 窗口状态机零侵入。气泡窗口不直接路由,点击动作 `emit('pet://bubble-action', action)` → 主窗口监听后执行跳转 + 自带前台(`App.tsx` 现有 `pet://menu-action` 范式)。
* **消失 = 自动 TTL(6s)+ 手动关闭按钮**: 有手动 ✕ 关闭。TTL 与点击关闭都触发;点动作按钮(跳转)后气泡立即消失。
* **定位 = 显示时相对 pet 窗口 outerPosition 计算头顶偏移**: pet 拖动期间隐藏气泡(避免跟踪抖动),拖动结束可重弹。
* **demo 触发 = 复用 `pet://menu-action`**: 在宠物右键菜单(`pet_show_context_menu`)加一项"测试气泡通知",Rust `on_menu_event` 发 `pet://notify`(统一通知入口),主窗口 dispatcher 按 `notificationForm` 设置分发到气泡/系统通知。示例载荷含一个"查看详情"跳转按钮(跳到日程工作台)验证跳转链路。范式见 `App.tsx:345`。
* **OS 原生通知 = tauri-plugin-notification**: 新增依赖 `tauri-plugin-notification`(Rust crate + `@tauri-apps/plugin-notification` npm + `notification:default` capability on `default.json`/main 窗口)。`sendNotification({id, title, body, extra})` 显示;`onNotificationEvent` 收 click 事件,用 `event.id` 查前端 `Map<id, target>` 拿跳转目标(因 `extra` 在 click 事件跨平台回传不可靠,见 research)。点击 → 复用 `pet://bubble-action` 路由跳转。首次发通知先 `requestPermission()`。
* **可配置形式 = 全局单一选择**: `settingsStore` 加 `notificationForm: 'bubble'|'system'|'both'|'off'`(默认 `'bubble'`,保留现状),持久化。设置页新增"通知"tab(`SettingsTab` 加 `'notifications'`),提供形式选择器。dispatcher(`App.tsx`)读 `notificationForm` 决定: bubble → `emit('pet://bubble-show')`;system → OS 通知;both → 两者;off → 不发。

## Requirements

* 新建透明无边框 `pet-bubble` Tauri 窗口,经 NSPanel 转换,能浮于 fullscreen app 之上。
* 统一事件入口 `pet://bubble-show`,载荷:
  ```
  {
    text: string,                       // 气泡正文(短)
    title?: string,                     // 可选标题,标题可点跳转
    kind?: 'info'|'reminder'|'message'|'event',
    source?: string,
    target?: { kind: 'schedule'|'chat'|'task'|'file', id: string },  // 跳转目标
    actions?: { id: string, label: string, kind?: 'primary'|'ghost' }[]  // 动作按钮(≤2)
  }
  ```
* 气泡显示于宠物头顶,6s 自动消失,✕ 手动关闭,点标题/动作按钮即消失。
* **富交互**:
  * 标题可点 → `emit('pet://bubble-action', { type:'navigate', target })`。
  * 动作按钮可点 → `emit('pet://bubble-action', { type:'action', actionId, target })`。
  * 主窗口监听 `pet://bubble-action` 执行跳转:日程项→日程工作台定位、对话 session→打开 pet-panel 切 session、任务/文件→打开对应页。
* demo 触发: 宠物右键菜单"测试气泡通知",Rust 发 `pet://notify`,dispatcher 按设置分发,示例载荷含"查看详情"跳转按钮。
* 气泡状态 runtime-only,不持久化。
* **OS 原生系统通知**:`tauri-plugin-notification`,`sendNotification({id,title,body,extra})`;`onNotificationEvent` click → `Map<id,target>` 查表 → 复用 `pet://bubble-action` 路由跳转;首次 `requestPermission()`。
* **可配置形式**:`settingsStore.notificationForm: 'bubble'|'system'|'both'|'off'`(默认 `'bubble'`,持久化);设置页新"通知"tab 提供选择器;dispatcher 按设置分发。

## Acceptance Criteria

* [x] 右键宠物 → "测试气泡通知" → 宠物头顶弹出气泡,文字可读,含✕关闭与"查看详情"按钮。
* [x] 气泡能浮在 fullscreen app 之上(验证 NSPanel 转换生效)。
* [x] 6s 后自动消失;✕ 提前消失;点标题/动作按钮后立即消失。
* [x] 点"查看详情"→主窗口带前台并跳转到日程工作台(验证 `pet://bubble-action` 链路)。
* [ ] pet 拖拽期间气泡不出现/不抖动。**跳过**:当前唯一触发源是右键菜单(非拖拽),拖拽期间无触发路径;接入实时触发源(日程到点轮询等)时再加 — PetApp 拖拽态需经 `pet://drag-state` 事件告知 bubble 窗口或 bubble 显示前 probe 拖拽态。
* [x] 不破坏宠物现有拖拽/置顶/右键菜单/NSPanel 行为。
* [x] Vitest 覆盖 TTL/关闭/排队去重/动作派发逻辑。
* [ ] 设置页"通知"tab 可选形式(bubble/system/both/off),切换后 demo 触发按所选形式发出。
* [ ] `notificationForm='system'` 时 demo 触发弹 OS 原生通知(非气泡);点通知 → 主窗口带前台 + 跳转日程工作台。
* [ ] `notificationForm='both'` 时气泡与系统通知同时出现;`'off'` 时两者都不发。
* [ ] Vitest 覆盖 dispatcher 按 `notificationForm` 分发逻辑 + 系统通知 click→跳转(查表)逻辑。

## Out of Scope (explicit)

* 四类触发源的**实际到点/事件接入**(日程到点触发器、pet-chat 新消息监听、任务完成事件广播、外部推送通道)——本任务只留统一 `pet://notify` 入口与分发/跳转链路,接入由后续任务完成。
* 气泡内嵌表单/输入框(富交互仅限按钮 + 跳转)。
* 多气泡队列(骨架单条;重复触发去重/替换)。
* 气泡历史记录与"稍后提醒"延迟重弹。
* 系统通知的 action button(稍后提醒/忽略等多选项)——MVP 用 plain-click + id 查表跳转;多 action 按钮等需要"跳转/稍后提醒"并列选项时再加(见 research 第 7 点)。
* 按触发源分别配置形式(全局单一选择)。

## Technical Approach

**窗口层 (Rust/Tauri)**:
- `tauri.conf.json` 加 `pet-bubble` 窗口定义(照 `pet` 抄: transparent/decorations:false/skipTaskbar:true/visible:false,尺寸如 320×120)。
- `pet_panel_macos.rs` 的 `for label in ["pet","pet-panel"]` 加 `"pet-bubble"`,获得 NSPanel + Dock level + full_screen_auxiliary。
- 复用 `pet_get_work_area`/`set_pet_position` 同族思路新增(或复用)气泡定位命令;若可纯前端 `getCurrentWindow().setPosition` 则零 Rust。

**前端 (React)**:
- `main.tsx` 加 `#/pet-bubble` 路由 → `PetBubbleApp` 组件。
- `PetBubbleApp`: `listen('pet://bubble-show')` → 渲染气泡(标题 + 正文 + ✕ + 动作按钮)+ 启 TTL 定时器 + 点击关闭;透明区 `setIgnoreCursorEvents` 透传;点击标题/动作按钮 `emit('pet://bubble-action', {...})` 后自关。
- 气泡定位: 读 pet 窗口 outerPosition + scaleFactor,头顶偏移(复用 `petPosition.ts` quadrant 思路)。
- 主窗口 `App.tsx` 新增 `listen('pet://bubble-action')` → 按 `target.kind` 路由: schedule→日程工作台定位、chat→打开 pet-panel 切 session、task/file→打开对应页 + `getCurrentWindow().setFocus()`。范式同 `pet://menu-action`。
- demo 触发: `pet_show_context_menu` 菜单加项 → Rust `on_menu_event` `emit('pet://notify', {demo 载荷})`(不再是 `pet://bubble-show`,改走统一入口让 dispatcher 按设置分发)。

**OS 系统通知 + 可配置形式 (本次新增)**:
- Rust: `Cargo.toml` 加 `tauri-plugin-notification = "2"`;`lib.rs` `.plugin(tauri_plugin_notification::init())`;`capabilities/default.json` 加 `notification:default`(主窗口 scope)。
- npm: `pnpm -C apps/desktop add @tauri-apps/plugin-notification`。
- `settingsStore`: 加 `NotificationForm = 'bubble'|'system'|'both'|'off'` 类型 + `notificationForm` 字段(默认 `'bubble'`,持久化)+ setter;`SettingsTab` union 加 `'notifications'`。
- 设置页 `SettingsPage.tsx`: nav 加"通知"项 + `settingsTab === 'notifications'` 渲染 `<NotificationsSettings/>`(形式选择 select)。
- dispatcher(`App.tsx`):新增 `listen('pet://notify')` → 读 `settingsStore.notificationForm`:bubble→`emit('pet://bubble-show', payload)`;system→`osNotify(payload)`;both→两者;off→drop。
- `osNotify(payload)`: `requestPermission()` → `sendNotification({id: <uid>, title, body: text, extra: {target}})`;维护 module-local `Map<id, target>`;`onNotificationEvent` 收 `type:'click'` → 查表拿 target → `emit('pet://bubble-action', {type:'navigate', target})`(复用现有 App.tsx 路由)。
- demo 触发链路改:`pet://notify` → dispatcher → 按设置分发。

## Decision (ADR-lite)

**Context**: 需要桌面宠物事件通知,仓库无任何通知/气泡基础,且宠物窗口已有复杂状态机与 NSPanel fullscreen 机制。用户要求气泡支持富交互与跳转,并要求支持 OS 原生系统通知 + 用户可配置通知形式。
**Decision**: 独立 `pet-bubble` 透明 NSPanel 窗口 + 统一 `pet://notify` 入口 + dispatcher 按 `notificationForm` 分发到气泡(`pet://bubble-show`)/OS 通知(`tauri-plugin-notification`)/两者/无。跳转统一走 `pet://bubble-action`(气泡按钮/标题 + 系统通知 click 查表都复用)。OS 通知 click 用 `event.id` 查 `Map<id,target>`(绕开 `extra` 回传不可靠)。
**Consequences**: 多一个窗口 + 一个 plugin + 一个设置项,但触发源只 `emit('pet://notify', payload)` 即可,形式选择与分发集中在主窗口 dispatcher,跳转单一路由出口。系统通知 click 跳转依赖 `Map<id,target>` 查表,进程退出后 map 丢失(可接受,通知本身也只 live 到进程结束)。

## Definition of Done

* Tests(Vitest)覆盖触发/排队/消失逻辑。
* Lint / typecheck / build 绿。
* 行为变更记录(气泡样式、事件频道)。
* 不破坏宠物现有拖拽/置顶/NSPanel 行为。

## Technical Notes

* 复用 NSPanel 转换: `apps/desktop/src-tauri/src/pet_panel_macos.rs`(label 列表)、`tauri.conf.json`(窗口定义)。
* 复用事件总线: `pet://*` 命名,`App.tsx:345` 监听范式。
* 复用坐标数学: `petPosition.ts` `computePanelPosition` quadrant 算法,改偏移方向贴头顶。
* 不复用 `SwToast`(作用域绑死日程页)、不硬塞 `petChatStore`(污染对话历史与持久化)。
* 到点触发器参考 `scheduleStore.tickPomo()` 的 store 内 tick 范式。

## Research References

* [`research/tauri-plugin-notification.md`](research/tauri-plugin-notification.md) — tauri-plugin-notification v2 的 sendNotification/onNotificationEvent/onAction API、capability 权限、macOS 权限提示;推荐 plain-click + `id` 查表跳转(绕开 `extra` 回传不可靠)。
