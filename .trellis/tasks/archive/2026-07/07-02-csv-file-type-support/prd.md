# csv file type support

## Goal

新增 CSV 文件类型：`.csv` 文件在 Quill 中可编辑（CodeMirror raw 文本）+ 表格预览 + 分屏，同 markdown 体验。

## What I already know

- `components/file-types/registry.ts` 用 `import.meta.glob('./*/index.ts')` 自动加载——加 `csv/index.ts` 即注册。
- markdown handler 是模板：`supportedViewModes: ['split','edit','preview']` + `useCodeMirror: true` + `Preview`。WorkArea 据 `useCodeMirror`/`Preview`/viewMode 渲染 CodeMirror/Preview/split。
- 无 csv 解析库 → 手写 RFC-4180 parser。
- `getFileTypeIcon('csv')` 落到 DefaultFileIcon（MVP 可接受，不加专用图标）。

## Requirements

- 新建 `components/file-types/csv/index.ts`：handler `id:'csv'`、`extensions:['csv']`、`supportedViewModes:['split','edit','preview']`、`needsFileContent:true`、`useCodeMirror:true`、`Preview: CsvTablePreview`、`icon: getFileTypeIcon('code')`（暂用 code 图标，或 DefaultFileIcon）。
- 新建 `components/file-types/csv/CsvTablePreview.tsx`：`PreviewProps`（content/filepath/vaultRoot），解析 CSV → 渲染只读 HTML 表格（首行表头 styling，Tailwind + 现有色 token）。空内容/解析异常降级提示。
- 新建 `utils/csvParse.ts`（或 `features/.../csvParse.ts`）：纯函数 `parseCsv(raw: string): string[][]`，RFC-4180：支持引号字段、`""` 转义引号、字段内逗号、字段内换行、末尾空行。不抛错（异常输入返回已解析部分）。
- 单测：`csvParse.test.ts` 覆盖标准/引号/转义/字段内逗号/字段内换行/空行/空输入；`CsvTablePreview.test.tsx` 渲染表格与降级（用 renderToString 范式）。

## Acceptance Criteria

- [ ] 打开 .csv → 表格预览；edit 模式 CodeMirror 编辑 raw；split 分屏。
- [ ] 引号/逗号/换行字段解析正确。
- [ ] 编辑 raw 后预览同步（content prop 变化即重渲染）。
- [ ] 空文件/非法 CSV 降级不崩。
- [ ] 单测覆盖解析器与预览。
- [ ] tsc + vitest 绿。

## Definition of Done

- tsc / vitest 绿；单测覆盖。
- 遵循 desktop frontend spec（named exports、`@/` alias、Tailwind 色 token、复用 file-types 约定）。

## Technical Approach

- handler 仿 markdown：`useCodeMirror:true` 让 WorkArea 提供 CodeMirror 编辑 raw；`Preview:CsvTablePreview` 提供表格；split 自动由 WorkArea 拼装（`showSplitResizer`）。
- `parseCsv` 状态机：逐字符遍历，跟踪 in-quotes，遇 `"` 切换；`""` → 字面 `"`；行结束按未在引号内的 `\n` 切分。返回 `string[][]`。
- `CsvTablePreview`：`useMemo(() => parseCsv(content), [content])` → 渲染 `<table>`；首行 `<thead>`，其余 `<tbody>`；横向滚动 `overflow-x-auto`。

## Out of Scope

- 不加 papaparse 或其它 csv 依赖。
- 不做可编辑单元格（inline cell editing）。
- 不加 csv 专用文件图标（用 code 图标或默认）。
- 不做 CSV 导入/导出/排序/筛选。

## Technical Notes

- 参考：`components/file-types/markdown/index.ts`、`MarkdownPreview.tsx`、WorkArea 渲染逻辑（`showCodeMirror`/`showPreview`/`showSplitResizer`）。
- 测试范式：`react-dom/server` `renderToString`（无 @testing-library/react 依赖，match 现有 file-types 测试）。
