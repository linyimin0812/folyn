# 报告设置添加"默认提示词"按钮

## Goal

在报告设置页（ReportSettingsView）的日报/周报/月报 prompt 输入框右上角添加"默认提示词"按钮，点击后将默认提示词填入输入框（保存到 reportConfig.prompts），降低用户写 prompt 的门槛。

## What I already know

- UI：`apps/desktop/src/components/activity/ReportSettingsView.tsx` — period tabs + 一个共用 textarea（`value=reportConfig.prompts[period]`，onChange 即存 store）
- LLM 数据上下文（`services/activity/reports.ts` buildLlmContext）：Metrics 列表、Events 时间线（时间·类型·标题·摘要）、Ongoing tasks（仅日报）——用户 prompt 是指令，数据追加在其后
- i18n：`apps/desktop/src/i18n/locales/{zh,en,es,fr,ja,de}/activity.json` 的 `reportSettings.*`
- 默认 reportConfig：prompts 全空 → 确定性模板路径

## Requirements

- prompt 输入框右上角（label 行右侧）添加「默认提示词」小按钮
- 点击 → 将该周期的默认提示词填入 textarea（经 setReportPrompt 持久化）
- 默认提示词按周期区分（日报含进行中任务，周报/月报侧重汇总趋势）

## Acceptance Criteria

- [ ] 三个周期 tab 下按钮均可见，点击后对应默认提示词出现在输入框内并持久化（切 tab/重开页面不丢）
- [ ] 输入框已有内容时点击 → 直接覆盖（已确认）
- [ ] 6 个 locale 的按钮文案与默认提示词文案齐全

## Out of Scope

- prompt 变量/模板系统
- 多套预设提示词选择

## Technical Notes

- 按钮放 promptLabel 行的右侧（flex justify-between），样式复用现有 `btn btn-sm` 或 report 页小按钮风格
- 默认提示词文案放 i18n（每语言一份，语言即用户报告语言）
