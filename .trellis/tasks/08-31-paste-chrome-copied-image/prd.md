# paste chrome copied image

## Goal

让用户在 Chrome 浏览器右键"复制图片"后,在 Folyn 编辑器里 Cmd/Ctrl+V 能粘贴该图片(走现有 `ImagePasteDialog` 流程)。目前该路径无响应;截图文件保存后粘贴(Finder 文件引用)的路径是正常的,问题只出在"复制图片 blob"这一路。

## What I already know

- 文件引用粘贴路径(Finder Cmd+C → `read_clipboard_files` Rust 命令 → `runFilePasteImport`):`App.tsx:784` 的 window 级 capture paste 处理,缓存命中时 preventDefault + 导入文件;为空时 return,放行默认 paste。
- CodeMirror 编辑器级 paste 处理:`EditorView.tsx:369` `EditorView.domEventHandlers({ paste(event) {...} })`,扫 `event.clipboardData?.items`,发现 `image/*` 就 preventDefault + `getAsFile()` + `onImagePaste(file, previewUrl)` → 弹 `ImagePasteDialog`(`EditorPane.tsx:231`)。
- Rust `read_clipboard_files`(`clipboard_commands.rs:20`)用 arboard `get().file_list()`,只返回文件引用,clipboard 上只有 image/png blob 时返回空 vec。
- 已存在 `attachments.ts:handlePaste` 在 Chat 输入框里用同样 `clipboardData.items` 的 image/* 读取模式。

## Assumptions (temporary)

- 根因:macOS WKWebView 在 Chrome"复制图片"路径下合成的 `ClipboardEvent.clipboardData.items` 不包含 image File item(只暴露 text/html + text/uri-list),导致 CodeMirror 的 paste 处理找不到 image/* 项 → 走默认文本 paste(URL 当文本插入或无反应)。这是 webview 已知 quirk。
- 截图文件保存后粘贴走的是 Finder 文件引用路径,所以工作正常,与 webview ClipboardEvent 无关。

## Open Questions

- 实际复现时用户看到的是什么?粘贴后什么都没发生,还是插入了 URL/文本?这决定根因定位是"webview 不暴露 image item"还是"CodeMirror 处理没触发"。

## Requirements (evolving)

- Chrome "复制图片" → Folyn 编辑器 Cmd/Ctrl+V → 弹 `ImagePasteDialog`(与截图粘贴一致)。

## Acceptance Criteria (evolving)

- [ ] Chrome 复制图片后,在 CodeMirror 编辑器粘贴能弹 `ImagePasteDialog` 并完成上传/插入。
- [ ] 不破坏现有 Finder 文件粘贴路径(优先级:file ref > image blob)。
- [ ] 不破坏现有截图(Clipboard image/png)粘贴路径(如果它原本是工作的)。

## Definition of Done

- 单元/集成测试覆盖新路径(若走 Rust 命令,需对 arboard image 读取做最小自检)。
- Lint / typecheck / CI green。
- 行为变更说明(若改了 paste 处理顺序)。

## Out of Scope (explicit)

- 非 Chrome 来源的图片粘贴(其他浏览器、设计工具)—— 应该天然受益于同一修复,但不在本任务显式验收。
- 富文本编辑器(RichTextEditor)的图片粘贴(目前只看 CodeMirror 主编辑器)。

## Technical Notes

- 涉及文件:`apps/desktop/src/App.tsx`、`apps/desktop/src/editor/EditorView.tsx`、`apps/desktop/src/services/clipboardFiles.ts`、`apps/desktop/src-tauri/src/commands/clipboard_commands.rs`、`apps/desktop/src-tauri/src/lib.rs`(注册新命令)。
- 已有参考:arboard crate 已在用(`get().file_list()`),`get().image()` 可读 PNG bytes。
- 类似模式:`clipboardFilesCache` 在 window focus 时刷新,`onPaste` 读 cache → 同样可加一个 `clipboardImageCache`。
