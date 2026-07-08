# plugin-sandbox-http-fetch-via-rust

## Goal

把 sandbox 档 `rpcBridge` 的 `http:fetch` RPC 从「host webview 内 `fetch()`」改为「Rust 侧 `reqwest` 命令」，绕开主页 CSP `connect-src` 对插件声明 origin 的拦截，使 release 下 sandbox 插件的 allowlisted HTTP 请求真正可用。是已 archive 的 `07-08-microkernel-plugin-architecture` 的 follow-up。

## What I already know

- `rpcBridge.ts:347-356` 现状：`case 'http:fetch'` 先 `isOriginAllowed(url, perms.http.origins)`（**JS 侧 per-plugin origin 校验已存在**），再 `fetch(url, init)` 返回 `{status, headers, body: text}`。
- bug：`fetch(url)` 在 host webview realm 跑，主页 CSP `connect-src 'self' ipc: http://ipc.localhost` 不含各插件声明的 `permissions.http.origins` → release 下被 CSP 拦（dev 不注入 CSP 故本地测不出）。trellis-check 已标记为 follow-up。
- 既有 `commands.rs:62 fetch_url_content` 用 `curl` 子进程绕 CSP，但专用于 curl.md markdown 转换，非通用 HTTP。
- `reqwest 0.13.4` 已在 Cargo.lock（tauri 传递依赖）→ 加为 direct dep 成本极低，跨平台，全 HTTP 语义。
- rpcBridge 持有 `this.opts.manifest`（插件 manifest，含 `permissions.http.origins`）；Rust 侧 `plugins.json` 也有每插件 manifest（PR2/PR3 落盘）。
- 调用链：sandbox iframe → postMessage → rpcBridge（JS 校验 + 路由）→ invoke。插件拿不到原始 Tauri API，rpcBridge 是唯一 choke point。

## Assumptions (temporary)

- 响应 buffered（`{status, headers, body: text}`），与现 JS 实现一致；streaming 留后续。
- origin allowlist 双层校验（JS 快速失败 + Rust defense-in-depth 读 plugins.json）。
- 只修 `http:fetch`，不顺带重构其他 RPC（fs/clipboard/dialog/vault 不受 CSP 限制）。

## Open Questions

* （已收敛）origin 校验：双层 JS+Rust。范围：只 http:fetch。

## Decision (ADR-lite)

**Context**: sandbox `http:fetch` 在 host webview 跑 `fetch()` 被主页 CSP `connect-src` 拦；需挪到 Rust 侧。origin 校验层有 JS-only / Rust-only / 双层三选。
**Decision**: 双层 JS+Rust——JS 保留 `isOriginAllowed` 快速失败（非 allowlisted 不走 IPC），Rust 命令读 plugins.json 再校验 origin 后才 fetch（defense-in-depth）。用 `reqwest`（已在依赖树）做通用 HTTP，buffered 响应 `{status, headers, body}`。只修 `http:fetch`，不泛化。
**Consequences**: Rust 多一次 plugins.json 读（cheap，已落盘）；双层更安全，防未来 JS bridge 被绕过；streaming/通用 proxy 框架留后续。

## Technical Approach

- **Rust** `plugin_commands.rs`：新命令 `plugin_http_fetch(plugin_id, url, method, headers, body) -> {status, headers, body}`。纯函数 `is_origin_allowed(url, allowed_origins)` 先抽出来单测；命令内读 plugins.json 拿该插件 manifest 的 `permissions.http.origins`，校验通过才 `reqwest` 发请求。`Cargo.toml` 加 `reqwest` direct dep（已在 lock）。`lib.rs` 注册 invoke_handler。
- **TS** `rpcBridge.ts`：`http:fetch` 分支保留 `isOriginAllowed` 快速失败，把 `fetch(url, init)` 换成 `invoke('plugin_http_fetch', {pluginId: this.opts.pluginId, url, method, headers, body})`，返回形状不变。
- **Docs** `docs/plugin-development.md`：更新 sandbox http:fetch 说明（CSP 不再拦，Rust 侧 fetch + 双层 origin 校验）。
- **Tests**：Rust `is_origin_allowed` + 命令的 origin 拒绝（纯函数 + 真实 reqwest 用 mockito 或对不可控外部网不测，只测 origin 逻辑）；TS rpcBridge http:fetch 路由到 invoke + 非 allowlisted 不 invoke 直接拒。

## Implementation Plan

* 单 PR（范围小）：Rust 命令 + reqwest dep + origin 纯函数测试 → rpcBridge 改 invoke + TS 测试 → docs 更新 → 质量门。

## Requirements

* 新 Rust 命令 `plugin_http_fetch(plugin_id, url, method, headers, body)` 用 reqwest 执行 HTTP，返回 `{status, headers, body}`。
* 双层 origin allowlist：JS `isOriginAllowed` 快速失败 + Rust 读 plugins.json 校验。
* rpcBridge `http:fetch` 改为 invoke 该命令，不再直接 `fetch()`。
* 现有 JS 侧 `isOriginAllowed` 保留。

## Acceptance Criteria

* [ ] sandbox 插件声明的 origin 在 release（CSP 生效）下可成功 fetch；未声明 origin 被拒。
* [ ] Rust `is_origin_allowed` 纯函数测试（allow/deny/不同 origin）。
* [ ] rpcBridge 单测：http:fetch 路由到 invoke + 非 allowlisted origin 不 invoke 直接拒。
* [ ] 既有 RPC（fs/clipboard/...）行为不变，46 cargo + ~150 TS 测试无回归。

## Definition of Done

* Rust + TS 测试；typecheck/clippy/cargo test/vitest 绿。
* `docs/plugin-development.md` 更新 sandbox http:fetch 说明。
* 不破坏既有测试。

## Out of Scope

* 响应 streaming（大 body 流式）。
* 通用 host-RPC-proxy 框架化（只修 http:fetch）。
* trusted 档 http（trusted 插件在主 realm，可直接用主窗口能力）。

## Technical Notes

- 关键文件：`apps/desktop/src/services/plugin-host/rpcBridge.ts`、`apps/desktop/src-tauri/src/plugin_commands.rs`（加命令）、`lib.rs`（注册 invoke_handler）、`Cargo.toml`（加 reqwest direct dep）。
- reqwest 已在依赖树，加 direct dep 只为稳定 import path。
- origin 提取复用 rpcBridge 的 `extractOrigin`（JS）；Rust 侧用 `url` crate 或手解析。
