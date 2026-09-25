# activity-report-ai

## Goal

报告落地 + AI（设计 §7.5/§7.6/§4.4 日报输入）：日/周/月报写入 vault、AI 摘要懒加载、桌宠通知联动。父任务：`.trellis/tasks/09-23-implement-activity-collection`。

## Requirements

- 「生成」按钮：按当前选中周期生成日报/周报/月报，复用 `getDailyDigestInput`（todayEvents + ongoingTasks 双路输入，措辞区分「完成/更新」vs「推进中：第 X/Y 天 无新增更新」）
- 报告写入：`活动记录/{日报|周报|月报}/` 路径规则、frontmatter（type: activity-report / period / generated_at）、核心直连 vault（editorIoService/vaultStore，不走扩展沙箱）
- 冲突处理：写入时记 content hash，重新生成时未改→整体覆盖；改过→末尾追加「## 重新生成于 …」段落
- UI：面板预览 + 「已保存至 {path}」+ 「在编辑器中打开」打开正常编辑器 tab
- 事件 AI 摘要：懒加载首次展开才生成，缓存写回 ai_summary；走 rig chat（chat.rs/rigChat）或 cli-adapter（实现时取接入成本更低者）；受「允许 AI 读取活动数据生成摘要」开关控制，关闭时详情面板该块直接不出现
- 桌宠通知：生成完 POST `127.0.0.1:17382/pet/action` 推送，点击跳回活动页

## Acceptance Criteria

- [ ] 三个周期报告生成并写入对应路径，可在编辑器打开编辑
- [ ] 手动改过再生成走追加，未改走覆盖
- [ ] AI 摘要首次生成后缓存，第二次展开不重复调用

## Out of Scope

- 报告导出 HTML（走既有 vault 导出管线，无需新代码）
- 隐私正则脱敏规则编辑 UI（子任务 2 留接口即可）

## Technical Notes

- 日报生成通道设计架构图标注 cli-adapter；事件摘要用 rig chat。两者实现时按现有桥接成本取舍，PRD 不锁死
