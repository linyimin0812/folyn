# PRD: JSON Diff 双列编辑器

## 背景

上一轮（08-02-json-diff-ui）把 Diff tab 改成 `[Json5CodeMirror 输入 | @git-diff-view DiffView]`：左栏可编辑候选，右栏是只读 diff 视图。用户反馈想要**两栏都可编辑**，diff 直接在两栏内实时显示（VS Code compare 风格）。

`@git-diff-view` 的 `DiffView` 是只读渲染，不支持两侧编辑。要实现双列编辑 + 内联 diff，需要换底座。

## 目标

把 DiffPane 从"左输入 + 右只读 diff"改成"左右两个可编辑 CodeMirror 编辑器 + 内联实时 diff 高亮（字符级）"。

## 范围

- 仅改 `apps/desktop/src/components/file-types/json/components/DiffPane.tsx`。
- 新增依赖：`@codemirror/merge`（CodeMirror 6 官方 merge 扩展，与仓库已有的 `@codemirror/view`、`@codemirror/state`、`@codemirror/lang-json` 同家族）。
- 不改 `Json5CodeMirror.tsx`、`DiffReviewPanel.tsx`、其它 tab。
- `@git-diff-view/*` 依赖保留（`DiffReviewPanel` 仍用）。

## 设计决策

### D1：用 `@codemirror/merge` 的 `MergeView`

**Why**：`@codemirror/merge` 是 CM6 官方的双栏 compare 扩展，原生支持两侧都可编辑 + 字符级内联 diff 高亮 + 滚动联动 + gap 装饰。替代自建（StateField + Decoration + diff 算法）需要 ~200 行，且重复造轮子。

**How**：在 DiffPane 内挂一个 `MergeView`，配置 `a`（左编辑器）和 `b`（右编辑器）。两个编辑器都用 `json()` 语言 + `json5LintSource`（复用 Json5CodeMirror 的 lint 扩展）。主题跟随 `useAppearanceStore` + `prefers-color-scheme`（沿用现有 resolvedTheme 逻辑）。

MergeView 的 lifecycle 不走 React — 用 `useRef` 持有实例，`useEffect` 挂载/卸载，外部 value 变化通过 `view.a.dispatch` / `view.b.dispatch` 同步（mirror Json5CodeMirror 的 external-value-sync 模式）。

### D2：左栏初值 = 文件内容，右栏初值 = 空

**Why**：用户明确选择"左栏 = 文件内容（右栏空白）"。打开 Diff tab 时左栏直接显示格式化的文件 JSON，用户在右栏粘贴候选，立即看到 diff。

**How**：DiffPane 内部维护 `leftText` / `rightText` 两个 state。`leftText` 初值 = `JSON.stringify(left, null, 2)`（`left` prop = `parsedValue`，来自父组件）。`rightText` 初值 = `''`。

`left` prop 变化（文件切换 / 文件内容外部变更）时，重置 `leftText` 为新的格式化值。这是"始终以文件为左栏基准"的语义 —— 左栏可编辑（scratch 性质），但文件切换会覆盖。语义与上一版的 textarea 一致（textarea 是 controlled，跟随 `rightInput` prop）。

`rightText` 完全本地 state，不回写父组件。Diff tab 关闭再打开时右栏内容丢失（scratch）—— 与上一版 `diffInput` 不持久化的语义一致。

### D3：字符级 diff 高亮

**Why**：用户明确选择"字符级（推荐）"。

**How**：`@codemirror/merge` 的 `MergeView` 默认就是字符级 diff —— 行级增删用背景色，行内字符级改动用更深的背景色标记。无需额外配置，默认 `diffConfig` 即可。若默认效果不足，再传 `diffConfig: { diff: diff }` 调整。

### D4：删除 Sort-both / Split-Unified toggle

**Why**：
- **Sort-both**：上一版 sort-both 是把 `left`（parsedValue）排序后再 stringify 作为 baseline。新设计两栏都是可编辑文本，sort-both 语义模糊（排序哪一栏？排序后写回编辑器？还是仅用于 diff 计算？MergeView 的 diff 直接来自编辑器 doc，无法"仅用于 diff"用排序后的值）。ponytail：删，不补。用户要排序可用编辑器自身的 Cmd-A + format（Json5CodeMirror 已有的 lint/format 流程在 DiffPane 不直接暴露，但本 PR 不解决 —— YAGNI，等用户提）。
- **Split-Unified toggle**：MergeView 本质是双栏 compare，没有 unified 模式。删。

