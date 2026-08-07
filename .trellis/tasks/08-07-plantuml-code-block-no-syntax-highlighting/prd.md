# PlantUML code block has no syntax highlighting

## Goal

Markdown 中 ```plantuml 代码块在预览（和导出 HTML）里没有语法高亮，应该至少对注释/字符串/关键字/`@startuml` 等做基础高亮，跟其他语言代码块视觉一致。

## What I already know

* `MarkdownPreview.tsx:579` 用 `rehype-highlight` (highlight.js 11.11.1) 处理代码块高亮，配置 `ignoreMissing: true` —— 未知语言静默跳过。
* highlight.js 11.11.1 内置 192 种语言，**不含 plantuml/puml/pu**（已验证：`hljs.getLanguage('plantuml')` 返回 false）。
* `CodeBlockExtension.ts:21-25` 已经把 plantuml + aliases 加入 fence 语言自动补全菜单（继承自插件 markdownCodeRenderer 列表），所以用户能在 ``` 后自动补全 `plantuml` —— 但补全后实际没高亮。
* PlantUML 插件（external trusted-tier）只提供 CodeMirror `plantumlLanguage`（Lezer 语法），用于 `.puml` 文件编辑器；与 highlight.js 的 grammar 格式不兼容，不能直接复用到 markdown 预览。
* `markdownCodeRendererAdapter` 允许插件注册一个 React 组件**替换**整个代码块（mermaid 就是这样），但那是替换为渲染图，不是给源码加语法高亮——不符合用户需求。
* CodeFileViewer (`code/CodeFileViewer.tsx:5-16`) 的 `EXT_TO_LANG` 也没 plantuml —— `.puml` 文件直接打开时走 `highlightAuto`，同样没正确高亮。

## Assumptions (temporary)

* 用户想要的是"代码块里有语法高亮颜色"，不是把 ```plantuml 块替换成渲染的 SVG 图。
* "够用就行"——基础高亮（注释/字符串/关键字/meta）即可，不必100%覆盖 PlantUML 全语法。
* 同一份 grammar 同时让 markdown 预览和 CodeFileViewer `.puml` 高亮受益。

## Open Questions

* （已解决）选 A：在 codebase 内置最小 plantuml hljs grammar，一处注册，markdown 预览 + CodeFileViewer 共用。

## Requirements (evolving)

* ```plantuml 代码块在 markdown 预览中显示语法高亮。
* 同一 grammar 也覆盖 ```puml、```pu 别名。
* `.puml` / `.plantuml` 文件在 CodeFileViewer 中也获得高亮（CodeFileViewer 的 `EXT_TO_LANG` 加映射）。
* 不引入未验证可用的第三方依赖。
* 不破坏其他语言代码块既有高亮。

## Acceptance Criteria (evolving)

* [ ] ```plantuml 代码块在 markdown 预览中显示注释/字符串/关键字/`@startuml` 高亮颜色。
* [ ] ```puml、```pu 别名同样高亮。
* [ ] `.puml` 文件直接打开（CodeFileViewer）有高亮。
* [ ] 既有 ```ts / ```js / ```python 等代码块高亮不变。
* [ ] `pnpm lint` / typecheck / 既有测试绿。

## Definition of Done

* 内置 plantuml grammar 注册逻辑 + 单测（注册后 `hljs.getLanguage('plantuml')` 返回 truthy，且 `hljs.highlight(...)` 输出含期望 className span）。
* Lint / typecheck / build green。
* 不改动 plantuml 插件本身。

## Out of Scope

* PlantUML 完整语法 100% 覆盖（skinparam 参数、`!include`、`!function` 等高阶特性）—— MVP 只覆盖常见构造。
* 用 plantuml 插件的 CodeMirror Lezer grammar 在 markdown 中渲染高亮——格式不兼容，重写代价大。
* 其他无 hljs grammar 的语言（dot/graphviz 等）—— 单独任务。

## Technical Notes

* 注册入口候选：`apps/desktop/src/components/file-types/markdown/MarkdownPreview.tsx` 模块级语句；或新建 `apps/desktop/src/services/highlightLanguages.ts` 集中管理第三方/自定义 grammar 注册。
* CodeFileViewer 改动：`apps/desktop/src/components/file-types/code/CodeFileViewer.tsx:5-16` `EXT_TO_LANG` 加 `plantuml: 'plantuml', puml: 'plantuml', pu: 'plantuml'`。
* highlight.js grammar 格式参考：`hljs.COMMENT(start, end)`、`hljs.QUOTE_STRING_MODE`、`hljs.C_NUMBER_MODE`、`{ className, begin, end }`。
* fence 自动补全已含 plantuml（`CodeBlockExtension.getAllLanguages` 合并 `listMarkdownCodeRendererLanguages`），无需改。

## Decision (ADR-lite)

**Context**: highlight.js 不内置 plantuml；npm 上 `highlightjs-plantuml` 包状态/可用性无法可靠验证；CodeMirror 的 plantuml Lezer grammar 与 hljs 格式不兼容无法复用。

**Decision**: 选 A——在 `apps/desktop/src/services/highlightLanguages.ts` 内置最小 plantuml hljs grammar，模块加载时注册一次（`hljs.registerLanguage('plantuml', ...)`）。MarkdownPreview 与 CodeFileViewer 共用同一份 grammar。

**Consequences**:
- grammar 覆盖率约 80% 常见 PlantUML 构造；冷门 skinparam 参数 / `!include` / `!function` 不高亮——可接受，后续按需扩展。
- 未来要加 dot/graphviz 等其他无 hljs grammar 的语言时，复用此文件追加。
- 一处注册，零运行时开销（hljs 内部 Map 查询）。

## Implementation Plan

* PR1（单步）：
  1. 新建 `apps/desktop/src/services/highlightLanguages.ts`：定义 plantuml grammar + 模块加载时 `hljs.registerLanguage('plantuml', ...)` + 也注册 `puml`、`pu` 别名（hljs 的 `aliases` 字段）。
  2. `apps/desktop/src/components/file-types/markdown/MarkdownPreview.tsx`：`import '@/services/highlightLanguages'` 触发注册（side-effect import）。
  3. `apps/desktop/src/components/file-types/code/CodeFileViewer.tsx:5-16`：`EXT_TO_LANG` 加 `plantuml: 'plantuml', puml: 'plantuml', pu: 'plantuml'`。
  4. 新增最小单测 `highlightLanguages.test.ts`：注册后 `hljs.getLanguage('plantuml')` 非空；`hljs.highlight('@startuml\nparticipant Alice\n@enduml', { language: 'plantuml' }).value` 含 `hljs-meta` / `hljs-keyword` span。
  5. 跑 lint / typecheck / test。
