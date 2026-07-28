# Tiptap Rich Text Editor as New File Type

## Goal

在 Quill 中新增一种「富文本」文件类型（扩展名 `.rt`），基于 [tiptap](https://tiptap.dev)/ProseMirror 实现 WYSIWYG 编辑，与现有 Markdown（CodeMirror）文件类型物理隔离。用户可新建、打开、编辑、保存该类型，内容以 tiptap 原生 JSON 存盘，round-trip 无损。

## Requirements

- 新增 `apps/desktop/src/components/file-types/rich-text/` handler：`id:'rich-text'`, `extensions:['rt']`, `useCodeMirror:false`, 提供 `Editor` 组件，`supportedViewModes:['edit']`, `defaultViewMode:'edit'`, `needsFileContent:true`。
- Editor 接收 `EditorProps{content, tabId, filePath, onChange, onSave}`，内部用 tiptap `useEditor` 装配扩展。
- 磁盘格式 = tiptap 原生 JSON 字符串；`serialize/deserialize` = identity，省略（content 即 JSON 字符串）。
- tiptap 扩展（Tier 1+2+3 全进 MVP）：
  - Tier 1：Document/Paragraph/Text, Bold/Italic/Underline/Strike, Heading(1-3), BulletList/OrderedList/ListItem, HardBreak, History, Placeholder。
  - Tier 2：CodeBlock(lowlight 或纯), Blockquote, HorizontalRule, Link, Code, TaskList/TaskItem。
  - Tier 3：Image（vault 落盘）, Table（+ TableRow/TableCell/TableHeader）。
- **图片落盘**：黏贴/拖入图片 → 写入 vault `assets/<sha1>.<ext>`（经 `useVaultStore`/`editorIoService` 路径解析），`Image` 节点 `src` 存 vault 相对路径。需实现 `Image` 自定义上传/paste/drop 处理。
- **新建文件 UX**（方案 C，两入口）：
  - 扩展名触发：`SidebarActions.tsx` 新建对话框输入 `*.rt` 即解析为该类型；`ContextMenu.tsx` 的 "New File (other type)" 列表加 `Rich Text (.rt)` 项。
  - 侧栏快捷按钮：在 `SidebarActions.tsx` 加一个「新建富文本」按钮，直接弹空白 `.rt` 命名。
- **隐藏视图模式切换**：把 `'rich-text'` 加进 `Topbar.tsx` 的 `HIDE_VIEW_MODE_FILE_TYPES`，隐藏 edit/preview/split 切换（WYSIWYG 纯编辑）。
- **防写回环路**：照搬 drawio 的 `loadedXml`+`loadedXmlRef` 范式 —— 用户编辑只更新 ref + debounce `onChange`；外部 content 变化（AI/file watcher）才 `editor.commands.setContent()`，且需先清 debounce timer 防 race。tiptap 的 `setContent` 同样会触发 loop，必须守卫。
- 工具栏（React shell 自绘，参考 GrapesJS 模式：panels disabled，host 自绘 toolbar）覆盖常用格式命令。

## Acceptance Criteria

- [ ] 侧栏两种入口都能新建 `.rt` 文件并在 WorkArea 打开为 tiptap 富文本编辑器。
- [ ] 编辑后保存（autosave）、关闭 tab、重开，内容与编辑器状态 round-trip 无损。
- [ ] Markdown 文件仍走 CodeMirror，互不干扰；`.md` 不会被误判为 rich-text。
- [ ] 黏贴/拖入图片被写入 vault assets，`src` 为相对路径；重开后图片正常显示。
- [ ] 表格可插入/编辑单元格。
- [ ] 外部 content 变化（AI 改动）经 `updateTabContent` 应用，不触发无限 reload/环路。
- [ ] edit/preview/split 切换在 rich-text tab 下被隐藏。
- [ ] 单测覆盖：JSON round-trip（serialize→deserialize 等价）、防环路 ref 逻辑、图片路径解析纯函数。

## Definition of Done

- 单测/集成测试（纯函数优先，参考 dbml spec：jsdom 无法跑的依赖抽成纯函数测）。
- lint / typecheck / `vitest` 绿。
- tiptap 依赖版本记录在 `apps/desktop/package.json`。
- 行为变更：`.trellis/spec/desktop/frontend/file-type-editors.md` 增补一节 rich-text/tiptap 模式（经 `trellis-update-spec`）。

## Technical Approach

照搬现有自定义 Editor 范式（`html`/`excalidraw`/`drawio`）：
1. drop-in handler 目录，Vite glob 自动注册，零中央改动。
2. `Editor` 组件 = React shell + `useEditor` hook（参考 `useGrapesEditor.ts` 的 mount-once + ref 模式）。
3. 持久化由 Quill editor store 拥有（`onChange` → `updateTabContent` → autosave → `vault.writeFile`），不在 tiptap 内接 storageManager。
4. 防环路：`contentRef` + `loadedContent`/`loadedContentRef` + debounce `onChange`，外部变化才 `setContent`，race 守卫清 timer。
5. 图片：自定义 `Image` 扩展或 `extend` 官方 Image，覆写 `addPasteRules`/`addProsePlugins` 的 drop 处理，落盘经 vault store；路径解析抽成纯函数便于单测。
6. AI 路由：`useCodeMirror:false` 自动让 `aiStore.addFileChange` 走 `updateTabContent` 分支，无需新代码。
7. 视图模式：`HIDE_VIEW_MODE_FILE_TYPES` 加 `'rich-text'`。

## Decision (ADR-lite)

**Context**：需在 Markdown 之外新增富文本编辑能力，且要与 Markdown 明确区分；选型 tiptap vs 继续扩展 CodeMirror+Markdown 预览。
**Decision**：
- 格式 = tiptap 原生 JSON，扩展名 `.rt`（lossless、与 Markdown 物理隔离；同 excalidraw 存 `.excalidraw` JSON 先例）。
- 编辑器 = tiptap，自定义 `Editor` handler（`useCodeMirror:false`），复用 Quill 持久化栈。
- MVP 含 Tier1+2+3（含图片+表格）；图片存 vault assets（local-first 正确，非 base64 内嵌）。
- 新建 UX 两入口（扩展名触发 + 侧栏快捷按钮）。
**Consequences**：
- 引入新依赖 tiptap（+ prosemirror 系列、lowlight 若 Tier2 代码块用 high­light）。bundle 体积增加；可 lazy-load 编辑器组件缓解首屏。
- `.rt` 文件在 Quill 外不可读（JSON）。二期可加导出 HTML/Markdown。
- 图片 vault 落盘需 assets 目录约定与 paste/drop 处理，实现量高于 base64，但符合 local-first 定位。
- 无 accept/reject diff UI（AI 改动自动应用），与 drawio/excalidraw 一致，二期升级。

## Out of Scope

- Markdown ↔ 富文本双向转换 / 导入导出。
- 协作 / 多人编辑 / 实时同步。
- 富文本内嵌 Markdown 渲染块。
- 图片裁剪/重压缩编辑（仅落盘原文件）。
- 颜色/高亮/Mention/Timeline 等 Tier3 之外的扩展。
- 离线 bundle drawio 类的本地化资源（tiptap 无在线依赖，无需）。

## Research References

- [`.trellis/spec/desktop/frontend/file-type-editors.md`](../../spec/desktop/frontend/file-type-editors.md) — 自定义 Editor 契约、防写回环路范式、AI 路由分支、视图模式隐藏、持久化栈。
- [`.trellis/spec/desktop/frontend/index.md`](../../spec/desktop/frontend/index.md) — 技术栈与关键模式（命名导出、Zustand granular selectors、`@/` 别名、Tauri `invoke`）。

## Technical Notes

- 派发：`WorkArea.tsx` 的 `useCodeMirror`/`Editor`/`Preview` 三分支；`useCodeMirror:false + Editor` 渲染自定义组件。
- 读写：`services/editorIoService.ts` 按路径形态路由；`open_file`/`save_file` Rust 命令。
- 类型解析：`editorStore.detectFileType` → `getHandlerByExtension('rt')`。
- 先例参考：`file-types/excalidraw/index.ts`、`file-types/drawio/DrawioEditor.tsx`、`file-types/html/useGrapesEditor.ts`。
- bundle：tiptap 按需 import 扩展可 tree-shake；若体积显著，对 `QuillEditor` 组件 `React.lazy` + Suspense。

## Implementation Plan (small PRs)

- **PR1 — Scaffolding & wiring**：加 tiptap 依赖；建 `file-types/rich-text/` 目录 + `index.ts` handler + 最小 `QuillRichEditor.tsx`（空 tiptap，仅 Document/Paragraph/Text）；`detectFileType` 已能按扩展名解析（验证）；`SidebarActions`/`ContextMenu` 加 `.rt` 入口；`HIDE_VIEW_MODE_FILE_TYPES` add `rich-text`。能新建并打开空白编辑器。
- **PR2 — Core editor + round-trip**：装 Tier1+2 扩展 + 工具栏；JSON `getJSON`/`setContent` 读写；防写回环路 ref 守卫；autosave debounce；单测 round-trip。
- **PR3 — Tier3 + assets + spec**：Image 扩展 + paste/drop → vault assets 落盘 + 相对路径 src（抽纯函数测）；Table 扩展；单测路径解析；`trellis-update-spec` 补 file-type-editors.md 的 tiptap 节。
