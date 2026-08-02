# PRD: JSON Diff UI 重新设计

## 背景

JSON 文件查看器的 Diff 标签当前由 `apps/desktop/src/components/file-types/json/components/DiffPane.tsx` 实现：toolbar + `<textarea>`(40%) + `<DiffView from @git-diff-view/react>`(60%) 三段纵向堆叠，全部挤在右侧窄栏里。问题：

1. **布局拥挤/比例死板**：40/60 固定，且整个 DiffPane 只占 `JsonFileViewerPreview` 的右侧栏（约窗口的 50% 宽），diff 视图横向被截，行宽受限。
2. **输入区太丑**：裸 `<textarea>`，无 JSON 语法高亮、无行号、无括号匹配，与左侧文件编辑器（`Json5CodeMirror`，CodeMirror 6 全功能）体验割裂。
3. **缺少 diff 摘要**：无 +N / -M 行数统计。
4. **缺少错误反馈**：候选 JSON 解析失败时输入区不显示错误位置。

## 目标

重新设计 DiffPane，提升可读性与可用性，同时最小化新增代码（复用现有组件）。

## 范围

- 仅改动 `apps/desktop/src/components/file-types/json/components/DiffPane.tsx` 及 `JsonFileViewerPreview.tsx` 中 Diff tab 的渲染分支。
- 不改动 `@git-diff-view` 库本身、`DiffReviewPanel`、其它 tab。
- 不引入新依赖。

## 设计决策

### D1：Diff 标签激活时，DiffPane 占满整个预览区行（隐藏左侧文件编辑器）

**Why**：用户明确选择"占满整行（推荐）"。并排 `[输入 | diff]` 在窄栏里会挤；占满整行后两侧各得 ~50% 窗口宽，diff 不再被截。

**How**：在 `JsonFileViewerPreview.tsx` 中，当 `activeTab === 'diff'` 时，跳过 `editorFlex` 左栏 + 拖拽分隔条 + 右栏的外层结构，直接渲染 `<DiffPane>` 占满 `min-h-0 flex-1`。其它 tab 保持现有双栏布局。

### D2：DiffPane 内部为可拖拽的横向 split `[输入 | diff]`

**Why**：用户明确选择"并排：左输入 右 diff（可拖拽分隔）"。

**How**：复用 `JsonFileViewerPreview.tsx` 已有的 split-pane drag-to-resize 模式（`splitDragging` ref + document mousemove/mouseup），但改为横向。默认 50/50。`min 0.3 / max 0.7` 钳制（与现有竖向 0.2/0.8 对齐原则一致，但横向 diff 视图更需要平衡）。

### D3：输入区从 `<textarea>` 换为 `Json5CodeMirror`

**Why**：用户痛点之一是"输入区太丑（裸 textarea）"。`Json5CodeMirror` 已在本仓库（`apps/desktop/src/components/file-types/json/editor/Json5CodeMirror.tsx`），自带 `@codemirror/lang-json` 高亮、`json5LintSource`（300ms 防抖的 JSON5 linter）、`errorInlineWidgetExtension`（行内错误 widget）、`bracketMatching`、`indentUnit`、`searchKeymap`。复用即覆盖"语法高亮 + 错误高亮 + 括号匹配"三个诉求，零新增代码。

ponytail: 不新建一个"轻量 CodeMirror for diff input"——`Json5CodeMirror` 的 search/autocomplete 在 diff 输入场景无害，且文件级 lint 错误反馈正是用户要的。重写一个 trimmed 版本是多余的。

`onSave` prop 不传（Cmd-S 在 diff 候选输入场景无意义）。`key` 用 `diff-input-${filePath}` 保证文件切换时重建。

### D4：Toolbar 增加 diff 摘要：`+N -M`

**Why**：用户明确选择"diff 摘要统计（+/-/改动行数）"。

**How**：`@git-diff-view/core` 的 `DiffFile` 在 `buildSplitDiffLines()` / `buildUnifiedDiffLines()` 后暴露 `diffLines: DiffLineItem[]`，每项 `type` 为 `DiffLineType`（`Context=0 / Add=1 / Delete=2 / Hunk=3`）。在 `useMemo` 内遍历 `diffFile.diffLines` 计 `add` / `del`，渲染为 toolbar 上的 `+{add}` (绿) / `-{del}` (红) 徽章。

`DiffPaneProps.onRightValueChange` 已存在但当前 unused——保留接口不动（不删 prop，避免在重设计 PR 里触动父组件签名）。

### D5：错误高亮 = Json5CodeMirror 的内建 linter

**Why**：用户明确选择"错误高亮（输入区解析失败时）"。

**How**：`Json5CodeMirror` 已挂载 `linter(json5LintSource, { delay: 300 })`，JSON5 语法错误会以 CodeMirror 内建 lint marker + `errorInlineWidgetExtension` 行内 widget 显示。无需新增逻辑。

候选输入解析失败时，diff 区会显示空 diff 或全增（候选全部被识别为新增行）——这是 `generateDiffFile` 的既有行为，不视为本 PR 范围。

## 非目标

- 不实现改动跳转导航（上/下一处改动）——未选择。
- 不实现"复制 diff 结果"按钮——未选择。
- 不在 diff 区做语法 token 高亮定制——沿用 `@git-diff-view` 默认（已通过 `file.initTheme(resolvedTheme)` 跟随主题）。
- 不改动 `DiffReviewPanel`——它是另一个 surface，diff review 场景，需求不同。

## 验收

- [ ] 切换到 Diff 标签时，左侧文件编辑器消失，DiffPane 占满整行。
- [ ] DiffPane 内左半为 CodeMirror 输入区（带 JSON 高亮），右半为 git-diff-view diff 视图，中间可拖拽分隔。
- [ ] 默认 50/50，拖拽范围钳制在 30%~70%。
- [ ] Toolbar 显示 `+N`（绿）和 `-M`（红）徽章，数字随候选输入实时变化。
- [ ] 在输入区故意输入非法 JSON（如 `{foo:}`），300ms 后行内出现错误 widget。
- [ ] 切回其它 tab（Input/Query/Convert）恢复双栏布局。
- [ ] 主题切换（亮/暗）输入区与 diff 区都跟随。
- [ ] `pnpm typecheck` 通过；`pnpm test` 通过（含现有 `DiffPane.test.tsx`，必要时更新以反映新结构）。

## 技术笔记

- `DiffPane.test.tsx` 当前断言三段堆叠结构（textarea + DiffView）；新结构是横向 split + CodeMirror。需重写该测试。
- `Json5CodeMirror` 的 `useEffect` mount-once 模式要求 `key` 在文件切换时变化——父组件已用 `key={editor-${filePath}}` 模式，沿用。
- 横向 split-pane drag 模式可从 `JsonFileViewerPreview.tsx` 复制并改为 `getBoundingClientRect().height` + `e.clientY`。ponytail：复制 ~15 行而非抽 `useSplitPane(dimension)` hook，仅 2 个 caller（竖向 editor/tree + 横向 diff/input），抽 hook 收益不足；第三个 caller 出现时再抽。
