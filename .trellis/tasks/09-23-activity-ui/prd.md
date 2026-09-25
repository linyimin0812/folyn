# activity-ui

## Goal

原生「活动」Tab UI（设计 §7.1–§7.4）：时间线、指标、进行中、日历区间选择、实体动态浏览器、详情面板。父任务：`.trellis/tasks/09-23-implement-activity-collection`，交互规格以 `folyn-activity-prototype.html` 为准。

## Requirements

- `AppPage` 新增 `activity` + App.tsx 路由 + ActivityBar 按钮 + i18n
- 时间线：倒序、图标/分类色来自 activityDisplay 索引、点击展开详情（detailFields 声明渲染 + 兜底灰圆点 payload 平铺）、查看原文链接（有 url 才显示）
- 指标卡：内置 6 张默认 pin、三方声明默认进「更多指标 · N」折叠区、pin/unpin 按 metric id 持久化（settingsPersistence 模式）
- 进行中模块：常驻顶部，排期窗口任务「第 X/Y 天」进度条；浏览历史期时隐藏
- 日历区间选择器：今天/本周/本月 + 日历点选区间（复刻原型交互），未来日期禁用
- 实体动态浏览器：一跳邻居、同类型 ≥2 聚合节点、超 8 项半径收缩、面包屑超 3 级折叠、点节点换圆心、聚合点开列表面板、未注册 type 灰色兜底
- 图谱布局可复用原型静态放射布局（d3-force 已在依赖，但原型布局更贴近已验证交互，优先静态放射）
- 采集器管理（扩展商店）：复用现有 Extensions Store 界面加采集器条目：状态、安装→权限确认弹窗→配置表单（authSchema）、轮询开关/立即采集、上次同步信息

## Acceptance Criteria

- [ ] 原型验证过的全部交互在真实 UI 中一致
- [ ] 未声明 type 兜底渲染不崩不漏
- [ ] pin 状态跨时间范围切换持久

## Out of Scope

- 报告生成/AI 摘要/桌宠通知（子任务 4）

## Technical Notes

- 原型 CSS 变量（--surface/--border 色板）与 app 现有主题对齐即可，不逐像素复刻
- 本体说明图（固定五宫格）为文档性质，不进本期 UI