### D5：保留 `+N -M` 统计徽章

**Why**：上一轮加的统计徽章有用，用户没说删。继续从 `diff` 包 `diffLines` 算（已验证 API 可用）。

**How**：`diffLines(leftText, rightText)` → 累加 `added.count` / `removed.count`。徽章在 toolbar 显示。与上一版逻辑相同，仅输入源从 `(baselineText, rightInput)` 改成 `(leftText, rightText)`。

### D6：DiffPaneProps 简化

**Why**：上一版 prop 有 `left` / `rightInput` / `sortBoth` / `onRightInputChange` / `onToggleSortBoth`。新设计：
- `left` 保留（格式化为左栏初值 + 文件切换时重置左栏）
- `rightInput` 删除（右栏完全本地 state）
- `sortBoth` 删除（D4）
- `onRightInputChange` 删除（右栏不回写父组件）
- `onToggleSortBoth` 删除（D4）

DiffPaneProps 只剩 `{ left: unknown }`。

父组件 `JsonFileViewerPreview.tsx` 同步清理：删除 `diffInput` / `sortBeforeDiff` state + 对应 handler，Diff tab 渲染分支只传 `left={parsedValue}`。

## 非目标

- 不实现 unified 单栏 diff 模式（MergeView 不支持，删 toggle）。
- 不实现"左栏编辑写回文件"（左栏是 scratch）。
- 不实现 sort-both / format-both 按钮（YAGNI）。
- 不改 `DiffReviewPanel`（另一个 surface，diff review 场景）。
- 不删除 `@git-diff-view/*` 依赖（`DiffReviewPanel` 仍用）。

## 验收

- [ ] 打开 Diff tab：左栏显示格式化的文件 JSON，右栏空白。
- [ ] 在右栏粘贴候选 JSON：两栏内立即出现字符级 diff 高亮（增行绿底、删行红底、行内字符改动更深背景）。
- [ ] 编辑左栏文本：diff 实时更新（左栏也可改）。
- [ ] 滚动联动：滚一栏另一栏跟随。
- [ ] Toolbar 显示 `+N`（绿）`-M`（红），随两栏编辑实时变化。
- [ ] 输入非法 JSON：行内出现错误 widget（沿用 Json5CodeMirror 的 lint 扩展）。
- [ ] 切换文件：左栏重置为新文件格式化内容，右栏清空。
- [ ] 主题切换（亮/暗）：两栏 + diff 装饰都跟随。
- [ ] 切到其它 tab 再切回 Diff：左栏仍是文件内容，右栏为空（scratch 不持久化）。
- [ ] `pnpm typecheck` 通过（`tsc -b`）。
- [ ] `pnpm test` 通过（含 `DiffPane.test.tsx` 重写以反映 MergeView 结构）。

## 技术笔记

- `@codemirror/merge` 的 `MergeView` 构造签名（v6）：
  ```ts
  new MergeView({
    a: { doc, extensions: [...] },
    b: { doc, extensions: [...] },
    diffConfig: ..., // 可选，默认字符级
    orientation: 'a-b' | 'b-a', // 可选
    // ...
  })
  ```
  具体 API 在实现时以本地 `node_modules` 里的 `.d.ts` 为准。

- MergeView 不暴露 React 组件 —— 与 `Json5CodeMirror` 同模式：`useRef<MergeView | null>` + `useEffect` 挂载 + `useEffect` 同步外部 value。ponytail：复制 ~20 行 mount 模式而非抽 `useCodeMirror6View` hook —— 仅 2 caller，第三个出现时再抽。

- 测试：`DiffPane.test.tsx` 需 mock `@codemirror/merge`（jsdom 跑不了真实 CM6 layout measure，与 Json5CodeMirror 的 `getClientRects` 上限同源）。stub `MergeView` 为一个注入两个 `<textarea>` 的 mock，断言 mount + value 同步 + stats 徽章。

- 依赖安装：`pnpm --filter @folyn/desktop add @codemirror/merge`。版本对齐其它 `@codemirror/*`（`^6.x`）。
