# Settings page hide topbar action icons

## Problem
打开设置页时，Topbar 右侧仍显示 AI 按钮、导出菜单等操作图标。这些操作只在编辑器上下文有意义，设置页无对应行为，应隐藏。

## Scope
隐藏 `currentPage === 'settings'` 时的以下 Topbar 右侧操作图标：
- AI 按钮（`tb-ai-btn`）
- ExportMenu

不隐藏：
- 语言切换、主题切换（偏好控件，与页面无关）
- WindowControls（窗口控制）
- View-mode 段、Terminal、Version history、Copy to vault：本就基于 activeTab / currentPage 条件渲染，设置页不显示，无需改动。

## Implementation
`apps/desktop/src/components/shell/Topbar.tsx`：用 `currentPage !== 'settings'` 包裹 AI 按钮与 `<ExportMenu />`。

## Out of scope
- 不动 ActivityBar、Sidebar。
- 不调整设置页内部布局。
