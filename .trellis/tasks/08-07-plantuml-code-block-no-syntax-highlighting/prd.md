# PlantUML code block has no syntax highlighting

## Goal

Quill 核心不应该硬编码 plantuml-specific 高亮逻辑。改为在 plugin SDK 增加一个 `contributes.highlightGrammars[]` contribution 点 + host 侧 `highlightGrammarAdapter`，让任何插件都能为 highlight.js 注册 grammar。PlantUML grammar 由 plantuml 插件（external repo）提供。

## What I already know

* `MarkdownPreview.tsx:579` 用 `rehype-highlight` (highlight.js 11.11.1) 处理代码块高亮，配置 `ignoreMissing: true` —— 未知语言静默跳过。
* highlight.js 11.11.1 内置 192 种语言，不含 plantuml/puml/pu。
* `CodeFileViewer.tsx:21` 取 `EXT_TO_LANG[ext]` 作为 lang；无映射则 `highlightAuto`。
* 现有 plugin SDK contribution 点：`commands / fileTypes / containers / features / tools / exporters / fileTemplates / keybindings / exportEnhancers / markdownCodeRenderers / editorLanguages` —— 没有"注册 hljs grammar"的点。
* `markdownCodeRenderers` 是替换整个代码块为 React 组件（mermaid 走这条路），不是给源码加语法高亮。
* `editorLanguages` 是 CodeMirror 语言（Lezer grammar），跟 highlight.js 不兼容，不能复用。
* `PluginModule` shape 在 `packages/plugin-sdk/src/contracts.ts`，manifest `ContributionPoints` 在 `packages/plugin-sdk/src/types.ts`。
* plugin-host `index.ts` re-exports SDK 类型；`trustedLoader.ts:118-130` wire 所有 adapter；adapter 模板见 `editorLanguageAdapter.ts`。
* 插件加载是异步的；rehype-highlight 处理 ```plantuml 块时若插件未加载则跳过（`ignoreMissing: true`）——markdown 重新渲染时（任何 keystroke）会再次尝试，加载完成后自然恢复。

## Decision (ADR-lite)

**Context**: 上一版方案（commit 014d16a）在核心 `apps/desktop/src/services/highlightLanguages.ts` 内置 plantuml grammar。用户反馈这把 plantuml 特例固化在 Quill 核心，应交给插件。

**Decision**: 选 A——回滚核心 grammar，加 `contributes.highlightGrammars[]` contribution 点。grammar 由 plantuml 插件提供。

**Consequences**:
- 核心零 plantuml 特例代码。`CodeFileViewer` 的 fallback 改为通用："若 ext 本身是 hljs 注册语言就用它"，让任何插件注册的 grammar 自动覆盖对应扩展名文件。
- 插件未加载时 ```plantuml 块无高亮（`ignoreMissing` 静默）；插件加载后再次渲染时生效。markdown 实时渲染，热路径无回归。
- 未来 dot/graphviz/其他无 hljs grammar 的语言都能靠插件补，零核心改动。
- PlantUML grammar 代码迁移到 plantuml 插件仓库（external），不在本仓库。本仓库只负责契约 + adapter。

## Requirements

* plugin SDK 新增 `HighlightGrammarContribution` 类型 + manifest `contributes.highlightGrammars[]` 字段 + `PluginModule.highlightGrammars` 导出映射 + `HighlightGrammarFn` 函数类型。
* host 侧 `highlightGrammarAdapter.ts`：解析 `entry` entry-ref → `hljs.registerLanguage(name, fn)`；deactivate 时 `unregisterLanguage`；foreign-plugin 守护；missing entry-ref warn + skip。
* `trustedLoader` wire 进 adapter。
* `CodeFileViewer.tsx` 改 fallback：`hljs.getLanguage(ext) ? ext : EXT_TO_LANG[ext]`，移除 plantuml 特例映射。
* 撤销前次 commit 014d16a 的核心改动：删除 `apps/desktop/src/services/highlightLanguages.ts` + 测试，移除 `MarkdownPreview.tsx` 的 side-effect import。

## Acceptance Criteria

* [ ] plugin SDK 导出 `HighlightGrammarContribution` + `HighlightGrammarFn` 类型。
* [ ] manifest schema 接受 `contributes.highlightGrammars[]`。
* [ ] `highlightGrammarAdapter` 注册 + 卸载 + foreign-plugin 守护 + missing entry-ref 警告（7 个单测全绿）。
* [ ] `trustedLoader` wire 进 adapter，activate 时调用、deactivate 时 dispose。
* [ ] `CodeFileViewer` 的 fallback 用 `hljs.getLanguage(ext)`，无 plantuml 特例映射。
* [ ] `pnpm lint` / typecheck / 既有测试绿。

## Out of Scope

* PlantUML grammar 实际代码（迁移到 plantuml 插件仓库）。
* 其他无 hljs grammar 的语言（dot/graphviz）—— 单独任务。
* 已加载插件的 grammar 在 markdown 第一次渲染时即生效的优化（异步加载 + 重新渲染已够用）。

## Technical Notes

* SDK 改动：`packages/plugin-sdk/src/types.ts`（`HighlightGrammarContribution` + `ContributionPoints.highlightGrammars`）+ `packages/plugin-sdk/src/contracts.ts`（`HighlightGrammarFn` + `PluginModule.highlightGrammars`）+ `packages/plugin-sdk/index.ts`（re-export）。
* Host 改动：`apps/desktop/src/services/plugin-host/highlightGrammarAdapter.ts`（新）+ `highlightGrammarAdapter.test.ts`（新）+ `trustedLoader.ts`（wire）+ `packages/plugin-host/index.ts`（re-export SDK 类型）。
* App 改动：`apps/desktop/src/components/file-types/code/CodeFileViewer.tsx`（fallback + 移除 plantuml 映射）+ `apps/desktop/src/components/file-types/markdown/MarkdownPreview.tsx`（移除 side-effect import）+ 删除 `apps/desktop/src/services/highlightLanguages.ts` + 测试。
* 插件 manifest 示例（在 plantuml 插件仓库做，不在本仓库）：
  ```json
  { "contributes": { "highlightGrammars": [
    { "name": "plantuml", "aliases": ["puml", "pu"], "entry": "plantumlGrammar" }
  ]}}
  ```
  插件 module 导出：
  ```ts
  export const highlightGrammars = {
    plantumlGrammar: (hljs) => ({ name: 'PlantUML', aliases: ['puml','pu'], ... })
  };
  ```
