# Markdown 编辑器查找/替换样式优化（VS Code 风格）

## Goal

把 CodeMirror 默认搜索面板替换为 VS Code 风格的 React 自定义搜索/替换栏，覆盖所有用 CodeMirror 的编辑器（markdown / json / html source / dbml）。统一交互、视觉，并获得可定制控件（match-case / regex / whole-word / count / 替换开关）。

## What I already know

- 仓库内 CM 编辑器入口共 3 处：
  - `apps/desktop/src/editor/EditorView.tsx` — markdown（含 .dbml 复用 SQL 高亮）
  - `apps/desktop/src/components/file-types/json/editor/Json5CodeMirror.tsx`
  - `apps/desktop/src/components/file-types/html/SourceEditCanvas.tsx`
- 现状：三个文件只挂了 `searchKeymap` + `highlightSelectionMatches`，**没装 `search()` 扩展**，意味着 Cmd+F 不会出现默认面板，搜索功能基本缺失
- 已安装依赖：`@codemirror/search@^6.5.8`、`@codemirror/state`、`@codemirror/view`
- 设计参考：VS Code 内置搜索/替换面板（顶部悬浮、紧凑、带计数和切换按钮）

## Assumptions (temporary)

- `search()` 扩展支持 `panel: () => null`（或等价方式）来禁用默认面板但保留 query state + 高亮 + keymap actions
- `getSearchQuery(state)` / `setSearchQuery` effect 可在 React 中读写 query
- 匹配计数可用 `SearchCursor` 遍历得到；CM 不直接暴露 count field
- 跨编辑器复用同一 React 组件，由父容器（`EditorPane`、JSON viewer 容器、`SourceEditCanvas`）控制挂载位置

## Requirements

- [ ] Cmd+F 打开搜索栏；Esc 关闭；Cmd+H / Cmd+Opt+F 打开替换
- [ ] 搜索输入框 + 替换输入框（替换行可折叠）
- [ ] 控件按钮：Aa（区分大小写）、.*（正则）、ab（全字匹配）
- [ ] 计数显示 "x of y"（0 of 0 时显示 0 results）
- [ ] 上一个/下一个/替换/全部替换按钮
- [ ] VS Code 视觉风格：顶部右侧悬浮、紧凑、圆角、subtle border、跟随主题（light/dark）
- [ ] 跨 markdown/json/html-source/dbml 编辑器统一行为
- [ ] 搜索栏可见时不影响编辑器滚动/焦点；输入框 focus 时不偷走 CM 焦点过度
- [ ] 关闭后清除高亮（或保留，按 VS Code 行为：关闭面板保留高亮直到光标移动）

## Acceptance Criteria

- [ ] 在 markdown 文件按 Cmd+F 弹出顶部悬浮搜索栏，输入文字后正文匹配高亮
- [ ] 计数正确："3 of 7" 等
- [ ] 切换大小写/正则/全字按钮后重新执行搜索
- [ ] 替换模式：替换下一个 / 全部替换功能正确
- [ ] json / html source / dbml 编辑器同行为
- [ ] light/dark 主题下视觉正确
- [ ] Esc 关闭面板；Cmd+G / Shift+Cmd+G 在面板关闭时也能 next/prev（沿用 searchKeymap）

## Definition of Done

- 类型检查通过（`pnpm typecheck`）
- 现有测试不回归
- 已覆盖 3 处编辑器入口（markdown/json/html-source；dbml 复用 markdown 入口）
- prd.md / 关键决策记录完整

## Out of Scope

- 多光标支持（CM 已有 multi-cursor，不改动）
- 文件级跨文件搜索（不在编辑器内做）
- 搜索历史记录 / 持久化最近查询
- 移动端适配
- 重构 `highlightSelectionMatches`（保留现有行为）

## Technical Approach

### 组件结构
- 新增 `apps/desktop/src/components/editor/SearchPanel.tsx`（或 `editor/extensions/`）
  - Props: `{ view: EditorView | null }`
  - 内部 state: query string / replace string / caseSensitive / regexp / wholeWord / replaceVisible / matchCount / currentMatchIndex
  - 通过 `getSearchQuery(view.state)` 读取初值；变更时 dispatch `setSearchQuery` effect
  - 计数：用 `SearchCursor`（`@codemirror/search`）遍历整个 doc，监听 docChanged / query 变化重算
- 在三个编辑器入口：
  - 添加 `search({ panel: () => null })` 扩展（验证 panel 选项是否支持禁用；不支持则用自定义空 panel）
  - 在 keymap 加入 `Cmd-F` → 触发 React state 切换可见
  - 渲染 SearchPanel 作为浮动元素，绝对定位于编辑器容器顶部右

### 状态同步
- React state → CM：`view.dispatch({ effects: setSearchQuery.of(new SearchQuery({...})) })`
- CM → React：`EditorView.updateListener` 中读 `getSearchQuery(update.state)` 与本地比较，不同则同步（避免循环）
- 计数缓存：query 不变时复用；query 或 doc 变更时重算（debounce 50ms）

### VS Code 视觉规格（粗略）
- 容器：top: 8px, right: 12px，max-width 420px，bg `--surf`，border 1px `--brd`，radius 6px，shadow subtle
- 输入框：紧凑、内联按钮右侧紧贴
- 按钮：icon-only，hover 高亮，active（启用）填充主题色

## Decision (ADR-lite)

**Context**: CM 默认搜索面板视觉粗糙且无法定制控件布局；用户希望统一所有 CM 编辑器入口的搜索体验。

**Decision**: 用 React 自定义搜索栏替换默认面板。保留 `search()` 扩展的 query state / 高亮 / keymap actions，仅替换 UI 层。这样不重新实现搜索核心逻辑，最小改动、最大可控。

**Consequences**:
- + 跨编辑器一次复用
- + 视觉/交互完全可控
- − 需要手动维护 React ↔ CM 双向状态同步（小复杂度）
- − 计数功能需自实现（CM 不暴露 count field）

## Technical Notes

- 文件清单：
  - `apps/desktop/src/components/editor/SearchPanel.tsx`（新建）
  - `apps/desktop/src/editor/EditorView.tsx`（加 search 扩展 + 挂载面板）
  - `apps/desktop/src/components/file-types/json/editor/Json5CodeMirror.tsx`（同上）
  - `apps/desktop/src/components/file-types/html/SourceEditCanvas.tsx`（同上）
  - `apps/desktop/src/index.css`（追加 `.ed-search-panel` 等样式类）
- 相关 API：
  - `search()` 扩展、`SearchQuery`、`getSearchQuery`、`setSearchQuery`
  - `findNext`、`findPrevious`、`replaceNext`、`replaceAll`、`selectMatches`
  - `SearchCursor`（用于计数）
- 已存在 `.sw-search` 是 sidebar 搜索样式，不复用（不同场景）
