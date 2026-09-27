# 报告生成跳转链接 + 桌宠通知开关

## Goal

1. 日报/周报/月报生成完成的横幅中，「已保存至 <path>」的路径文字变成可点击链接，点击即跳编辑器打开该报告文件（复用现有 openReportInEditor）。
2. 报告设置页新增开关控制「报告生成后发送桌宠通知」，默认启用。

## Requirements

- ActivityPage 生成完成横幅：路径文字为链接样式（下划线/悬停高亮），点击调用现有 openReportInEditor（打开文件并切到编辑器页）
- activityCollectorStore 新增持久化字段 `notifyPet: boolean`（默认 true）+ setter + hydrate 解析
- reports.ts notifyReportGenerated 由 notifyPet 门控（唯一调用方在 generateReport）
- ReportSettingsView 用现有 Toggle 原语加一行开关（label + 描述），即存即持久化
- 6 个 locale 补文案：savedTo 前缀化（savedToPrefix）、开关 label/description

## Acceptance Criteria

- [ ] 生成报告后，横幅中的路径可点击并跳转编辑器打开该文件
- [ ] 报告设置页开关默认开；关闭后生成报告不发桌宠通知，开启后恢复
- [ ] 开关状态持久化（重启不丢）
- [ ] 6 locale 文案齐全，i18n 测试通过

## Out of Scope

- 通知内容/点击行为变化（保持现有：点击通知打开报告）
- 报告合并/多 vault 相关功能

## Technical Notes

- ActivityPage.tsx:433（savedTo 横幅）、reports.ts:457（notifyReportGenerated）
- Toggle 原语：@/components/settings/primitives
- savedTo 键改为 savedToPrefix（无 {{path}} 插值，路径单独渲染为链接）
