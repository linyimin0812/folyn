# Pet External Notify API

## Goal

让**外部应用**通过本地 HTTP API 触发桌宠能力(首要是通知)。Rust 侧用 tiny_http 起
127.0.0.1 server,把请求转成 `pet://notify` 事件,复用 app 已有 `dispatchNotification`
链路(bubble / 系统通知)。提供一个通用 `POST /pet/action` 入口 + `GET /health` 探活。

## Requirements

- **传输**:本地 HTTP,仅绑 `127.0.0.1`,无鉴权(用户已确认;信任边界靠仅本机 + 输入校验)。
- **端口**:默认 17382,被占则递增重试到 17400,首个可用端口为准。**不写发现文件**——实际端口只在桌宠配置页 UI 展示,外部应用默认用 17382,被占时从配置页读实际端口。
- **生命周期**:随 app 启动常驻,app 退出即停(线程随进程结束)。
- **端点**:
  - `POST /pet/action`:JSON body `{ "action": "notify", "kind": "info"|"reminder"|"message"|"event", "title"?: string, "text": string, "target"?: { "kind": "schedule"|"chat"|"task"|"file", "id": string } }`。
    - `action == "notify"`:校验 `text` 非空、`kind` 合法 → `app.emit("pet://notify", payload)` → 200。
    - 其他 action → 501 Not Implemented(但 dispatch 用 `match` 结构,后续加 arm 即可)。
    - 非法 JSON / 缺 `text` / 非法 `kind` → 400。
  - `GET /health` → 200 `{ "ok": true, "port": <actual> }`。
- **复用链路**:HTTP handler 只做"解析 + emit",通知逻辑全走现有 `pet://notify` → `usePetHostBridge` → `dispatchNotification`。
- **输入校验(信任边界)**:body 上限 64KB;`text` 截断/拒绝超长;只接受白名单 `kind`。
- **配置页展示端口**:桌宠设置页(`PetSettings.tsx`)新增"外部 API"区块,展示实际端口 + `POST /pet/action` 端点 + curl 示例 + 复制按钮。
  - 新增 Rust 命令 `get_pet_api_info` → `{ enabled, port, endpoints }`(server 未起或未就绪时 `enabled:false`)。
  - `PetSettings` 用 `useEffect` 拉取一次;非 Tauri 环境整块隐藏(沿用 `isTauri()` 守卫)。
  - i18n:新增 `settings:pet.api.*`(title/desc/port/endpoint/curl/copy/copied/disabled),zh + en 两份。

## Acceptance Criteria

- [ ] `curl -XPOST 127.0.0.1:<port>/pet/action -d '{"action":"notify","kind":"info","text":"hi"}'` → 200,桌宠弹通知。
- [ ] `curl 127.0.0.1:<port>/health` → 200 `{"ok":true,"port":<port>}`。
- [ ] 17382 被占时自动换端口,配置页显示实际端口(不写文件)。
- [ ] 非本机地址(外网/局域网 IP)无法连入(只 bind 127.0.0.1)。
- [ ] 非法 JSON / 缺 `text` → 400;未知 action → 501。
- [ ] body > 64KB → 413 / 400。
- [ ] pet mode 关闭时调用仍 200(走系统通知或按 notificationForm 路由)。
- [ ] 桌宠设置页显示实际端口 + 端点 + curl 示例,复制按钮可用;非 Tauri 环境区块隐藏。

## Definition of Done

- 单元测试:payload 校验纯函数 + action dispatch 路由(可在 Rust 测里直接测函数,不必起真实 socket)。
- 手测脚本(curl 示例)写入 README 或 docs。
- `cargo fmt`/`clippy`、`pnpm lint/typecheck`、CI green。
- 回退:server 启动失败不阻断 app(只 log);移除新增依赖即可回退功能。

## Technical Approach

- 新增依赖:`tiny_http = "0.12"`(研究确认不强制 tokio `net` feature,新增依赖树最小)。
- 新文件:`src-tauri/src/pet_api/mod.rs`(server spawn + bind 重试 + 路由 + 校验)、`src-tauri/src/pet_api/dispatch.rs`(纯函数:校验 payload、按 action 分流,便于单测)。
- `lib.rs` `setup()` 里 `app.handle()` clone → `pet_api::spawn(app.handle())`;server 实际端口存入 app state(简单 `Mutex<Option<PetApiInfo>>`),供 `get_pet_api_info` 命令读,不落盘。
- 新增 Tauri 命令 `get_pet_api_info`,注册到 `invoke_handler`。
- 前端:`PetSettings.tsx` 加"外部 API"区块;`get_pet_api_info` 通过 `invoke` 拉取;i18n zh+en 加 `pet.api.*`。
- 端口存 app state(内存),不落盘;外部应用默认 17382,被占时从配置页 UI 读实际端口。
- handler 拿到 `AppHandle` 后 `app.emit("pet://notify", serde_json::Value)` —— 与 `lib.rs:463` 菜单路径同一 emit。
- 前端无改动(dispatcher 已存在,无需感知来源)。

## Decision (ADR-lite)

- **Context**:外部应用需触发桌宠通知;已有完整 `pet://notify` 内部链路,缺跨进程入口。
- **Decision**:本地 HTTP(tiny_http,127.0.0.1,无鉴权)+ 通用 `POST /pet/action`(action 字段) + `GET /health`;默认端口 17382(被占重试,实际端口仅在配置页 UI 展示,不落盘);随 app 启动常驻。复用现有 dispatcher,HTTP 层只做解析+emit。
- **Consequences**:本机任意进程可触发通知(用户已接受);未来扩 show/hide/chat 只需加 match arm + 对应 emit。新增 tiny_http 依赖;server 失败不阻断 app。

## Out of Scope

- 远程/跨设备触发。
- 鉴权 token / TLS。
- 双向通信 / WebSocket / 长连接。
- show/hide/chat 等 action 的实现(MVP 只占 501)。
- 通知历史、富文本、图片。

## Technical Notes

- 关键文件:`src-tauri/src/lib.rs`(setup emit 先例 :463)、`src-tauri/src/commands/pet_commands.rs`、`src/services/petNotifyDispatcher.ts`、`src/hooks/usePetHostBridge.ts`、`src/components/pet/PetBubbleApp.tsx`(payload 契约)。
- 研究:[`research/rust-http-server.md`](research/rust-http-server.md) — tiny_http 推荐,含最小示例代码。
- 安全边界:HTTP 入口是信任边界,输入校验不可省;仅 bind 127.0.0.1 是第一道防线。
