# Presentation Mode (演示模式, Yuque-style)

## Goal

为 Folyn 增加演示模式：全屏沉浸式阅读/放映当前 Markdown 文档，参考语雀演示模式。

## Requirements (final, per user feedback during implementation)

* 进入演示模式：全屏 overlay 覆盖整个应用
* 首屏为文章标题页（文档首个标题，居中、大字号），向下滚动直接进入正文——不做幻灯片分页
* 正文整篇滚动查看；←/→ 按视口滚动，PgUp/PgDn/Home/End 原生滚动（滚动容器挂载时聚焦）
* Esc 退出（无 × 按钮——按用户要求删除）
* 进入时顶部显示提示「若要退出全屏模式，请按 ESC」，3 秒淡出，i18n 六语言（editor:presentation.exitHint）
* 演示期间隐藏桌宠 OS 窗口，退出时经 Rust `show_pet_if_hidden` 恢复，不改动用户桌宠开关偏好
* 字体放大（正文 19px，代码块/表格 ×1.36），内容宽度 1280px
* 入口：命令面板 `action.presentation-mode`、PreviewPane 工具栏按钮、可重绑快捷键（默认 ⌘/Ctrl+Shift+F5，prefsStore `presentationMode`，设置页显示且支持自定义）

## Acceptance Criteria

* [x] 三个入口都能进入演示模式；Esc 退出并恢复原界面
* [x] 标题页居中显示，滚动进入正文
* [x] 数学公式、代码高亮、图片、mermaid 正常渲染（复用 MarkdownPreview）
* [x] ESC 提示多语言显示并自动淡出
* [x] 桌宠进入时隐藏、退出时恢复
* [x] 快捷键设置页可重绑演示模式快捷键，行序与专注模式相邻

## Definition of Done

* tsc / 相关测试通过；用户已在应用中手动验证全部行为

## Technical Approach

* `apps/desktop/src/components/work-area/PresentationOverlay.tsx` — 全屏 overlay，复用 MarkdownPreview
* `presentationMode` 状态在 `editorViewState.ts`（toggle 带 markdown 守卫）
* 快捷键走 prefsStore ShortcutItem + `eventMatchesShortcut`（cursorSync 同款模式）
* `.presentation-mode` CSS 类做字号/宽度放大

## Decision (ADR-lite)

**Context**: 初版按标题切分幻灯片（splitSlides），用户反馈后改为标题页 + 整篇滚动。
**Decision**: 不分页；标题单独一页居中；其余滚动。splitSlides 已删除。
**Consequences**: 更简单、贴近语雀阅读体验；将来要真幻灯片放映可基于 extractHeadings 重建。

## Out of Scope

* 幻灯片分页 / 页码
* 演示者视图 / 演讲者备注、导出、动画
