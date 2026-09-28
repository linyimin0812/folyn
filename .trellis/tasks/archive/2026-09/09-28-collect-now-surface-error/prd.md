# 立即采集失败时直接显示错误详情

## Goal

`runCollect` 的 catch 只 console.warn 并返回 null，UI 的「立即采集」只显示笼统的「采集失败（未安装/未启用/…）」——真实错误（如 163 login failed）被吞掉，用户要去采集记录翻日志。

## Requirements

* 采集抛错时，错误文本直接显示在采集器卡（红色），并作为「立即采集」失败的 notice 文案
* 错误为运行期瞬态（同 collectProgress）：下次采集开始时清空，不持久化
* 跳过型 null（未启用/无 vault）保持原通用文案
* 错误格式化兼容 Error / Tauri AppError `{category, detail}` / 字符串

## Acceptance Criteria

* [x] 采集器抛错（如 163 登录失败）→ 卡片状态区显示具体错误
* [x] 再次采集开始时旧错误消失
* [x] desktop tsc + 相关测试绿（activity services 35/35）

## Technical Approach

* store：`collectErrors: Record<string, string>` + `setCollectError(id, msg|null)`（镜像 collectProgress，不 persist）
* runtime.runCollect：开始时清错，catch 里 `setCollectError(id, text)`
* CollectorCard：订阅 collectErrors → statusContent 红字；onCollectNow 的 null 分支优先取 store 错误文本

## Out of Scope

* 轮询失败的通知/重试机制

## Technical Notes

* 关键文件：`apps/desktop/src/store/activityCollectorStore.ts`、`apps/desktop/src/services/activity/runtime.ts`（runCollect catch）、`apps/desktop/src/components/settings/CollectorsSettings.tsx`（statusContent / onCollectNow）
