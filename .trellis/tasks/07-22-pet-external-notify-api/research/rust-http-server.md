# Research: Rust HTTP server crate for Tauri pet-notify local API

- **Query**: 为 Tauri 2.x Rust 侧选最简 HTTP server crate，仅监听 127.0.0.1 单 POST 端点，handler 拿 AppHandle 调 `app.emit("pet://notify", payload)`
- **Scope**: mixed (internal Cargo.toml/Cargo.lock + external crate knowledge)
- **Date**: 2026-07-22

## Findings

### Project constraints (verified from repo)

| Constraint | Evidence |
|---|---|
| `tokio` direct dep, features `["macros","rt","sync","time"]` — **无 `net`** | `apps/desktop/src-tauri/Cargo.toml:69` |
| `reqwest` 0.13 direct dep (client only, no server) | `Cargo.toml:55` |
| `http` 1.4.1 direct dep | `Cargo.toml:25`, `Cargo.lock` |
| `hyper` 1.10.0 **已作为传递依赖** in lock (via reqwest/tauri) | `Cargo.lock` |
| `tower` 0.5.3 **已作为传递依赖** in lock | `Cargo.lock` |
| `tokio` 1.52.3 已在 lock | `Cargo.lock` |
| `axum`, `tiny_http` **均不在** lock (全新依赖树) | `grep Cargo.lock` = 0 hits |
| `app.emit("pet://notify", value)` 先例 | `apps/desktop/src-tauri/src/lib.rs:463` (menu-action 路径); `pet_commands.rs:66` 注释 |
| emit 用 `serde_json::json!({...})` 构造 payload | `lib.rs:464-474` |
| `AppHandle` 由 Tauri command 参数注入（`pet_commands.rs:101` 等） | — |

**关键约束**: axum / hyper 1.x server 都需要 tokio 的 `net` feature（`TcpListener`）。当前 direct `tokio` 未开 `net`，加任一 async server crate 都会迫使 tokio 多编译 `net`+`tcp`+`io` 一大块（cargo feature 是 additive，最终 binary 体积上升）。`tiny_http` 与 `std::net::TcpListener` 都**不需要** tokio `net`。

### Candidate comparison

| 维度 | `tiny_http` | `axum` | `std::net::TcpListener` 手写 | `hyper` 1.x server |
|---|---|---|---|---|
| 新增依赖 | +1 crate 树（httparse 已传递在 lock） | +axum 本身（hyper/tower 已在 lock，但需开 tokio `net`） | **0** | hyper 已在 lock，但 server 路径要 `hyper-util` + tokio `net`（新增） |
| tokio `net` feature | 不需要 | **需要**（关键代价） | 不需要（用 `std::thread`） | 需要 |
| 与 Tauri/tokio 契合 | 松耦合：sync 线程，emit 是同步 `&self`，天然匹配 | tokio 原生，但要和 Tauri 的 async_runtime 共用一个 tokio（net feature 要开） | 用 `std::thread::spawn`，与 tokio 完全隔离 | 同 axum 问题 |
| 最小代码量 | ~15 行 handler | ~8 行（Router + serve） | ~45 行（bind + accept + 解析 request line + Content-Length + body + 写 200） | ~25 行（serve_connection + service fn） |
| HTTP 解析正确性 | crate 负责（Content-Length、分片读等） | hyper 负责 | **自己写**：trust-boundary 上的传输层解析，分片读/keep-alive 有坑 | hyper 负责 |
| 端口被占重试 | `Server::http(addr)` 返 `Result`，循环换端口简单 | `TcpListener::bind` 返 `Result`，同 | `TcpListener::bind` 返 `Result`，同 | 同 axum |
| 维护活跃度 | 低频但稳定（功能冻结式成熟，crates.io 最新 ~0.12.x，2024 仍有 release） | 极活跃（tokio-rs 官方） | N/A（stdlib） | 活跃（hyper 官方） |
| 信任边界输入校验 | HTTP 层由 crate 兜底，你只需校验 JSON payload 契约 | 同 | HTTP 层也需自己兜底（分片读、超长 body 截断/拒绝） | 同 |

### 最小示例代码

**方案 A — `tiny_http`（同步线程，AppHandle clone 进 thread）**

