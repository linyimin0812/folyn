# Research: tauri-plugin-notification v2 (OS 原生通知 + 点击跳转)

- **Query**: 研究 tauri-plugin-notification v2 能力,确定桌面宠物"OS 原生系统通知 + 点击跳转到来源实体"的实现方式
- **Scope**: external(插件文档/源码)+ internal(本仓库 Cargo.toml / capabilities)
- **Date**: 2026-07-09

> 注意:本仓库 PRD 的主形态是 in-app NSPanel 气泡(`pet-bubble` 窗口),不是 OS 原生通知。本研究针对的是"OS 原生通知"这条补充通道——适用于 app 窗口失焦/最小化、或希望走系统通知中心时的场景。两者并存策略见第 7 点。
>
> 沙箱内 curl/gh 网络出口被拒,以下结论基于插件 v2 的稳定公开 API(2.x),已在不确定处显式标注置信度。落地前请用 `pnpm add @tauri-apps/plugin-notification` 后对照 `node_modules/@tauri-apps/plugin-notification/dist-js/index.d.ts` 复核类型签名。

## 官方参考

- 文档: https://v2.tauri.app/plugin/notification/
- 源码: https://github.com/tauri-apps/plugins-workspace/tree/v2/plugins/notification
  - JS: `plugins/notification/guest-js/index.ts`
  - 权限: `plugins/notification/permissions/default.toml`
  - Rust: `plugins/notification/src`, macos 实现用 `UNUserNotificationCenter`

## 1. 显示通知的 JS API

`@tauri-apps/plugin-notification` v2,`sendNotification(options: string | Options): Promise<void>`。

`Options` 关键字段:`id?: number`(自定义数字 id,用于回调关联)、`title?: string`、`body?: string`、`icon?`、`actionTypeId?: string`(绑定的 action 类型)、`schedule?`、`extra?: unknown`(自定义数据,任意可序列化值)。

最小示例(macOS):

```ts
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from '@tauri-apps/plugin-notification';

async function notify(title: string, body: string, id: number) {
  let granted = await isPermissionGranted();
  if (!granted) await requestPermission();
  await sendNotification({ id, title, body });
}
```

结论:`title`/`body` 直接用;`extra` 字段存在,可塞 `{ target: { kind, id } }`。

## 2. 点击回调 + 自定义数据(最关键)

- `sendNotification` 返回 `Promise<void>`,**不返回**任何可监听对象;回调只能靠监听器。
- 两个监听器:
  - `onAction(cb)` —— **仅** action button 点击时触发,回调拿到 `{ id, actionId, payload }`(`payload` 即通知 `extra`)。
  - `onNotificationEvent(cb)` —— 所有通知生命周期事件,回调拿到 `{ id, type, extra? }`,`type` ∈ `'created' | 'click' | 'dismiss' | 'action'`。
- **plain body click(非 action button)**:在 macOS 上,点击通知正文会触发 `UNUserNotificationCenter` 的 default action,插件转成 `type: 'click'` 事件。**该事件会回传 `id`**(高置信)。`extra` 是否同时在 click 事件里回传——**不确定**:插件不同平台/版本行为不一致,有的版本 click 事件只带 `{ id, type }` 不带 `extra`。

**可靠替代方案(不依赖 extra 回传)**:在 `Options` 里显式设 `id: number`,前端维护一张 `Map<number, Target>`。`onNotificationEvent` 收到 `type === 'click'` 时用 `event.id` 查表拿 target,然后 emit 跳转。这样无论 `extra` 是否回传都能关联到来源实体。这是最稳妥的路径,见第 7 点。

如果用 action button,`onAction` 的 `payload` 能可靠拿到 `extra`(高置信,action button 本就是为带数据回调设计的)。

## 3. action button

可以。流程:

```ts
import { registerActionTypes, onAction, sendNotification } from '@tauri-apps/plugin-notification';

await registerActionTypes([
  {
    id: 'pet-notify',
    actions: [{ id: 'view', title: '查看详情', type: 'action' }],
  },
]);

const unlisten = await onAction((e) => {
  // e: { id: 通知id, actionId: 'view', payload: 通知的 extra }
  // → emit('pet://bubble-action', { type:'action', actionId: e.actionId, target: e.payload?.target })
});

await sendNotification({
  id: 42,
  title: '日程提醒',
  body: '...',
  actionTypeId: 'pet-notify',
  extra: { target: { kind: 'schedule', id: 'xxx' } },
});
```

结论:action button 能加,`onAction` 回调能拿到 button id(`actionId`)和通知 `extra`(`payload`)。需要 `notification:allow-register-action-types` 权限。

## 4. Rust 侧集成

`apps/desktop/src-tauri/Cargo.toml`(与现有 `tauri-plugin-shell = "2"` 同级):

```toml
tauri-plugin-notification = "2"
```

`apps/desktop/src-tauri/src/lib.rs`(在现有 `.plugin(...)` 链里追加):

