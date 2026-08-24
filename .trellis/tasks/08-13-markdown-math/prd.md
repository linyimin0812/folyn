# Markdown 数学公式支持（MathJax v3）

## Goal

让 mochi 桌面端（Tauri + React/TS）的 Markdown 全链路支持数学公式：编辑器侧加语法高亮与折叠，预览/chat/导出/思维导图统一管线渲染。不上 WYSIWYG，编辑器保持纯源码。

## Decisions (user-confirmed 2026-08-13)

经 `/mattpocock-skills:grill-me` grilling 会话确认的 9 项决策：

- **Q1 范围**：渲染 + 编辑器友好（B 档），不上 WYSIWYG
- **Q2 worktree + 任务**：从 master 切新 worktree（`worktree-08-13-markdown-math`）+ 新建 Trellis 任务
- **Q3 数学库**：MathJax v3（不用 KaTeX）
- **Q4 公式语法**：全开 —— `$...$` / `$$...$$` / `\[...\]` / `\(...\)` / `\$` 转义 / AMS 环境
- **Q5 编辑器侧**：A 档 —— 仅语法高亮 + 折叠，无 widget，无 MathJax 进编辑器
- **Q6 渲染管线**：全覆盖（预览 / chat / export / mmap）+ 统一 `renderMarkdown(opts)` 工厂
- **Q7 MathJax 打包**：本地整包打进前端 bundle（不走 CDN，不懒加载）
- **Q8 widget 渲染策略**：作废（Q5 已取消 widget）
- **Q9 统一管线 API**：双 API —— `renderMarkdownToReact` + `renderMarkdownToHtml`，共享 unified pipeline

## Hidden Work (已隐含承担)

1. **`\[ \]` / `\( \)` 自定义 remark 扩展**：remark-math 默认不认这俩，要写 micromark 扩展或预处理替换为 `$$/$`
2. **AMS 环境**：只支持"在 `$$` 内写 AMS"（MathJax 天然支持）；不写裸 `\begin{equation}` 识别插件（YAGNI）
3. **chat 流式重渲染**：MessageContent 内加 `useEffect` 在内容变更后 re-typeset（MathJax 异步）
4. **export HTML 自包含**：导出产物内联 MathJax CSS + 字体（符合 local-first）
5. **mmap/topicMarkdown**：思维导图节点空间小，需做字号缩放或仅渲染 inline

## Requirements

### R1 MathJax 接入

- [ ] `apps/desktop/package.json` 加 `mathjax` 依赖（v3 latest），整包打进前端 bundle
- [ ] 抽统一管线 `renderMarkdown(opts)`：`unified().use(remark-parse).use(remark-math).use(remark-rehype).use(rehype-mathjax, opts)`
- [ ] 双 API：`renderMarkdownToReact(md, opts): ReactNode` + `renderMarkdownToHtml(md, opts): Promise<string>`
- [ ] `\(...\)` / `\[...\]` 语法支持：micromark 扩展或预处理替换为 `$...$` / `$$...$$`

### R2 渲染管线全覆盖

- [ ] `apps/desktop/src/components/file-types/markdown/MarkdownPreview.tsx`：接 `renderMarkdownToReact`
- [ ] `apps/desktop/src/services/exportService.ts`：接 `renderMarkdownToHtml`，导出产物内联 MathJax CSS + 字体
- [ ] `apps/desktop/src/components/chat/MessageContent.tsx`：接 `renderMarkdownToReact` + `useEffect` re-typeset 处理流式
- [ ] `apps/desktop/src/components/file-types/mmap/topicMarkdown.ts`：接 `renderMarkdownToReact`，节点空间小做字号缩放

### R3 编辑器侧（CodeMirror 6）

- [ ] 新增 `apps/desktop/src/editor/extensions/MarkdownMathExtension.ts`：StreamLanguage 给 `$...$` / `$$...$$` / `\[...\]` / `\(...\)` 加 token 类型
- [ ] highlightStyle 注册对应配色（复用现有 `highlightStyle.ts`）
- [ ] `$$...$$` / `\[...\]` 视为 foldable 区段
- [ ] 括号配对走 CM 默认 closeBrackets 配置（`$` 加入配对列表）
- [ ] **不**装 widget，**不**调 MathJax 进编辑器

### R4 测试

- [ ] `MarkdownMathExtension.test.ts`：token 类型正确、边界（`\$` 转义、code 块内不识别）
- [ ] 统一管线单测：`$ x^2 $` / `$$\begin{equation}...\end{equation}$$` / `\[ ... \]` / `\( ... \)`
- [ ] export 自包含测试：导出 HTML 离线打开公式能渲染

## Constraints

- Tauri CSP 已放行 `'unsafe-eval' + 'unsafe-inline' + cdn.jsdelivr.net`（事实，无需改动）
- AGENTS.md：最简实现 + 长期架构，不留 stopgap
- ponytail：stdlib/已有依赖优先；删 > 增；最短可行 diff
