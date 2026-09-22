# 翻译扩展弹窗输入框：Cmd/Ctrl+A 全选 + 左对齐

## Problem
- 弹窗（extension-tool 独立 JS realm）里 textarea 按 Cmd/Ctrl+A 无法全选：主窗口 App.tsx 的全局 keydown 兜底不跨 realm，而 Tauri Edit 菜单故意没有 Select All 项（加了会破坏 CodeMirror 的 Mod-a）。
- 输入框文字是 `text-justify`（两端对齐），多行文本视觉上不贴左，应改为左对齐。

## Solution
1. 在 ExtensionToolApp 已有的 document keydown 处理器里补上与 App.tsx:695 相同的 Cmd/Ctrl+A 分支（target 是 input/textarea 时 preventDefault + select）——覆盖该窗口整个 realm（翻译弹窗 + 共享 chrome 的输入框）。
2. TranslationPanel 输入 textarea 的 `text-justify` 改 `text-left`。

## Scope
- 不改主窗口行为；不动结果窗格对齐；不改第三方 iframe（独立 realm 无法触达）。

## Acceptance
- 打开翻译弹窗，输入多行文字，Cmd+A 全选，文字左对齐。