```rust
.plugin(tauri_plugin_notification::init())
```

无需其它初始化。macOS 下插件用 `UNUserNotificationCenter`,要求 app 有合法 bundle identifier(本仓库已有签名 bundle,满足)。JS 侧 `pnpm add @tauri-apps/plugin-notification`(monorepo 在 `apps/desktop` 下)。

## 5. Capability 权限

权限标识(per-window-label,与本仓库 `capabilities/*.json` 的 `windows` 字段对应):

- `notification:default` —— 一组打包权限,**包含** `allow-is-permission-granted`、`allow-request-permission`、`allow-notify`、`allow-register-action-types`、`allow-cancel`、`allow-get-active` 等。本任务用这个最省事。
- 细粒度单条:`notification:allow-notify`(sendNotification)、`notification:allow-is-permission-granted`、`notification:allow-request-permission`、`notification:allow-register-action-types`(action button 才需要)。

scope:ACL 权限按 **window label** 隔离,主窗口的 grant 不延伸到 `pet`/`pet-panel`。PRD 说气泡由主窗口 `App.tsx` 统一派发,系统通知也在主窗口发起 → 在 `apps/desktop/src-tauri/capabilities/default.json`(`"windows": ["main"]`)的 `permissions` 数组里加 `"notification:default"`。若后续 `pet` 窗口也要直接发,再给 `pet.json` 加。

`onAction`/`onNotificationEvent` 是 JS 侧经 Tauri event 系统监听插件发出的事件,不需要额外 ACL 权限,`notification:default` 已覆盖。

## 6. macOS 权限提示

- 首次 `sendNotification`(或显式 `requestPermission()`)会触发 macOS 系统通知授权弹窗。**应**先 `isPermissionGranted()`,为 false 再 `requestPermission()`,再发通知。
- 授权后,app **背景化**(失焦/最小化)时通知仍能显示——这正是 OS 原生通知相对 in-app 气泡的价值。app 完全退出时进程不在,无法发实时通知(除非用插件的 `schedule` 排程,排程由系统在 app 不运行时也能触发)。
- 未授权时 `sendNotification` 静默不显示,不会崩;`requestPermission()` 返回 `'granted'|'denied'|'prompt'` 之类,denied 时应引导用户去系统设置开启。

## 7. 与 bubble 的并存策略建议(推荐)

**推荐:OS 原生通知用 plain-click + `id` 查表跳转;action button 非必需。**

理由:本任务"点击跳转到来源实体"的最自然 UX 是"点通知任意位置即跳",而不是强迫用户点一个"查看详情"按钮。但 plain-click 的 `extra` 回传在插件 v2 里跨平台不一致(见第 2 点)。所以用 `id` 查表绕开 `extra` 依赖:

```ts
// 主窗口 App.tsx(范式见 App.tsx:345 的 pet://menu-action 监听)
const pendingTargets = new Map<number, Target>();
let nextId = 1;

async function osNotify(text: string, target: Target) {
  const id = nextId++;
  pendingTargets.set(id, target);
  await sendNotification({ id, title: 'Folyn', body: text });
  // 超时清理
  setTimeout(() => pendingTargets.delete(id), 60_000);
}

await onNotificationEvent((e) => {
  if (e.type === 'click') {
    const target = pendingTargets.get(e.id);
    if (target) emit('pet://bubble-action', { type: 'navigate', target });
    pendingTargets.delete(e.id);
  }
});
```

落地步骤(最短 diff):
1. `Cargo.toml` 加 `tauri-plugin-notification = "2"`;`lib.rs` 加 `.plugin(tauri_plugin_notification::init())`。
2. `apps/desktop` `pnpm add @tauri-apps/plugin-notification`。
3. `capabilities/default.json` 加 `"notification:default"`。
4. 主窗口加一个 `osNotify` + `onNotificationEvent` 监听,与 PRD 的 `pet://bubble-show` 入口并列(同一触发源可同时弹 in-app 气泡 + OS 通知,或按窗口聚焦状态二选一:窗口聚焦走气泡,失焦走 OS 通知)。

何时改用 action button:需要"跳转"和"忽略/稍后提醒"两个并列选项时,再上 `registerActionTypes` + `onAction`。MVP 单一跳转用 plain-click 足够,少一层 API。

## Caveats / Not Found

- `extra` 在 plain-click(`onNotificationEvent` `type:'click'`)事件里是否回传——**未在沙箱内实测确认**。结论按"不可靠"处理,用 `id` 查表绕开。落地后建议跑一次真机,在 `onNotificationEvent` 里 `console.log(e)` 确认 macOS 上 `extra` 是否出现;若出现,可省掉 `pendingTargets` map 直接读 `e.extra.target`。
- `NotificationEvent` / `ActionEvent` 的精确字段名(`id` vs `notificationId`、`payload` vs `extra`)以 `index.d.ts` 为准,落地时复核。
- macOS 通知权限弹窗的触发时机和文案由系统控制,无法自定义。
