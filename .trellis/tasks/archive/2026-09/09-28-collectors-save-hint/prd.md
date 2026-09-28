# 采集器保存提示：未保存修改不生效于立即采集

## Goal

用户困惑：填了配置没点保存就「立即采集」，等于空配置采集。draft 型字段（allowAiSummary、github token 等）确实只在点 保存 后写入 store，而 runCollect 读的是 store。需要提示用户。

## Requirements

* ConfigForm 的 draft 与已存 config 有差异（dirty）时，在 footer 按钮区显示琥珀色提示「未保存的修改不会被立即采集使用」
* 无差异（含 email 账户/过滤 chips —— 它们是即时写入的，draft 同步更新）→ 不显示
* 保存后 dirty 消失

## Acceptance Criteria

* [x] 修改 draft 字段不保存 → 显示提示；保存后消失
* [x] email 账户编辑（即时写）→ 不显示
* [x] desktop tsc 绿

## Technical Approach

* `const dirty = JSON.stringify(draft) !== JSON.stringify(config ?? {})`（ponytail：键序由同源 spread 保证，误报无害）
* i18n 键 `activity:collectors.unsavedHint`（6 语言）

## Out of Scope

* 把 draft 全部改成即时写（表单草稿/保存交互是原型设计决定）

## Technical Notes

* 关键文件：`apps/desktop/src/components/settings/CollectorsSettings.tsx`（ConfigForm footer）、`runCollect` 读 store 佐证（runtime.ts:166）
