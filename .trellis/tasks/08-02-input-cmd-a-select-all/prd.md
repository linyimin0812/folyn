# Cmd+A 全选在新增输入框失效

## 问题
新增的 `<input>`/`<textarea>` 输入框按 Cmd+A 无法全选。CodeMirror 编辑器内 Cmd+A 正常（其自带 `Mod-a` keymap），所以现象只出现在原生 HTML 输入元素上。

## 根因
`apps/desktop/src-tauri/src/commands/pet_menu.rs::build_app_menu` 的 Edit 子菜单只注册了 `cut()/copy()/paste()`，**缺 `select_all()`**。

macOS WKWebView 里，原生 `<input>`/`<textarea>` 的 Cmd+A 不是网页 JS 监听的，而是靠原生 Edit 菜单的 Select All 菜单项通过系统键盘事件路由到 webview 命中当前 responder。菜单里没有这一项，Cmd+A 在这些元素上就被吃掉，什么也不发生。

CodeMirror 不受影响，因为它的 `Mod-a` 是 JS keymap（`EditorView.tsx:274`），不依赖系统菜单。

## 历史
`07-03-disable-input-auto-capitalization` 任务曾识别同一根因并提出同样修复方案，但只有 `prd.md`、未执行实现。本次直接落地。

## 方案
在 `pet_menu.rs::build_app_menu` 的 Edit `SubmenuBuilder` 链上，在 `.paste()` 之后追加 `.select_all()`。一行改动。

```rust
let edit_menu = SubmenuBuilder::new(app, app_menu_label(locale, AppMenuLabel::Edit))
    .cut()
    .copy()
    .paste()
    .select_all()
    .build()
    .map_err(|e| e.to_string())?;
```

## 验收
- 任意 `<input>`/`<textarea>` 聚焦时按 Cmd+A 全选其内容。
- CodeMirror 内 Cmd+A 仍选全部（不回归）。
- Edit 菜单出现「Select All / 全选」项。

## 不做
- 不动前端，不加全局 keydown 监听。
- 不逐组件加属性。
- 不动 OS 键盘设置。

## 技术备注
- 文件：`apps/desktop/src-tauri/src/commands/pet_menu.rs:28-33`
- 关联：`apps/desktop/src/editor/EditorView.tsx:274`（CodeMirror 自带 keymap，本次不动）
- Tauri SubmenuBuilder API：`.select_all()` 是预定义菜单项，对应 `PredefinedMenuItem::SelectAll`。