```rust
// Cargo.toml: tiny_http = "0.12"
use tiny_http::{Server, Method, StatusCode};
use std::thread;

pub fn spawn_notify_server(app: tauri::AppHandle) {
    // ponytail: bind retry — try a small port range, first wins.
    let server = (49152..=49200)
        .find_map(|p| Server::http(("127.0.0.1", p)).ok())
        .expect("no free port for pet-notify server");
    thread::spawn(move || {
        for rq in server.incoming_requests() {
            if rq.method() != &Method::Post || rq.url() != "/notify" {
                let _ = rq.respond(StatusCode::MethodNotAllowed, &[], &[]);
                continue;
            }
            // tiny_http 已按 Content-Length 读好 body
            let mut body = String::new();
            if rq.as_reader().read_to_string(&mut body).is_err() {
                let _ = rq.respond(StatusCode::BadRequest, &[], &[]);
                continue;
            }
            match serde_json::from_str::<serde_json::Value>(&body) {
                Ok(payload) => {
                    let _ = app.emit("pet://notify", payload);
                    let _ = rq.respond(StatusCode::OK, &[], b"ok");
                }
                Err(_) => { let _ = rq.respond(StatusCode::BadRequest, &[], b"bad json"); }
            }
        }
    });
}
```

**方案 B — `axum`（需加 tokio `net` feature）**

```rust
// Cargo.toml: axum = "0.7"; tokio features 追加 "net"
use axum::{Router, routing::post, extract::State, Json};
use serde_json::Value;

async fn notify(State(app): State<tauri::AppHandle>, Json(payload): Json<Value>) -> &'static str {
    let _ = app.emit("pet://notify", payload);
    "ok"
}

pub fn spawn_notify_server(app: tauri::AppHandle) {
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    // 写端口发现文件供外部调用方读取 …
    let app_ = app.clone();
    tauri::async_runtime::spawn(async move {
        let router = Router::new().route("/notify", post(notify)).with_state(app_);
        axum::serve(axum::extract::connect_info::into_make_service_with_connect_info(router), _).await
        // 简化：axum 0.7 用 axum::serve(listener.into(), router).await
    });
}
```
（注：`axum::serve` 在 0.7 起 server 侧需 tokio `net`；上面 listener 用 std bind 后 `.into()` 转 tokio，仍依赖 tokio net runtime 才能驱动 `serve`。）

### Files Found

| File Path | Description |
|---|---|
| `apps/desktop/src-tauri/Cargo.toml` | 依赖清单，tokio features 无 `net`（行 69） |
| `apps/desktop/src-tauri/Cargo.lock` | hyper 1.10.0 / tower 0.5.3 / tokio 1.52.3 已传递存在 |
| `apps/desktop/src-tauri/src/lib.rs:463` | `app.emit("pet://notify", serde_json::json!({...}))` 先例 |
| `apps/desktop/src-tauri/src/commands/pet_commands.rs` | `AppHandle` 注入 pattern，emit 用法 |

## Recommendation

**推荐 `tiny_http`。** 一句话理由：单 POST + 同步 `app.emit` 是 sync 线程的天然形状，`tiny_http` 不碰 tokio feature flag（省下 axum/hyper 必须开的 `net` 一大块编译体积），HTTP 解析由 crate 兜底使你能把校验精力集中在 JSON payload 契约（真正的信任边界）上，~15 行即收。

次选 `std::net::TcpListener` 手写为零依赖（ponytail 最纯路线），代价是 ~45 行手写 HTTP 请求行/Content-Length/分片读——可接受但留了传输层 bug 面；若团队对"零新依赖"权重高于"解析正确性外包"，可取此路。

不推 `axum`：唯一理由（tokio 原生）在本项目反而是成本——它强迫 direct `tokio` 追加 `net` feature，与"最小依赖"冲突；其路由/中间件能力在本场景（单端点）完全浪费。不推 `hyper` 1.x server：比 axum 更啰嗦但仍付同样的 tokio `net` 代价，两头不讨好。

## Caveats / Not Found

- 外部 crate 版本/维护活跃度因环境无网络访问，基于已知（tiny_http 0.12.x、axum 0.7.x、hyper 1.10.x 已在 lock）；落地前建议 `cargo add` 时复核 latest。crate 体积需以 `cargo build --release` 后 binary 实测为准，本文为定性比较。
- 端口策略（固定 vs 动态+发现文件）与鉴权（token 与否）是正交决策，未在本选型内裁定，见 PRD Open Questions。
- axum 0.7 的 `axum::serve` 精确签名以官方 docs 为准（示例为示意，可能需 `into_make_service_with_connect_info` 等）。
