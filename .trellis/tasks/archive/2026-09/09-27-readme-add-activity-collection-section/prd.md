# README: add activity collection section

## Goal

README 目前没有活动采集能力的任何介绍。为 6 个语言版本 README 添加"Activity collection"章节（Why Folyn bullet + For Users 子章节），与现有章节风格一致。

## What I already know

* 功能形态（Explore 已核实）：
  - 本地采集写入 vault 内 SQLite，原生 "Activity" 页（ActivityBar → ActivityPage）
  - 采集器：window-activity-collector（前台窗口，macOS osascript / Windows FFI）、file-collector、github-collector、webhook-collector（本地 HTTP webhook）；采集器即扩展（`type: "collector"`）
  - 视图：Timeline / Relations（实体图）、Collectors 管理、采集历史
  - 报告：日报/周报/月报写成 vault 内 markdown 笔记（`activity_collection/` 下），正文可切换为 LLM 生成，完成后可桌宠通知
* README.md 结构：Why Folyn bullet 列表 + For Users 下每特性一个 `###` 小节 + 截图
* 无活动相关截图（docs/assets/screenshots/）；无活动相关 docs/*.md
* 6 个语言版本 README（en/zh/ja/fr/de/es）需保持同步

## Requirements

* Why Folyn 增加 1 条 activity collection bullet
* For Users 增加 `### Activity collection` 小节（与现有小节同风格：描述 + 无截图）
* 更新全部 6 个语言版本

## Acceptance Criteria

* [ ] 6 个 README 均新增内容且语义一致
* [ ] 事实准确（采集器列表、报告行为、本地存储）
* [ ] 不新增截图、不新增 docs 文件

## Out of Scope

* 截图（无素材）
* 活动采集详细文档页

## Technical Notes

* 功能代码：`apps/desktop/src/services/activity/`、`apps/desktop/src/components/activity/`、`apps/desktop/src-tauri/src/activity/`、`extensions/window-activity-collector|file-collector|github-collector|webhook-collector`
* i18n 用户可见措辞参考：`apps/desktop/src/i18n/locales/en/activity.json`
