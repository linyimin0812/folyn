# email collector 支持配置多个邮箱

## Goal

允许用户在 email-collector 中配置多个邮箱账户（各自 host/账号/密码/folder/backfillDays），逐账户轮询采集，而不是当前的单账号硬编码。

## What I already know

* 采集逻辑在 `extensions/email-collector/src/emailEvents.ts:142-229`，单次读取 `ctx.config` 的一组 host/username/password，硬编码单账号。
* 配置存储：`useActivityCollectorStore.configs['email']`（`apps/desktop/src/store/activityCollectorStore.ts:92`），authSchema 由 manifest 声明，通用表单渲染（`CollectorsSettings.tsx`）。
* Cursor：按 collector_id 存 SQLite `collector_cursors`（`src-tauri/src/activity/db.rs:134`），单条记录。
* 事件表 `activity_events.source` = collectorId（`email`），Rust ingest 校验 source == collectorId（`runtime.ts:91-93`）。账户信息只在 payload/actor 里（`identityKey = username@host`）。
* 代码库无 multi-account 先例。

## Assumptions (temporary)

* 账户数量上限小（<10），不需要复杂管理 UI。
* 凭证仍是明文 JSON 存储（keychain 是既有延后项，不本任务范围）。

## Open Questions

（已全部收敛）

## Decision (ADR-lite)

**Context**: 整条链路（configs / cursor / source 校验）假设单账号，需要选多账户建模方式。
**Decision**: 方案 A —— collectorId 保持 `email`，config 改为 `accounts: [{id, host, port, username, password, folder, backfillDays}]`；cursor key 用 `email:<accountId>`；source 仍为 `email`，账户区分靠 actor identityKey。settings 页为 email collector 渲染自定义账户列表表单（替代通用 authSchema 表单）。
**Consequences**: registry / ingest / store 外层结构不动，改动集中在扩展与 settings UI；单账户失败不阻塞其他账户（各自 try/catch，错误进采集日志）；不做每账户独立开关（需要时再加）。

## Requirements (evolving)

* 配置界面可增删多个邮箱账户，每账户含 host/port/username/password/folder/backfillDays。
* 每账户独立 cursor，轮询按账户推进。
* 事件中可区分来源账户（已有 identityKey 可承载）。

## Acceptance Criteria (evolving)

* [x] 可配置 ≥2 个账户并保存（settings 账户列表表单，即时写入 config）
* [x] 各账户按自身 cursor 增量采集，互不干扰（JSON map cursor，19 个测试覆盖）
* [x] 单账户认证失败不影响其他账户采集（per-account try/catch；全失败才 throw）
* [x] 旧单账户配置平滑迁移（store hydrate 迁移 + 采集端兼容旧平铺格式 + 旧裸数字 cursor 归属首个账户）
* [ ] 手动在桌面端配置 2 个真实邮箱验证（需要真实 IMAP 凭证，未执行）

## Out of Scope (explicit)

* keychain 凭证加密存储（既有 TODO）
* OAuth/非 IMAP 协议

## Technical Notes

* 关键触点：`emailEvents.ts`、`manifest.json` authSchema、`activityCollectorStore.ts`、`CollectorsSettings.tsx`、`runtime.ts:149-271` runCollect、`collector_cursors` 表。
* 候选方案 A（推荐）：collectorId 保持 `email`，config 改为 `accounts: []`，cursor key 用 `email:<accountKey>` 子键；source 仍为 `email`，账户区分靠 actor identityKey。改动集中在扩展 + settings UI + cursor 取值。
* 候选方案 B：注册多实例 `email:<id>` collector —— 需动 registry、ingest source 校验、store，侵入更大。
