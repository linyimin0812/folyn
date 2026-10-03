# 采集记录页样式优化

## Goal

采集记录页（`CollectLogView.tsx`）目前视觉过于简单，需要在不改变数据逻辑的前提下提升页面质感与信息层级。

## What I already know

- 组件：`apps/desktop/src/components/activity/CollectLogView.tsx`（220 行），挂在 `ActivityPage.tsx` 的 `collectLog` 视图（max-w-[900px] 容器）
- 当前结构：按采集器分组的折叠手风琴 → 每条 Run 卡片（名称、时间、耗时、accepted/deduped 或 no-result 小 pill）→ 展开显示日志列表
- 现状不足：空状态是纯文本无图标；无加载态；无状态徽章组件；无统计摘要；视觉层级平
- 可复用的设计系统（`index.css`）：主题 token（`--panel --surf2 --brd --acc --green --amber --red`）、`.btn` 系列、`.diff-status-badge` 语义色徽章模式、`.chat-empty` 空状态模式
- 可参考的精致页面模式：`TimelineList.tsx`（可展开行 + `ACTIVITY_PALETTE` 图标配色）、`MetricsGrid.tsx`
- 数据结构：`CollectRunRecord { collectorId, collectorName, startedAt, finishedAt, accepted, deduped, outcome: 'ok'|'no-result', logs: string[] }`，最新在前，上限 100 条

## Assumptions (temporary)

- 仅样式/交互打磨，不改采集逻辑与数据结构
- 纯前端改动，不新增依赖

## Open Questions

（无 — 已确认仅做视觉打磨）

## Requirements

- 初始加载骨架屏（3 行 animate-pulse 占位）
- 空状态复用 `.chat-empty` / `.chat-empty-badge` 模式 + ScrollText 图标
- Run 卡片：状态圆点（green/amber）、信息层级重排、`cl-badge` 语义色徽章（新增=绿、去重=中性、无结果=amber）、去重为 0 时隐藏
- 分组手风琴头部：hover 反馈、运行次数徽章、右侧最近运行时间、chevron 旋转动画
- 日志列表改 DM Mono 等宽字体、标签大写字距样式
- 全部使用现有主题 token，不新增依赖

## Acceptance Criteria

- [x] 页面有加载骨架与带图标空状态
- [x] Run 卡片信息层级清晰，outcome 有语义色徽章
- [x] tsc --noEmit 通过
- [ ] 深浅色主题下目测正常（待用户在桌面应用验证）

## Out of Scope (explicit)

- 采集逻辑、存储、后端改动

## Technical Notes

- 见上方探索结果；i18n: `src/i18n/locales/zh/activity.json` `collectLog.*`
