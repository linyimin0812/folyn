# Settings Persistence: Flush on Quit + Drop Double Debounce + Slice Registration Race

## Goal

配置项改动后应用重启会丢。三个独立根因都要修：(1) 退出路径无 flush，(2) settingsPersistence 路径叠了两层 300ms debounce，(3) `loadSettings` 仅 `await import('./aiConfigStore')` 来"等模块图稳定"，非传递依赖的 slice 可能仍未注册导致 hydrate 漏掉。

## What I already know

调查已确认：

* `apps/desktop/src/store/settingsPersistence.ts:68` `debouncedPersist` (300ms trailing) → for each slice 调 `storageClient.set(slice.name, data)`。
* `apps/desktop/src/utils/storageClient.ts:52` `scheduleFlush` 又叠 300ms trailing → 实际落盘延迟 600ms。
* `apps/desktop/src-tauri/src/commands/pet_commands.rs:103` `exit_app` 直接 `app.exit(0)`，前端无 close-requested / before-quit 钩子触发 flush。
* `loadSettings` (settingsPersistence.ts:117) 用 `await import('./aiConfigStore')` 等 SLICES 注册；只有 aiConfigStore 的传递依赖被保证。`efd6163`、`85574a9`、`09fbf24`、`e9b402f` 都是为诊断这个加的 log。
* 直接使用 `storageClient.set` 的 store（skillStore / petChatStore / bubbleTemplateChatStore / editorPersistence）依赖内层 debounce，不能简单删掉。
* 主窗口 `App.tsx` 未监听任何 close-requested / destroyed 事件。
* Secondary Tauri 窗口 (pet-corner / pet-bubble / pet-panel) 通过 `pet://settings-updated` 广播 hydrate，不直接读盘，不在本次修复范围。

## Assumptions (temporary)

* macOS 是主要平台，Cmd+Q 和窗口关闭按钮是两条主要退出路径。
* Tauri `tauri://close-requested` 在主窗口触发，能在此 async flush（但 `app.exit(0)` 仍可能抢先——所以 Rust 侧也要保险）。
* `exit_app` 由 pet 右键菜单触发；Cmd+Q 走系统菜单 → Tauri close-requested。

## Open Questions

* ~~Bug 3 修法~~ → 已确认：Expected slice 名单 + Promise 队列。
* 是否需要把 `storageClient.flushNow()` 也暴露给 secondary 窗口的 close 路径？（本次先不做，out of scope）

## Requirements (evolving)

1. **R1 — 退出 flush**：用户改动配置后任意退出路径（Cmd+Q / 关主窗口 / pet 菜单"退出应用"）必须把 pending 写落盘。落盘前取消 debounce timer，避免双写。
2. **R2 — 去掉 settingsPersistence 路径的双重 debounce**：外层 `debouncedPersist` 移除或改成直接调 `storageClient.set`；保留内层 300ms 聚合。直接用 `storageClient.set` 的 store 行为不变。
3. **R3 — slice 注册竞态**：`loadSettings` 不能依赖单一 `await import` 的传递性假设；显式等到所有应注册的 slice 都注册完再跑 hydrate 循环。
4. **R4 — 诊断 log 收尾**：Bug 3 现存诊断 log（slice 注册计数、excludePatterns 值、schedulePersist 调用栈）在 R3 落地后该删的删、该留的留（最终保留 slice 计数与"hydrate miss"告警）。

## Acceptance Criteria (evolving)

* [ ] AC1：改任一 persisted 配置 → 1 秒内 Cmd+Q → 重启后该改动可见。（手测脚本）
* [ ] AC2：改任一 persisted 配置 → 1 秒内点 pet 菜单"退出应用" → 重启后该改动可见。
* [ ] AC3：`storageClient.set` 路径仅一层 300ms debounce；`schedulePersist()` 调用后 ~300ms 内必须落盘（而非 ~600ms）。
* [ ] AC4：`loadSettings` 在所有 persisted slice 注册完之后再跑 hydrate 循环；如果某个 slice 在 5s 超时内未注册，记 warn 但不崩。
* [ ] AC5：现有 `settingsPersistence.test.ts` + `aiConfigStore.test.ts` 通过；新增 flush-on-quit 单测覆盖 R1。
* [ ] AC6：诊断 log 精简后控制台在正常启动时不刷屏。

## Definition of Done

* 单测覆盖：flush-on-quit 路径、单层 debounce、slice 注册等待。
* `pnpm typecheck` + `pnpm test` 绿。
* 手测脚本（写入 → 1s 内退出 → 重启 → 验证）跑过。
* 诊断 log 收尾，控制台干净。

## Technical Approach

### R1 — flush-on-quit

