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

- 剪藏内容全文搜索
- 与 Wiki 系统联动（剪藏自动成为 wiki source）
- WebViewer DOM 提取（MVP 仅用 curl.md）
- 剪藏前预览/编辑草稿
- 批量剪藏的并行/后台队列模式（MVP 仅顺序批量）

## Scope Expansion: 重复 URL 检测 + 批量剪藏

> 以下两项原属 Out of Scope，现纳入本任务范围。基础剪藏流程与
> `ClipsPanel` 内的查重 UI 已实现；本扩展补齐缺口并新增批量能力。

### 现状（已实现）

- `clipStore.clipUrls: Map<url, clipPath>` + `findClipByUrl(url)` 已存在。
- `ClipsPanel.tsx` 面板输入框已查重，弹「该链接已经剪藏过」警告，
  选项为「重新生成（覆盖）/ 取消」。

### 缺口（本扩展要补）

- `/clip <url>` 命令（`AiPanel.tsx`）未查重，直接 `clipUrl(url)`。
- WebViewer「剪藏此页」按钮（`WebViewer.tsx`）未查重，直接 `clipUrl`。
- 警告缺少「打开已有」选项（目前仅覆盖/取消）。

### 批量剪藏（方案 A：顺序批量，已确认）

- 入口：`ClipsPanel` 新增「批量剪藏」模式，textarea 一行一个 URL。
- 运行：顺序逐个走现有 `generateClip` + `saveClip`，单 adapter 实例
  串行起停（避免多 CLI 进程 / rate limit）。
- 进度：列表展示每个 URL 状态（待处理/已完成/已跳过/失败）。
- 不为每个文件自动打开编辑器（避免一次开 N 个 tab）。

### 决策（ADR-lite）

- **批量运行模型 = 方案 A 顺序批量**：`ClipsPanel` 新增「批量剪藏」模式，
  textarea 一行一个 URL，顺序逐个走 `generateClip`+`saveClip`，单 adapter
  串行起停。进度列表展示 待处理/已完成/已跳过/失败。不自动打开文件。
- **批量遇重复 = 跳过 + 全局「强制重新剪藏」开关**：默认非破坏跳过并标注；
  勾选顶部开关则整体走 `saveClip(metadata, overwritePath)` 覆盖。
- **入口查重缺口补齐**：`/clip <url>` 命中重复 → 聊天回复「已剪藏过，已打开
  [标题]」并 `openFile` 已有笔记；`/clip! <url>` 强制重剪覆盖。WebViewer 按钮
  命中重复 → 弹确认框（打开已有 / 重新生成 / 取消）。`ClipsPanel` 单条警告
  补「打开已有」选项以保持一致。
- **URL 归一化**：小写 host + 去 fragment + 去尾斜杠，保留 query。新增
  `normalizeUrl(url)` 工具，`findClipByUrl` 与 `clipUrls` 写入均走归一化。
- **默认 fail-soft**：批量中单条无效/AI 失败 → 标失败继续；列表内自身重复 →
  去重第二条跳过；中途取消 → 完成当前条后停止；查重前 `loadClips()` 确保
  `clipUrls` 已加载。
- **额外纳入 MVP**：① 批量结果汇总导出 `__clips__/batch-<date>.md`
  （成功/跳过/失败 + 链接）；② 批量速率限制：可配置条间延迟（ms，默认 0）。

### Acceptance Criteria（本扩展新增）

- [ ] `findClipByUrl` 与 `clipUrls` 写入均经 `normalizeUrl` 归一化（小写 host、去 fragment、去尾斜杠、保留 query）
- [ ] `ClipsPanel` 单条剪藏警告含「打开已有 / 重新生成 / 取消」三项
- [ ] `/clip <url>` 命中重复时回复提示并打开已有笔记；`/clip! <url>` 强制覆盖重剪
- [ ] WebViewer「剪藏此页」命中重复时弹确认框（打开已有 / 重新生成 / 取消）
- [ ] `ClipsPanel` 新增「批量剪藏」模式：textarea 一行一个 URL
- [ ] 批量顺序执行，进度列表逐条显示 待处理/已完成/已跳过/失败
- [ ] 批量默认跳过重复并标注；顶部「强制重新剪藏」开关开启后整体覆盖
- [ ] 批量中单条无效/AI 失败不中断整批，标记失败继续
- [ ] 批量列表内自身重复去重，第二条标跳过
- [ ] 批量支持中途取消（完成当前条后停止）
- [ ] 批量完成后生成 `__clips__/batch-<date>.md` 汇总清单
- [ ] 批量支持可配置条间延迟（ms，默认 0）
- [ ] 查重前确保 `clipStore.loadClips()` 已加载

### 实现计划（小步 PR）

- **PR1 — 归一化 + 单条查重一致性**：新增 `normalizeUrl`，`clipStore` 写入/查询
  走归一化；`ClipsPanel` 警告加「打开已有」；补测试。
- **PR2 — 入口查重补齐**：`/clip` + `/clip!` 命令分支、WebViewer 确认框；
  命中重复走 `openFile` / `overwritePath`。
- **PR3 — 批量剪藏**：`ClipsPanel` 批量模式 UI + `clipStore` 批量动作（顺序、
  跳过/强制、fail-soft、取消、条间延迟）+ 结果汇总导出；补测试。

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
