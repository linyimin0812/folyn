# implement-activity-collection

## Goal

按照 `folyn-activity-collection-design.md`（仓库根目录，开放问题已全部决断）在主应用中落地活动采集系统：采集器扩展可插拔（collectors / activityDisplay / entityTypes 三个贡献点），写入/存储/查询/渲染全部为核心原生能力，原生「活动」Tab UI（时间线+指标+进行中+实体关系浏览器+报告写入 vault），配套原型 `folyn-activity-prototype.html` 已验证交互。

## What I already know

- 设计文档：`folyn-activity-collection-design.md`，§1–§9，含 schema、SQL、贡献点 JSON、查询 API、UI 结构、权限模型、路线图 P0–P8
- 原型：`folyn-activity-prototype.html`（时间线/实体图/日历区间选择/指标 pin 折叠/面包屑折叠/采集器商店全部交互已验证）
- 代码库现状（Explore 报告要点）：
  - Tauri 2 + React 18 + TS + pnpm monorepo；`apps/desktop`（前端 `src`，Rust `src-tauri`），`packages/extension-sdk`、`extension-host`、`cli-adapter`、`vault-provider` 等
  - trusted-tier 扩展已存在：TOFU approve、blob import；新贡献点 = 在 `packages/extension-sdk/src/types.ts` 声明 + 写 adapter + 在 `apps/desktop/src/services/extension-host/trustedContributions.ts` 注册一行
  - `rusqlite 0.40 (bundled)` 已在 `apps/desktop/src-tauri/Cargo.toml`，但无任何使用——SQLite 层是绿地
  - 无现成调度/轮询设施；webhook 本地 HTTP 服务可参照 `src-tauri/src/pet_api/`（tiny_http, 127.0.0.1, 绑定端口重试）
  - 出站 HTTP 校验先例：`extension_fetch.rs`（manifest origins allowlist）→ hostAllowlist 同思路
  - 设置持久化：`~/.folyn/storage/<key>.json`（`utils/storageClient.ts` + `store/settingsPersistence.ts`）
  - 原生页面路由：`AppPage` + `App.tsx` switch + `ActivityBar.tsx` + `registerBuiltinPanels.tsx`
  - vault 写入：`editorIoService.ts` / `vaultStore.ts`；扩展侧 `ctx.vault.writeText`
  - AI：`src-tauri/src/chat.rs`（rig 多 provider）+ `services/rigChat.ts`；cli-adapter 供日报生成
  - 桌宠通知：`POST 127.0.0.1:17382/pet/action`（pet_api）
  - d3-force 已是依赖（实体图可用）

## Assumptions (temporary)

- activity.sqlite 放 Rust 侧（rusqlite），核心命令暴露给前端——性能/事务/索引都在 Rust；前端不引 sql.js
- 采集器贡献点走既有 trusted-tier adapter 机制，不新增 tier
- 官方两个标杆采集器（Git Commit poll + 通用 Webhook）作为 in-tree trusted 扩展实现

## Open Questions

（无——设计文档开放问题已全部决断；范围切分已确认）

## Decision (ADR-lite)

**Context**: P0–P8 工作量大，需要确定任务结构与落地方式。
**Decision**: 分 4 个子任务，本次全部做完：
1. `activity-data-layer` — Rust 侧 `src-tauri/src/activity/`：rusqlite 建 activity.sqlite（按设计 §5 schema）、写入管道（§4.3 校验/隐私过滤/append-only 去重/实体解析/关系写入/限流）、查询 API（§6）全部作为 Tauri commands 暴露；纯 Rust 单测。
2. `activity-collector-host` — SDK 类型（collectors/activityDisplay/entityTypes 贡献点声明）、trusted adapter 注册、轮询调度（下限 60s、可关、手动采集）、webhook 本地服务（参照 pet_api tiny_http 模式）、hostAllowlist 安装确认；Git Commit + 通用 Webhook 两个官方标杆 in-tree 扩展。
3. `activity-ui` — 原生「活动」Tab：AppPage + ActivityBar + 时间线/指标 pin 折叠/进行中模块/日历区间选择/实体动态浏览器（d3-force 或原型同款静态布局）/详情面板兜底渲染；activityDisplay 索引驱动。
4. `activity-report-ai` — 日报/周报/月报生成（cli-adapter）、写入 vault（frontmatter、未改覆盖/改过追加、openInEditor）、AI 摘要懒加载缓存（ai_summary）、桌宠通知联动。
**Consequences**: 每层可独立验证与提交；AI 依赖在 ④ 才接入，前三层不被阻塞。

### 落地技术决策（推荐项，可推翻）

- activity.sqlite 放 Rust（rusqlite 已在依赖），前端零 SQLite 依赖；DB 文件位于 vault 内（单 vault 一份，与笔记索引库分开）
- 采集器贡献点复用 trusted-tier adapter 机制，不新增 tier
- webhook 服务独立端口（127.0.0.1，参照 pet_api 绑定重试），路由 `/<collectorId>`
- 日报生成走 cli-adapter（设计 §1 架构图已定）；事件 AI 摘要走 rig chat（chat.rs）

## Requirements (evolving)

- §4 ActivityEvent schema + 写入管道（校验/隐私过滤/去重 append-only/实体解析 lookup-or-create/关系写入/限流）
- §5 activity.sqlite 表结构（activity_events/entities/relations/collector_cursors），单 vault 一份
- §6 查询 API（listEvents/aggregateMetrics/getEntityNeighbors 一跳/时间加权排序/getDailyDigestInput/getEventSummary 懒加载缓存）
- §2 collectors 贡献点（poll/webhook、authSchema 表单、hostAllowlist 确认、轮询下限 60s 可关）
- §3 activityDisplay + entityTypes 贡献点（声明式展示元数据、类型注册表、冲突显式提示）
- §7 原生活动 Tab（时间线+指标 pin/折叠+进行中模块+日历区间选择+AI 摘要懒加载+查看原文）
- §7.2 动态实例浏览器（同类型聚合、超 8 收缩、面包屑折叠）
- §7.5 报告写入 vault 为真实笔记（frontmatter、未改覆盖/改过追加、openInEditor）
- §8 权限与安全（keychain 优先、隐私双开关、正则脱敏可选项）
- §7.6 桌宠通知联动

## Acceptance Criteria (evolving)

- [ ] 采集器通过 pushEvents 写入，重启后不重复采集（游标推进）
- [ ] 时间线/指标/实体图/报告与原型交互一致
- [ ] 三方未声明 type 走兜底渲染，不崩不漏
- [ ] 类型注册冲突在扩展商店显式提示
- [ ] 日报写入 `活动记录/日报/*.md`，改过追加未改覆盖

## Definition of Done

- 单元测试覆盖写入管道（去重/实体解析/关系映射）与查询聚合
- lint / typecheck / cargo test 全绿
- 原型验证过的交互在真实 UI 中一致

## Out of Scope

- 跨 vault 汇总（已决断不做）
- P7 生态化文档（collector/activityDisplay 开发指南）单独立任务
- 社区采集器（钉钉/飞书/Jira 等）

## Technical Notes

- 探索报告：见本文件 "What I already know" 与会话记录
- 设计文档即权威规格：`folyn-activity-collection-design.md`
- 原型即交互规格：`folyn-activity-prototype.html`
