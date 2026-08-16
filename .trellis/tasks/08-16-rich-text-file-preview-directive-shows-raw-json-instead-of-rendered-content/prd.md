# PRD: rich-text file-preview directive shows raw JSON instead of rendered content

## Problem

当 markdown 文件中通过 `:::file-preview{src="./xxx.rt"}` 指令内联预览一个 `.rt`（富文本）文件时，预览区域显示的是磁盘上的原始 JSON 字符串（tiptap doc 的 `JSON.stringify` 输出），而不是「此类型暂无预览」的提示。

## Root cause

`apps/desktop/src/components/file-types/markdown/MarkdownPreview.tsx:480-488` 的 `renderFile`：

```ts
const handler = ext ? getHandlerByExtension(ext) : undefined;
const Preview = handler?.Preview ?? getHandlerById('code')?.Preview;
if (!Preview) return null;
```

- `.rt` → 命中 `rich-text` handler（`apps/desktop/src/components/file-types/rich-text/index.ts`），但该 handler 只声明 `Editor`，无 `Preview`，`supportedViewModes: ['edit']`。
- `?? getHandlerById('code')?.Preview` 把「已识别但无 Preview」的情况回退到 code viewer，code viewer 把原始 JSON 当代码渲染。

该回退本意是给「未识别扩展名」兜底（让 `.xyz` 这类未知文件以源码形式展示），但实际把已识别但不支持预览的类型也兜到了 code viewer。

## Fix

**一行语义修正**：只在「无 handler 匹配」时回退到 code viewer；handler 匹配但无 `Preview` 则返回 `null`，让 `FilePreviewPlugin`（`packages/container-plugins/src/plugins/FilePreviewPlugin.tsx:174-178`）走「此类型暂无预览，可点击右上 code 图标查看源码」分支——该 UI 已存在，无需新增。

### Change

`MarkdownPreview.tsx:480-488`：

```ts
// before
const handler = ext ? getHandlerByExtension(ext) : undefined;
const Preview = handler?.Preview ?? getHandlerById('code')?.Preview;
if (!Preview) return null;

// after
const handler = ext ? getHandlerByExtension(ext) : undefined;
const Preview = handler?.Preview ?? (handler ? null : getHandlerById('code')?.Preview);
if (!Preview) return null;
```

语义：handler 存在但无 `Preview` → `null`（走「暂无预览」UI）；handler 不存在 → 兜底 code viewer。

## Scope

- 只改 `MarkdownPreview.tsx` 一行。
- 不改 `FilePreviewPlugin.tsx`（其「暂无预览」UI 已满足需求）。
- 不改 rich-text handler（不为本次新增 Preview 组件——用户已明确选择「显示不支持」而非「渲染富文本」）。
- 不改导出管线（`services/export/*` 的 file-preview HTML 导出复用同一 `renderFile` 路径，同样受益）。

## Out of scope

- 为 `.rt` 实现真正的只读富文本预览（用户明确否决）。
- 其他无 `Preview` 的 handler（如未来新增类型）的行为变化——本次让它们从「错误地显示源码」变为「正确地显示暂无预览」，这是期望的修正，不算回归。

## Acceptance

1. 在 markdown 中写 `:::file-preview{src="./test.rt"}\n:::`（`.rt` 文件存在、内容为合法 tiptap JSON），预览区显示「此类型暂无预览，可点击右上 code 图标查看源码」。
2. 点击右上 code 图标 → 切换到 source 视图 → 显示原始 JSON（保留现有源码查看能力）。
3. 未识别扩展名（如 `.xyz`）仍以 code viewer 显示源码（不回归）。
4. 已识别且有 `Preview` 的类型（如 `.md`、`.mmap`、`.dbml` 等）预览行为不变。
