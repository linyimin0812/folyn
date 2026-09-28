# 实体图谱：组内节点 ≤5 点击展开为子节点，>5 才用侧栏

## Goal

同类邻居保持合并为聚合节点；点击聚合节点时，≤5 个成员以子节点形式在图内展开，>5 才用右侧栏。

## Requirements

* 同类型邻居保持合并为一个聚合节点
* 点击聚合节点：≤5 个成员 → 成员以**子节点**形式在图内展开（环绕聚合节点的 CHILD_R=135 圆环，均匀分布，细连线，点击成员即导航；再点聚合收起）
* >5 个成员 → 保持右侧成员栏（含到达时自动开第一个大组）
* 画布边界计算纳入子节点（外扩不裁剪）；Esc / 导航 / 返回清空展开状态

## Acceptance Criteria

* [x] ≤5 成员组：点击聚合节点在图内展开子节点（环布 + 连线），无侧栏
* [x] >5 成员组：聚合节点 + 侧栏行为不变
* [x] desktop tsc 绿

## Technical Approach

* `displayItems` 保持聚合（≥2）；新增 `fanGroups` state（expandedGroups 仅 >5 组用）
* 子节点中心 = 聚合中心 + CHILD_R·dir(聚合角 + π/k + j·2π/k)（半步偏移避免正对圆心）
* 画布 maxAx/maxAy 纳入子节点偏移；W/H 用 max(NODE, CHILD) 尺寸

## Decision (ADR-lite)

**Context**: 用户要「点击以子节点展开」而非取消聚合；旧的画布内扇形曾因重叠被移除。**Decision**: 聚合节点 + 子节点环。**Consequences**: 环上等距分布保证子节点互不重叠（chord ≥158 ≥ NODE_W）；与相邻轨道节点由径向差 135 分隔。

## Out of Scope

* 聚合/展开的显式切换开关

## Technical Notes

* 关键文件：`apps/desktop/src/components/activity/EntityGraphView.tsx`（fanGroups / fanChildren / 子节点渲染）
