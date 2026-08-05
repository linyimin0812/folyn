# 标签栏下拉面板移到编辑器内并加关闭按钮

## Goal

文件打开标签栏右侧的下拉图标当前弹出原生 NSMenu（`topbar_tablist_menu`）。
用户希望下拉内容直接渲染在编辑器区域内，并给面板增加关闭按钮，替代系统原生菜单。

## Requirements

- 点击 TabBar 右侧下拉图标时，在编辑器内容区上方渲染 HTML 下拉面板，不再调用原生菜单。
- 面板展示当前活动面板的打开文件：文件图标、文件名、未保存圆点、当前激活态。
- 面板内新增关闭按钮，可关闭整个下拉面板。
- 文件行保留单项关闭按钮；点击行切到对应标签页，点击“关闭所有标签页”关闭全部标签。
- 面板打开期间隐藏原生 webview，关闭后通过现有 `quill:overlay-closed` 机制恢复，避免网页遮挡面板。
- 移除不再使用的 `topbar_tablist_menu` 原生菜单命令及其事件转发。

## Acceptance Criteria

- [ ] 点击 TabBar 下拉图标在编辑器内打开文件列表面板，不出现系统菜单。
- [ ] 面板标题旁有关闭按钮，点击后面板关闭。
- [ ] 点击文件行可切换标签页；每行可单独关闭；底部可关闭所有标签页。
- [ ] web 标签页打开时面板仍完整可见，关闭面板后 webview 恢复显示。
- [ ] `topbar_tablist_menu` / `app://select-tab` / `app://close-all-tabs` 相关死代码已移除。

## Technical Approach

恢复 `TabBar` 为受控 HTML 下拉面板：TabBar 持有 `tabListOpen` 状态，面板沿用此前
HTML 下拉的列表结构，并新增面板头部的关闭按钮。打开时调用
`hideWebviewsForOverlay()`，关闭/点击外部/选择后派发 `quill:overlay-closed`。

## Out of Scope

- Topbar 的“+”原生菜单不改。
- 文件标签横向布局与 dirty 圆点位置不改。
- 编辑器打开/关闭逻辑不改。