* `storageClient` 增 `flushNow(): Promise<void>`：取消 `scheduleFlush` timer，同步跑 `flushImpl` 并 await。
* `settingsPersistence` 增 `persistNow(): Promise<void>`：取消 `debouncedPersist` timer，跑一次同步 persist（调 `storageClient.set` + 立即 `await storageClient.flushNow()`）。
* 主窗口 `App.tsx` `useEffect` 监听 `tauri://close-requested`（或 `getCurrentWindow().onCloseRequested`）→ `await persistNow()` → 放行。同时监听 `beforeunload` 兜底非 Tauri 场景。
* Rust `exit_app` 修改：在 `app.exit(0)` 之前 emit `pet://flush-before-quit` 给所有 webview，等 500ms（或拿到 ack）再 exit。或更简单：frontend `routePetMenuAction` 的 `exit-app` 分支先 `await persistNow()` 再 `invoke('exit_app')`。

**推荐**：frontend 侧 `exit-app` 分支先 `await persistNow()`；主窗口 `onCloseRequested` 同样 await。Rust 侧 `exit_app` 不改（Cmd+Q 走 close-requested，已被覆盖；pet 菜单 exit 走 frontend）。最短 diff。

### R2 — 去掉双重 debounce

* `settingsPersistence.ts` 删 `debouncedPersist`，`schedulePersist()` 直接调 `storageClient.set(slice.name, data)`（每个 slice 一次）—— 但这样每次 setter 都同步跑 9 个 set，仍只压一份 dirty 队列。
* 或更小：保留外层 `debouncedPersist` 但内部 `storageClient.set` 后**不**再叠 debounce——不行，内层 debounce 是 `storageClient` 的契约，直接用户依赖它。
* **最终方案**：`schedulePersist()` 改成直接遍历 SLICES 调 `storageClient.set`，让 `storageClient` 的 300ms 单独负责聚合。删 `debouncedPersist`。落盘窗口 300ms + 退出 flush 兜底。

### R3 — slice 注册竞态

* `settingsPersistence.ts` 增 `sliceRegistered: Promise` 队列：每个 slice 名一个 resolver；`registerPersistSlice` 调对应 resolver。
* `loadSettings` 不再 `await import('./aiConfigStore')`，改为 `await Promise.race([Promise.all(sliceRegisteredPromises), timeout(5000)])` 后再跑 hydrate 循环。
* 已知 slice 名单固定（prefs / editorPrefs / pet / appearance / sync / voice / vault / schedule / modelRegistry / aiConfig），可在 `settingsPersistence` 顶层列出 expected slice names 做等待。
* 超时未注册 → warn 但不阻塞（向后兼容新 slice）。

### R4 — log 收尾

* 删 `09fbf24` 的 `schedulePersist caller stack` log。
* 删 `e9b402f` 的 `excludePatterns value` read/write log。
* 保留 `85574a9` 的 slice 注册计数（首启 1 行）+ 新增"hydrate miss"告警（expected slice 未注册）。

## Decision (ADR-lite)

**Context**: 三层独立 bug 都导致"改配置重启丢"。R1 是数据丢失主因；R2 是放大器；R3 是结构性漏 hydrate。

**Decision**:
* R1：frontend `exit-app` + `onCloseRequested` 双路径 await `persistNow()`；Rust 不改。
* R2：删外层 `debouncedPersist`，`schedulePersist` 直接走 `storageClient.set`，单层 300ms + flush-on-quit。
* R3：expected slice 名单 + Promise 队列，`loadSettings` 显式 `Promise.race([all, timeout])`。
* R4：删调试 log，保留首启 1 行 slice 计数 + hydrate miss 告警。

**Consequences**:
* 单层 debounce + flush-on-quit：丢失窗口从 600ms 降到 0（退出时同步 flush）。
* R3 引入 expected slice 名单，新增 persisted store 需同步加入名单（注释提示）。
* Rust 不改 → 不需要重新编译 desktop binary 在某些场景下更快验证（仅 frontend）。

## Out of Scope

* Secondary Tauri 窗口的 flush-on-quit（它们只读广播 blob，不写盘）。
* `editorPersistence` / `skillStore` / `petChatStore` / `bubbleTemplateChatStore` 自己的 debounce 路径——它们已直接走 `storageClient`，R2 的单层 debounce + flush-on-quit 自动覆盖。
* Rust 侧 `exit_app` 的 emit + ack 协议（过度工程）。
* 把 `storageClient` 换成同步写（性能损失，无必要）。

## Technical Notes

* `apps/desktop/src/store/settingsPersistence.ts:68-87, 117-152, 158`
* `apps/desktop/src/utils/storageClient.ts:38-73`
* `apps/desktop/src/utils/debounce.ts:1-23`
* `apps/desktop/src-tauri/src/commands/pet_commands.rs:101-105`
* `apps/desktop/src/services/petHostRouter.ts:113-123`（exit-app 分支）
* `apps/desktop/src/App.tsx`（待加 close-requested 监听）
* 现存测试：`apps/desktop/src/store/settingsPersistence.test.ts`、`apps/desktop/src/store/aiConfigStore.test.ts`、`apps/desktop/src/store/modelRegistryStore.test.ts`、`apps/desktop/src/store/aiStore.test.ts`
