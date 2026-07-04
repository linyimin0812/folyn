# Disable input auto-capitalization + Cmd+A select all

## 问题
1. 桌面端所有输入框（`<input>`/`<textarea>`/CodeMirror）首字母被自动大写，用户不想要。
2. 输入框里 Cmd+A 不能全选。

## 根因
1. `apps/desktop/index.html` 已在 `<html>` 上设 `autocapitalize="off"`，但 Tauri (WKWebView, macOS) 对 `<html>` 级属性的继承不可靠；需逐元素强制 `autocapitalize="off"`（顺带 `autocorrect="off"`、`spellcheck="false"`）。
2. `apps/desktop/src-tauri/src/lib.rs` 的 Edit 菜单只注册了 `cut/copy/paste`，**缺 `select_all()`**。macOS 上 Cmd+A 是靠 Edit 菜单的 Select All 项路由到 webview 文本框的，缺项导致 Cmd+A 在输入框失效。

## 方案
- **Rust**：Edit 菜单补 `.select_all()`。恢复 Cmd+A 在所有 webview 文本框（input/textarea/CodeMirror/contenteditable）的原生全选。
- **前端**：在 `App.tsx` 加一个全局 effect，用 MutationObserver 对所有现存及新增的 `input`/`textarea`/`[contenteditable]` 强制 `autocapitalize="off"`、`autocorrect="off"`、`spellcheck="false"`。保留 `<html autocapitalize="off">` 作为兜底。

## 验收
- 任意输入框输入英文小写单词，首字母不再被自动大写。
- 焦点在任意 input/textarea 时按 Cmd+A 全选其内容；CodeMirror 内 Cmd+A 仍选全部（不回归）。

## 不做
- 不动 OS 级键盘设置。
- 不给每个组件逐一加属性（用全局 Observer 统一处理）。
