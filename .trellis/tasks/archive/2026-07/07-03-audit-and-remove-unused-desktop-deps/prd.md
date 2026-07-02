# audit and remove unused desktop deps

## Goal

审计 `apps/desktop/package.json` 的 47 个依赖，移除确认未使用的，减小 app 包体积。

## What I already know

- apps/desktop 有 47 deps。已知保留：file-viewer 系列、codemirror 系列（编辑器）、react/react-dom、zustand、tauri 插件（api/fs/dialog）、html2pdf.js（useExport）、d3-force（graph）、highlight.js + rehype-highlight（markdown）、remark/rehype/unified（markdown pipeline）、grapesjs（html 编辑器）。
- 待查可疑：`@excalidraw/excalidraw`、`mermaid`、`rehype-stringify`、`remark-breaks`、`remark-directive`、`remark-directive-rehype`、`@replit/codemirror-indentation-markers`、`@tauri-apps/plugin-shell`、`happy-dom` 与 `jsdom`（是否都用）、`@vitest/coverage-v8`、`@codemirror/lang-html/lang-json/language-data`、`grapesjs-*` 插件、`diff`、`@codemirror/lint/search/autocomplete/commands`。

## Requirements

- 逐个 dep：`grep -r "from '<pkg>'\|from \"<pkg>\""` 在 `apps/desktop/src` + 各 workspace src，并 `pnpm why <pkg>` 判断是否被其它依赖引用。
- 仅移除：零直接 import 且 `pnpm why` 显示无依赖者引用的包。
- 不移除：被其它 dep 作为 peer/依赖引用的、workspace 包（`@quill/*`）、构建/测试必需（vitest/typescript/happy-dom or jsdom 其一）。
- 每移除一个后 `pnpm install` 更新 lock，最后统一 tsc + vitest + vite build 验证。
- happy-dom 与 jsdom：查 vitest config/environment 用哪个，移除另一个。

## Acceptance Criteria

- [ ] 列出审计结果：每个 dep 的"使用/未使用/被引用"判定。
- [ ] 移除确认未使用的 deps，package.json + lock 更新。
- [ ] tsc + vitest + vite build 绿。
- [ ] 报告未移除但可疑的（需人工确认的）。

## Definition of Done

- tsc / vitest / vite build 绿。
- 移除清单与理由记录在 PRD/任务。

## Out of Scope

- 不替换大依赖为更轻替代（仅移除未使用）。
- 不动 workspace 包。
- 不动 src-tauri Rust 依赖。

## Technical Notes

- 工具：`pnpm why <pkg>` 看引用链；`grep -rn "from ['\"]<pkg>" apps/desktop/src`。
- 谨慎：`codemirror` meta 包可能被 `@codemirror/*` 隐式需要；`@codemirror/language-data` 可能被 language 包自动加载——用 `pnpm why` 确认。
