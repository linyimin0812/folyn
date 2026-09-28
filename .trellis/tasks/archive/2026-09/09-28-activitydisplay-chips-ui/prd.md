# activityDisplay 声明式 chips —— 任意采集器可指定时间线行 UI 标识

## Goal

把 TimelineList 里硬编码的 `payload.mailbox` 邮箱徽标渲染升级为 manifest `activityDisplay` 声明式配置：任意采集器可在自己事件的 timeline 行上声明 chips（payload key + 徽标样式），宿主统一渲染。email collector 改为声明式使用。

## Requirements

* `activityDisplay` 条目新增 `chips: [{ key, badge? }]`：
  * `key` — 事件 payload 中的字段名（字符串值才渲染）
  * `badge` — 可选徽标样式；本次实现 `provider`（邮箱域名 → 品牌色字母徽标）；缺省为纯文本 chip
* TimelineList 行内按声明渲染 chips（替代硬编码 `payload.mailbox` 判断）
* email collector manifest 声明 `chips: [{ key: "mailbox", badge: "provider" }]`，行为与现状一致
* 未声明 chips 的采集器行为不变

## Acceptance Criteria

* [x] email 事件行显示 provider 徽标 + 邮箱（仅由 manifest 声明驱动，宿主无 email 特判）
* [x] 未声明 chips 的事件行渲染不变
* [x] `providerBadge` 单测保留；chips 解析有单测（`eventChips`）
* [x] desktop tsc + 相关测试绿；扩展重建

## Technical Approach

* `DisplayIndexEntry`（display 索引类型）加 `chips?: ChipDecl[]`，registry 从 manifest 透传
* TimelineList `renderEventRow`：`displayByType[e.type]?.chips` → 每个 key 取 payload 字符串 → badge=provider 时用 providerBadge，否则中性色圆点/无徽标 + 文本
* manifest 校验侧（如有 schema 校验）允许新字段

## Decision (ADR-lite)

**Context**: 行内富 UI 只能宿主渲染（扩展不注入组件）；硬编码 mailbox 是一次性 hack。
**Decision**: 声明式 chips，最小样式集（provider 徽标 / 纯文本），宿主按 payload key 渲染。
**Consequences**: 新采集器零宿主改动即可获得行标识；样式种类仍由宿主内置（枚举扩展需改宿主，安全边界不变）。

## Out of Scope

* 任意自定义颜色/图标资源、SVG 品牌真 logo
* 详情卡（detailFields 已覆盖）
* 时间线以外的视图（metrics/graph）

## Technical Notes

* 关键文件：`apps/desktop/src/components/activity/TimelineList.tsx`（providerBadge + 行渲染）、display 索引类型与 registry 透传处、`extensions/email-collector/src/manifest.json`
