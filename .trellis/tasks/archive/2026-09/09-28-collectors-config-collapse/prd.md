# 采集器配置卡收起/展开，默认收起

## Goal

CollectorsSettings 里每个 CollectorCard 常驻展示全部内容（轮询行 + 配置表单 + footer），采集器多了以后页面很长。加收起/展开，默认收起。

## Requirements

* CollectorCard 标题行加 chevron 收起/展开开关，默认收起
* 收起时只显示标题行（名称/ID/模式徽标/冲突徽标/启用开关/卸载按钮 + chevron）
* 展开恢复现有全部内容（webhook endpoint、轮询行、配置表单、footer）
* 展开状态为组件本地状态，不持久化（刷新后回到默认收起）

## Acceptance Criteria

* [x] 默认渲染每个采集器仅标题行
* [x] 点击 chevron 展开显示完整配置，再点收起
* [x] 未展开时启用/轮询开关仍可操作（启用开关在标题行）
* [x] desktop tsc 绿

## Technical Approach

* `CollectorCard` 加 `const [open, setOpen] = useState(false)`，整个标题行可点击切换（卸载按钮/启用开关 stopPropagation），主体包进 `grid-template-rows` 折叠过渡（同 TimelineList 模式）；无独立 chevron 图标
* webhook endpoint / poll 行 / ConfigForm（及无 schema 时的 footer 行）包进折叠容器

## Out of Scope

* 展开状态持久化、采集器全局展开/收起按钮

## Technical Notes

* 关键文件：`apps/desktop/src/components/settings/CollectorsSettings.tsx`（CollectorCard）
