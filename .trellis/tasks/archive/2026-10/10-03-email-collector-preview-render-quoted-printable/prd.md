# email-collector-preview-render-quoted-printable

## Goal

邮箱收集器时间线预览当前显示原始 MIME 正文（boundary、part 头、quoted-printable 编码）。改为：采集时在 Rust 端解析 MIME，存解码后的纯文本 snippet 与完整 HTML 正文；时间线 detail 提供"查看预览"入口，点击打开预览面板渲染 HTML。

## Requirements

* Rust `imap_fetch` 改为取完整 `BODY[]`（封顶 256KB），用 `mailparse` crate 解析：
  * text/plain 解码（QP/base64/charset）→ 存入 `snippet`，同时修复现有 snippet 含原始 MIME 的问题
  * text/html part（如有）解码 → 存入新 payload 字段（如 `body_html`），同样封顶
* 扩展 `emailEvents.ts` 透传 `body_html`；manifest `detailFields` 增加对应字段/入口
* 时间线 detail 增加"查看预览"按钮，点击弹窗/侧边面板渲染 HTML
* HTML 渲染走 webview 现有 dompurify 管线（时间线纯文本结构不动）
* 无 HTML part 的邮件：面板内回退显示解码后的纯文本

## Acceptance Criteria

* [x] 用户示例（Kilo 周报）时间线 snippet 显示可读文本，无 `=E2=86=92`、boundary、`Content-Type` 泄漏（新采集的邮件）
* [x] 点击"查看预览"打开面板，HTML 渲染可读（箭头、emoji 正常），链接可点击（外链走 external-open）
* [x] 纯文本邮件点预览显示解码后正文（payload.bodyHtml 回退为 snippet，面板按纯文本转义渲染）
* [x] 超 256KB 的邮件不崩溃，截断并可读（fetch 窗口截断，mailparse 容错）
* [x] HTML 经 sanitize（DOMPurify，EmailHtmlPreview.test.ts 断言）

## Definition of Done

* Tests added/updated（mailparse 解码 + display format）
* Lint / typecheck / CI green
* 预览行为变化已在 collector README/注释体现（如有）

## Technical Approach

1. Rust：`activity/mod.rs` 引入 `mailparse`，重写 `text_snippet` 逻辑 → 结构化 `{plain, html}`，经 `imap_fetch` 返回给扩展
2. 扩展：`emailEvents.ts` 写入 `payload.snippet`（解码后）与 `payload.body_html`
3. manifest：新 detailField 或 timeline 特殊 format（如 `html-preview`），`display.ts`/`TimelineList.tsx` 增加对应分支：渲染"查看预览"按钮
4. 新预览面板组件：dompurify + 现有 rehype 管线渲染，纯文本回退

## Decision (ADR-lite)

**Context**: 原实现 peek 2KB 原文不解析（mod.rs:569 ponytail 注释已知缺口）。
**Decision**: 采集时取全文（256KB 上限）Rust 端 mailparse 解析并存储；点击打开预览面板，webview 端 dompurify 渲染 HTML。用户选定完整 HTML 渲染 + 预览面板 + 采集时存储。
**Consequences**: 事件 payload 变大（HTML 正文）；新增 Rust 依赖 mailparse（MIME 解析的正确工具，手写解析更差）；查看历史不依赖 IMAP 在线。

## Out of Scope

* 附件抓取与展示
* 懒加载/按需取正文
* 邮件回复引用折叠、线程视图
* 远程图片自动加载（默认被 sanitize 掉）

## Technical Notes

* 关键文件：`apps/desktop/src-tauri/src/activity/mod.rs:566-700`、`extensions/email-collector/src/emailEvents.ts`、`extensions/email-collector/src/manifest.json:47-53`、`apps/desktop/src/components/activity/TimelineList.tsx:320-348`、`apps/desktop/src/components/activity/display.ts:152`
* 头解码已有 `decodeMimeHeader` (emailEvents.ts:70) 仅覆盖 RFC 2047，body 解码全新
* 桌面端已有 markdown 管线（remark-rehype、dompurify）可复用 sanitize 思路
