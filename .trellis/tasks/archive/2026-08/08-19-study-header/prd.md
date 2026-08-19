# Study 页面资料图标更换与移除 header 编辑按钮

## Goal

调整 study 页面资料（Materials）区块的两处 UI：
1. 将资料区块头部的 `SECTION_ICON` 替换为用户提供的书籍堆叠 SVG。
2. 移除资料区块 header 中的"编辑"按钮（调用 `openFile` 打开源文件的那个按钮）。

## What I already know

- `SECTION_ICON` 定义于 `apps/desktop/src/components/study/StudyMaterialsSection.tsx:49-54`，当前是一个单本书 outline 图标，使用 `stroke="currentColor"`。
- 在 header 中调用 `openFile` 的"编辑"按钮位于 `StudyMaterialsSection.tsx:163`，文案 key 为 `study:materials.edit`。
- 同样的 `openFile` 编辑按钮在 `StudyNotesSection.tsx:140` 也存在（笔记区块 header）。
- 每张资料卡内部的"编辑"按钮（`StudyMaterialsSection.tsx:251`，文案同样是 `study:materials.edit`）用于打开卡片内编辑表单，与 header 中的"编辑源文件"按钮语义不同，应保留。

## Assumptions (temporary)

- 用户提供的 SVG 保留原 `fill="#d4237a"` 颜色（不转 `currentColor`），因为用户明确给出该 fill。
- 用户只要求移除**资料区块 header** 的编辑按钮，不动笔记区块。待确认。
- i18n 文案 `study:materials.edit` 仍被卡片内编辑按钮使用，不能删除。

## Open Questions

（已全部解决）

## Requirements

- 替换 `SECTION_ICON` 为用户提供的 SVG（viewBox `0 0 1026 1024`，`fill="#d4237a"`）。
- 移除资料区块 header 中的 `openFile` 编辑按钮（第 163 行）。
- 笔记区块 header 的编辑按钮保持不变。

## Acceptance Criteria (evolving)

- [ ] 资料区块标题左侧图标显示为新书籍堆叠图标。
- [ ] 资料区块 header 不再有"编辑"按钮。
- [ ] 资料卡片内部的"编辑"按钮仍可正常打开编辑表单。
- [ ] 笔记区块 header 行为符合最终确认结果。

## Definition of Done

- 类型 / lint 通过（用户自行编译）。
- 卡片内编辑路径不受影响。
- i18n key 未误删。

## Out of Scope (explicit)

- 不修改卡片内的编辑/删除按钮。
- 不调整其它 section 图标。

## Technical Notes

- 入口文件：`apps/desktop/src/components/study/StudyMaterialsSection.tsx`
- SVG 内联即可，不抽组件。
