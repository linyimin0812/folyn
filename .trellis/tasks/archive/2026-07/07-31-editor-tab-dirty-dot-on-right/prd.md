# editor-tab-dirty-dot-on-right

## Goal

将编辑器标签栏中"未保存"圆点从文件图标左侧移到文件名与关闭按钮之间（VS Code 风格），提升视觉一致性。

## Requirements

- `TabBar.tsx` 横向标签：dirty 圆点渲染在文件名之后、✕ 关闭按钮之前
- 下拉列表（tab list 弹层）保持现有顺序不变（图标→文件名→dirty 圆点→✕），仅横向标签调整
- 不改变颜色、尺寸、交互行为

## Acceptance Criteria

- [ ] 横向标签 dirty 时显示为 `[icon] filename • ✕`
- [ ] 非 dirty 时无圆点，布局无多余间隙
- [ ] 下拉列表布局不变

## Technical Approach

`apps/desktop/src/components/work-area/TabBar.tsx:37` 的 `{tab.isDirty && <span .../>}` 元素，从 `FileIcon` 之前移动到 `filename` span 与 `✕` span 之间。不涉及状态或样式 token 变更。

## Out of Scope

- 下拉列表圆点位置调整
- dirty 状态的视觉样式重设计

## Technical Notes

- 文件：`apps/desktop/src/components/work-area/TabBar.tsx`
- 当前布局（line 37-48）：`[dirty?] [icon] [name] [✕]`
- 目标布局：`[icon] [name] [dirty?] [✕]`
