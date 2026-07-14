# Thinking notes — mind-map file type (`.mmap`)

## Goal

新增「思维笔记」文件类型 `.mmap`：源文本以 Markdown bullet list 存储，预览渲染为可编辑思维导图（mind-elixir）；源 ↔ 画布双向同步，画布编辑通过 `onChange` 写回文件。

## Requirements

- **R1 文件类型注册**
  - 新 handler 目录 `apps/desktop/src/components/file-types/mmap/`，包含 `index.ts` 与 `MmapFileViewerPreview.tsx`。
  - `extensions: ['mmap']`，`supportedViewModes: ['split', 'edit', 'preview']`，`defaultViewMode: 'split'`，`needsFileContent: true`，`useCodeMirror: true`，`Preview: MmapPreviewWithFallback`（lazy load + Suspense）。
  - `getFileIcon('mmap')` 新增图标（复用现有 icon 体系）。

- **R2 思维导图渲染（预览）**
  - 使用 `mind-elixir`（动态 import，只在打开 `.mmap` 时加载，避免进主 bundle）。
  - 源 → mdast → MindElixir node tree：`remark-parse`（已装）walk mdast，~40 行转换器。
  - Canvas 容器由 ref 挂载，`useEffect` 初始化 `new MindElixir({ el, data, ... })`，unmount 时 `mindArea.destroy()`。

- **R3 双向同步**
  - 画布 → 源：监听 MindElixir `onDataChange`/`input`，~30 行 serializer 把 node tree 写回 Markdown bullets，调 `props.onChange(md)`（写回路径已有，JSON viewer 同款）。
  - 源 → 画布：CodeMirror onChange → 重新 parse → diff 比较节点 id+text → 增量更新画布（避免重渲染抖动；MVP 可先全量重置，带 `ponytail:` 注释标 ceiling）。
  - 写回后通过 `editorStore.updateTabContent` 走现有 Cmd+S / 自动保存路径。

- **R4 Split 视图布局**
  - 左：CodeMirror（Markdown 模式，复用 `@codemirror/lang-markdown`）。
  - 右：mind-elixir canvas。
  - 复用 DBML 的 split 布局机制。

- **R5 最小可工作往返（MVP）**
  - 仅同步：节点文本 + 层级（parent/child）。
  - 暂丢：节点位置、折叠状态、颜色、链接、note body。`// ponytail: 元数据先丢，等需求出现再加 — 升级到 YAML-map 或 frontmatter 可无损带元数据`。

## Acceptance Criteria

- [ ] 新建/打开 `.mmap` 文件 → split 视图（左源 + 右画布）。
- [ ] 在 CodeMirror 改 Markdown bullets → 画布实时刷新。
- [ ] 在画布拖拽节点改层级 / 双击改文字 / Tab 加子 / Enter 加兄 → CodeMirror 源更新。
- [ ] Cmd+S / 自动保存把变更落地到 `.mmap` 文件。
- [ ] 关闭重开文件，修改仍在。
- [ ] 主 bundle 不含 mind-elixir（lazy load 生效，验证 chunk split）。

## Definition of Done

- 测试：`MmapFileViewerPreview.test.tsx` 覆盖 parse→render、serialize→writeback、round-trip 至少 3 case。
- Lint / typecheck / CI green。
- handler 在 `registry` 自动被 `import.meta.glob` 发现，无需手动改 registry。
- 复用 `PreviewProps.onChange` 写回路径（JSON viewer 同款），不新增写回 plumbing。

## Technical Approach

**库**：mind-elixir（MIT，~50-70 kb gz，可编辑 canvas，JSON tree 内部模型，Vite 友好）。
**源格式**：Markdown bullet list，`remark-parse` 解析（已装），~40 行 mdast→MindElixir 转换 + ~30 行 MindElixir→Markdown serializer。
**写回**：`PreviewProps.onChange(content)` 已存在（types.ts），走 `editorStore.updateTabContent`。
**视图**：`['split', 'edit', 'preview']` + `defaultViewMode: 'split'`，模仿 DBML handler 模式。

## Decision (ADR-lite)

- **Context**: 用户选「混合双向同步」编辑模型；仓库无 mindmap 库；仓库已有 `remark-parse`、`@antv/x6`（DBML 用）、`d3-force`。
- **Decision**: mind-elixir + Markdown bullets + `.mmap` 扩展名。元数据（色/折叠/位置）按 ponytail flag 暂丢，等需求出现再加。
- **Consequences**:
  - ✓ 复用 remark-parse、复用 onChange 写回、复用 DBML split 模式 → 最少新代码。
  - ✓ mind-elixir MIT + Vite 友好，lazy-load 不进主 bundle。
  - ✗ 节点颜色/折叠/链接不会跨会话保留 — 已显式记为 Out of Scope。
  - ✗ 源 → 画布增量 diff 全量重置版本可能抖动 — `ponytail:` 注释标 ceiling，必要时升级为 id-based 增量 patch。

## Out of Scope

- 节点级元数据持久化（颜色、折叠、链接、note body）— `ponytail: 元数据先丢`。
- 跨文件 / 多人协作。
- 云同步。
- AI 生成思维导图。
- 导出 PNG / SVG / OPML。
- 自定义节点形状 / 主题。

## Research References

- [`research/mindmap-libraries.md`](research/mindmap-libraries.md) — mind-elixir 是唯一开箱带全 canvas 编辑能力的候选；jsmind 老、x6 需 DIY、markmap 只读。
- [`research/source-format-roundtrip.md`](research/source-format-roundtrip.md) — Markdown bullets 是 YAGNI 最优：复用 remark-parse、对 text+tree 无损、git diff 友好；YAML-map 作为元数据升级路径备用。

## Technical Notes

- 参考 handler：`file-types/dbml/`（split + lazy Preview）、`file-types/json/`（预览内 CodeMirror 编辑 + onChange 写回）、`file-types/markdown/`（CodeMirror lang-markdown 配置）。
- mind-elixir 是 vanilla lib，无官方 React binding；用 ref + useEffect 挂载，~20 行 hook。
- 实施前需 `npm view mind-elixir` 验证最新版本与 Vite/React 18 兼容性（research agent 受 npm 网络限制未能本地验证）。

## Implementation Plan (small PRs)

- **PR1（脚手架 + 渲染只读）**: handler 注册 + `MmapFileViewerPreview` lazy load + `remark-parse` mdast→MindElixir 转换 + split 布局 + CodeMirror lang-markdown 左 pane。验收：打开 `.mmap` 显示画布，源改 → 画布刷新。无 onChange 写回。
- **PR2（双向写回）**: MindElixir→Markdown serializer + `onDataChange` → `props.onChange` + 画布编辑后源同步 + Cmd+S 落地。验收 R3 全条。
- **PR3（边界 + 测试 + 清理）**: 空文档 / 大文件 / 损坏 Markdown fallback / `destroy()` 清理 / `MmapFileViewerPreview.test.tsx` / `ponytail:` 注释标 ceiling。

## Out of Scope (再次明确)

- 节点元数据（颜色 / 折叠 / 链接 / note body）持久化。
- 增量 id-based diff（MVP 用全量重置，标 ceiling）。
