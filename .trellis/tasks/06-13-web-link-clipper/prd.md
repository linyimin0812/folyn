# Web Link Clipper

## Goal

输入 URL，通过 curl.md 获取页面 Markdown 内容，AI 生成标签和摘要，保存为 vault 中的笔记。支持三种触发方式，剪藏后自动打开笔记供审阅。

## Requirements

### 触发入口（3 种）

1. **ActivityBar clips 面板 + AI Panel Clip 模式**（和 Wiki 同级别功能项）
   - ActivityBar 新增 `clips` 面板 → 侧边栏展示已保存的剪藏列表
   - AI Panel 新增 `Clip` 聊天模式（与 Chat/Wiki 并列 tab）→ 专用工具栏 + URL 输入
2. **WebViewer「剪藏此页」按钮** — WebViewer 工具栏添加按钮，触发当前页面的剪藏
3. **AI Chat `/clip` 命令** — 在 AI 会话中输入 `/clip <url>` 触发剪藏

### 内容获取

- 使用 [curl.md](https://curl.md) API：`GET https://curl.md/<url>` → 返回优化 Markdown
- 一步解决获取 + HTML→Markdown 转换

### 保存

- 目录：`clips/`（vault 根目录下）
- 文件名：`clips/<date>-<slug>.md`
- 剪藏完成后自动在编辑器中打开生成的 .md 文件

### 文件格式

```markdown
---
title: "页面标题"
type: clip
url: "https://example.com/article"
tags: [react, server-components, performance]
clipped: 2026-06-13
---

## 摘要

AI 生成的一段话摘要...

## 内容

(curl.md 返回的 Markdown 正文)
```

### 在 Quill 内打开链接

- 已有 WebViewer + openWebTab 支持，无需额外开发
- clips 面板中点击 clip 条目可打开原始 URL（webview tab）

## Acceptance Criteria

- [ ] ActivityBar 新增 clips 面板图标，侧边栏展示已保存的剪藏文件列表
- [ ] AI Panel 新增 Clip 聊天模式 tab（与 Chat/Wiki 并列）
- [ ] Clip 模式下有 URL 输入框和「剪藏」按钮
- [ ] WebViewer 工具栏有「剪藏此页」按钮
- [ ] AI Chat 中输入 `/clip <url>` 可触发剪藏流程
- [ ] curl.md 获取页面内容成功时，AI 生成 tags + summary
- [ ] 生成结果保存为 `clips/<date>-<slug>.md`
- [ ] 保存后自动在编辑器中打开生成的笔记
- [ ] clips 面板点击条目可打开对应 clip 笔记或原始 URL
- [ ] curl.md 请求失败时显示友好错误提示

## Definition of Done

- Lint / typecheck 通过
- 现有功能无回归（Wiki、文件管理、AI Chat）
- 错误场景有兜底处理

## Out of Scope

- 批量剪藏（多个 URL 同时处理）
- 剪藏内容全文搜索
- 与 Wiki 系统联动（剪藏自动成为 wiki source）
- WebViewer DOM 提取（MVP 仅用 curl.md）
- 重复 URL 检测
- 剪藏前预览/编辑草稿

## Technical Approach

### 新增文件

| 文件 | 说明 |
|------|------|
| `services/clipService.ts` | 核心剪藏逻辑：调用 curl.md → AI 生成 → 保存文件 |
| `store/clipStore.ts` | Zustand store：剪藏列表、状态管理 |
| `components/sidebar/ClipsPanel.tsx` | 侧边栏剪藏文件列表 |
| `components/ai/ClipToolbar.tsx` | AI Panel Clip 模式工具栏 |

### 修改文件

| 文件 | 改动 |
|------|------|
| `components/shell/ActivityBar.tsx` | 新增 `clips` panel |
| `components/sidebar/Sidebar.tsx` | 新增 clips panel 渲染分支 |
| `components/ai/AiPanel.tsx` | 新增 `clip` chat mode tab |
| `store/aiStore.ts` | AiChatMode 增加 `'clip'` |
| `components/file-types/web/WebViewer.tsx` | 工具栏加「剪藏此页」按钮 |

### 核心流程

```
用户触发（3种入口）
  → clipService.clipUrl(url)
    → fetch(`https://curl.md/${url}`)  // 获取 Markdown
    → AI prompt: "为以下内容生成 tags 和 summary"
    → 组装 frontmatter + summary + content
    → vaultStore.createFile(`clips/<date>-<slug>.md`)
    → editorStore.openFile(path)  // 自动打开
```

## Technical Notes

- `apps/desktop/src/components/file-types/web/WebViewer.tsx` — existing web viewer
- `apps/desktop/src/store/editorStore.ts:230` — `openWebTab` implementation
- `apps/desktop/src/services/wikiIngestService.ts` — AI-driven content analysis pattern (reference)
- `apps/desktop/src/components/ai/AiPanel.tsx` — AI Panel with Chat/Wiki mode tabs
- `apps/desktop/src/components/shell/ActivityBar.tsx` — ActivityBar panel definitions
- `apps/desktop/src/store/wikiStore.ts` — Wiki store pattern (reference for clipStore)
- `packages/cli-adapter/` — existing AI adapter package
- [curl.md API](https://curl.md/docs/guide/api) — URL-to-Markdown service
