# 编辑态背景与阅读态一致

## Goal

知识页「编辑知识页」进入的编辑态背景是 `bg-surf`（`TopicReader.tsx` 编辑分支），阅读态容器是 `bg-panel`——切换时背景跳变。改为一致。

## Requirements

* 编辑分支外层容器的 `bg-surf` 改为 `bg-panel`（与 `kb-reader bg-panel` 同底）。
* 只改背景类；编辑器列布局、CodeMirror 自身样式不动（`.cm-editor` 若有自己的背景色，确认不与新背景冲突——以视觉上与阅读态无缝为准）。

## Acceptance Criteria

* [ ] 阅读 ↔ 编辑切换背景无跳变。
* [ ] knowledge 组件测试全绿。

## Out of Scope

* 其他配色/主题调整。

## Technical Notes

* `TopicReader.tsx:169`（阅读 `bg-panel`）vs `:173`（编辑 `bg-surf`）。
* **排期**：多语言任务正在改 TopicReader.tsx（i18n 文案提取），本任务等其完成提交后再实现，避免同文件冲突。
