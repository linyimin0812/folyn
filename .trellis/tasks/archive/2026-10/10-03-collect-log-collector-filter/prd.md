# 采集记录页采集器多选筛选

## Goal

在采集记录列表顶部添加采集器选择框，用户可多选采集器过滤记录。

## What I already know

- 页面：`apps/desktop/src/components/activity/CollectLogView.tsx`，数据 `CollectRunRecord[]`（`collectorId`/`collectorName`）
- 当前已按 `collectorId` 分组渲染手风琴；筛选可直接作用于分组 Map
- 采集器配置在 `useActivityCollectorStore` 的 `configs`；带记录的采集器可从 history 分组直接派生
- 现有 UI 模式：`.cl-badge` 徽章、`.btn` 系列、手风琴分组

## Assumptions (temporary)

- 筛选选项 = history 中出现过的采集器（无记录的采集器过滤无意义）
- 未选择 = 显示全部

## Open Questions

（无 — 已确认行内 chips）

## Requirements

- 记录列表顶部一行采集器 chips（多选）：选中 = acc 高亮，未选中 = 弱化样式；点击切换
- 选项来源 = history 中出现过的采集器（按分组顺序）
- 默认全部选中（显示全部）；取消某 chip 则隐藏对应分组
- 全选/全不选的快捷交互（如「全部」chip 或再次全取消时恢复全部）

## Acceptance Criteria (evolving)

- [ ] 可多选采集器，列表实时过滤
- [ ] 默认视图与现状一致（全部显示）
- [ ] tsc 通过

## Out of Scope

- 时间/结果筛选、统计

## Technical Notes

- 复用 CollectLogView 现有分组逻辑，state 加一个 `Set<collectorId>`
