# activity-collector-host

## Goal

采集器可扩展层（设计 §2/§3）：SDK 贡献点类型、trusted adapter 注册、轮询/webhook 宿主、hostAllowlist 权限确认、两个官方标杆采集器。父任务：`.trellis/tasks/09-23-implement-activity-collection`。

## Requirements

- `packages/extension-sdk/src/types.ts` 新增 `collectors` / `activityDisplay` / `entityTypes` 贡献点声明（按设计 §2.1/§3.1/§3.4 JSON 结构）
- `CollectorExtension` 接口（§2.2：collect(ctx)/onWebhook），挂入 `extension.ts` 能力面
- trusted adapter：`apps/desktop/src/services/extension-host/collectorAdapter.ts` + trustedContributions.ts 注册；启动时合并已启用采集器的 activityDisplay 索引与 entityTypes 注册表（冲突跳过+日志+商店条目冲突徽标数据）
- 轮询调度：pollIntervalMs 下限 60s、设置里可调大/整体关、手动「立即采集」、游标照常推进；应用未聚焦继续采集
- webhook 服务：tiny_http 本地 127.0.0.1 独立端口（参照 pet_api 绑定重试），路由到对应 collector 的 onWebhook，产物走 pushEvents
- hostAllowlist：安装/启用时弹窗一次性确认；运行时出站校验（复用 extension_fetch 先例）
- 标杆采集器：Git Commit Collector（poll，读本地仓库提交）+ 通用 Webhook Collector（webhook，字段映射），in-tree trusted 扩展
- authSchema 驱动配置表单渲染（配置值加密存本地，keychain 优先）

## Acceptance Criteria

- [ ] 标杆采集器安装→确认权限→采集→事件入库→重启不重复
- [ ] 轮询可关可手动；webhook 推送即入库
- [ ] entityTypes 冲突：后装者跳过、商店可见冲突提示
- [ ] authSchema 表单自动渲染

## Out of Scope

- UI 展示（子任务 3）、AI（子任务 4）、社区采集器

## Technical Notes

- 采集器进程与桌宠同生命周期，不额外拉起进程
- 存储访问 vault 侧统一走数据层 commands（子任务 1）
