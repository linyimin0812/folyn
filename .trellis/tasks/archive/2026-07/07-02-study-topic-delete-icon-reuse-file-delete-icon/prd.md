# study: topic delete icon reuse file delete icon

## Goal

主题列表的删除图标从 inline trash svg 改用 `ThemeIcon name="delete"`（与文件/clip/analysis 删除图标一致）。

## What I already know

- `components/study/StudyTopicList.tsx:81-85`：`sw-topic-del` 按钮内是 inline trash svg（width 13）。
- 文件/clip/analysis 删除图标统一用 `<ThemeIcon name="delete" size={12|14} />`（`components/icons/ThemeIcon.tsx`）。
- `ContextMenu.tsx:164`、`ClipsPanel.tsx:102`、`AnalysisPanel.tsx:131` 均用 `ThemeIcon name="delete"`。

## Requirements

- `StudyTopicList.tsx` 的主题删除按钮：inline svg 替换为 `<ThemeIcon name="delete" size={12} />`（与 ClipsPanel/AnalysisPanel 一致）。
- 删除行为（confirm + deleteTopic）不变。

## Acceptance Criteria

- [ ] 主题删除按钮使用 `ThemeIcon name="delete"`。
- [ ] 删除流程不变。
- [ ] tsc + vitest 绿。

## Out of Scope

- 不改其他图标（header +、书 icon）。
- 不改 studyStore。

## Technical Notes

- 改 `apps/desktop/src/components/study/StudyTopicList.tsx` 一处 svg。
