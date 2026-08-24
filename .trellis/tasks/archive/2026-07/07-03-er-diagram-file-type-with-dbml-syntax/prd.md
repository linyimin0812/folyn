# ER Diagram File Type with DBML Syntax

## Goal

在 folyn 桌面应用中新增 ER 文件类型：扩展名 `.dbml`，使用 DBML 语法在 CodeMirror 中编辑，预览面板渲染 ER 图（表格卡片 + 关系连线）。让用户能在 vault 中建模数据库结构并可视化预览。

## Requirements

* 新增 `file-types/dbml/` handler，扩展名 `.dbml`，id `dbml`，`useCodeMirror: true`
* view modes：`split`（默认）/ `edit` / `preview`，与 CSV 一致
* 预览组件 `ErDiagramPreview`：用 `@dbml/core` 解析 DBML → d3-force 力导向布局 → 自绘 SVG
  * 表格卡片：表名 + 字段列表（名、类型、PK/NN/UQ 等约束标记）
  * 关系连线：连接两端表/字段，两端标注基数（`1` / `*`），用 crow's foot 或端点标签
  * 解析错误时在预览面板友好展示错误（行号 + message），不崩溃
  * 适配 dark/light 主题（用项目 CSS 变量 `--panel`/`--brd`/`--t1` 等）
  * 内容变更防抖（~300ms）后重新解析+布局
* CodeMirror 对 `.dbml` 复用 SQL 语法高亮（在 EditorView 特判，加载 `@codemirror/language-data` 里的 SQL LanguageDescription）
* `PreviewPane` 的 `fullBleed` 加入 `dbml`，让 ER 图全屏渲染
* 图标：`.dbml` 复用 sql 主题图标
* `@dbml/core` 必须 pin `8.3.1`（默认 dist-tag 指向 9.0.0-alpha）
* `@dbml/core` 用动态 `await import()` 懒加载，避免拖慢首屏（bundle ~15MB）

## Acceptance Criteria

* [ ] 打开任意 `.dbml` 文件进入 dbml handler，split 模式默认
* [ ] 编辑 DBML 文本后预览防抖更新 ER 图
* [ ] 表格卡片显示表名 + 字段（名/类型/约束标记），关系线连接对应字段并标注基数
* [ ] 非法 DBML 在预览面板显示错误（含行号），不崩溃
* [ ] dark/light 主题切换下 ER 图可读
* [ ] CodeMirror 中 DBML 关键字有 SQL 兜底高亮
* [ ] `pnpm typecheck` / `pnpm lint` 通过

## Definition of Done

* parseDbml 关键路径单测（解析成功/失败、关系基数映射）
* Lint / typecheck green
* spec `file-type-editors.md` 补充 dbml handler 章节
* 本地打开示例 .dbml 验证渲染

## Out of Scope

* 缩放平移画布（本次只做拖拽表节点排版，不做画布 zoom/pan）
* DBML → SQL DDL 生成；反向从数据库生成 DBML
* 自建 Lezer 级 DBML 精确语法高亮（用 SQL 兜底）
* 新建 .dbml 文件命令与模板（复用现有新建文件流程）
* TableGroup / StickyNote / Enum 的专门可视化（仅作表+关系图，enum 当普通表字段类型显示）

## Visual Style Reference (dbdiagram.io 风格) — V2 升级

参考图为 dbdiagram.io 默认 ER 图样式。当前实现的「`1`/`∞` 圆形基数徽章 + 单色卡片」要重构为以下样式：

### 表卡片
- 白色填充（`#ffffff` / dark 主题用 `var(--surf)`），圆角 6px，1px 边框 `#e5e7eb` / `var(--brd)`
- 轻投影：`filter: drop-shadow(0 2px 6px rgba(0,0,0,0.08))`（SVG `<filter>`）
- **彩色表头**：表卡片顶部一个彩色矩形条，高度 30px，顶部圆角，表名白色粗体 13px 左对齐 padding 12px
  - 颜色：支持 DBML `[headercolor: #hex]` 语法（`@dbml/core` 输出 `table.headerColor`，已在 parseDbml 中透传）；未指定则按表索引循环调色板：
    `#6c5ce7` `#0984e3` `#00b894` `#e17055` `#d63031` `#00cec9` `#fd79a8` `#fdcb6e`
  - dark 主题：彩色表头保留（彩色在深色背景上仍可读），卡片底色改 `var(--surf)`

### 字段行
- 行高 22px，白色底，行间 1px `#f0f0f0` / `var(--brd2)` 分隔线
- 左侧图标（x=padding）：
  - PK 字段：金色钥匙图标（SVG key，填充 `#f1c40f`），字段名加粗 `#2d3748` / dark `var(--t1)`
  - 非 PK：无图标，字段名常规 `#4a5568` / dark `var(--t2)`
- 字段名：12px，左对齐
- 类型：11px `#9aa5b1` / dark `var(--t3)`，右对齐 padding 12px
- PK/NN/UQ/AI 文字标记改为图标或移除（参考图里只有 PK 钥匙，约束用类型右侧小标签可选；MVP 只保留 PK 钥匙，NN/UQ 不显示文字标记以贴近参考图）

### 关系线（crow's foot 鸦爪记号）— 关键视觉
- 描边 `#9aa5b1` / dark `var(--t3)`，1.5px，贝塞尔曲线
- 两端用 **crow's foot 记号**，不是圆形徽章：
  - `relation === '1'` 端：在表边附近画一条与线垂直的短横线（one-and-only-one 记号）
  - `relation === '*'` 端：在表边附近画三股分叉（鸦爪，many 记号）
- 用 SVG `<marker>` 实现：定义 `er-one`（垂直短横）和 `er-many`（三叉）两种 marker，`markerStart`/`markerEnd` 按 endpoint.relation 选用
- 线从表边框 anchor 点出发（复用 `borderAnchor`）

### 背景
- 浅灰 `#f7f8fa` / dark `var(--bg)`，点阵网格背景可选（不强求）

### 拖拽排版（拖拽表节点）
- 鼠标按下表头（或整个卡片）→ 拖动该表到新位置，关系线实时跟随重算
- 实现：React state 持有各表 `{x,y}`；`pointerdown` on table `<g>` 记录起始，`pointermove`（window 监听）更新该表坐标，`pointerup` 结束；拖拽中用 `cursor-grabbing`
- **位置持久（跨内容编辑）**：维护 `manualPositions: Map<tableName, {x,y}>`。内容变更（防抖重解析）后重新布局时，对已在 map 中的表保留手动位置（跳过 d3-force，直接用保存值），仅对新增/未定位的表跑 d3-force 收敛。这样用户排版后继续编辑 DBML，已有表不乱跳。
- 拖拽时不重跑 d3-force（纯平移该表 + 重算关系线 path），性能好
- 删除某表后，其 manualPositions 条目自然失效（下次布局忽略）

## Acceptance Criteria (V2)

* [ ] 表卡片白底彩头，表名白字粗体，PK 字段带金色钥匙图标
* [ ] 关系线两端为 crow's foot 记号（`1` 端垂直横线、`*` 端三叉），无圆形徽章
* [ ] 鼠标可拖拽表卡片移动，关系线实时跟随
* [ ] 拖拽后继续编辑 DBML，已有表保持手动位置不重排（新表才参与 d3-force）
* [ ] dark/light 主题下可读（彩头保留，卡片底色/文字用 CSS 变量）
* [ ] `[headercolor: #hex]` 自定义表头颜色生效

## Technical Approach

### 文件清单与改动点

1. `apps/desktop/src/components/file-types/dbml/index.ts` — handler（仿 `csv/index.ts`）
2. `apps/desktop/src/components/file-types/dbml/parseDbml.ts` — 解析封装（懒加载 `@dbml/core`，输出 `ParsedSchema` + `ParseError[]`，逻辑取自 research）
3. `apps/desktop/src/components/file-types/dbml/erLayout.ts` — d3-force 布局：tables→节点、refs→边，跑一次模拟收敛后输出 `{x,y}` 坐标 + 边路径
4. `apps/desktop/src/components/file-types/dbml/ErDiagramPreview.tsx` — 预览组件：防抖解析→布局→渲染 SVG（表卡片 + 关系线 + 错误态）
5. `apps/desktop/src/editor/EditorView.tsx`（~327-348 行 code 分支）— 特判 `.dbml`，从 `languages` 找 SQL desc 并 `load()` 应用高亮
6. `apps/desktop/src/components/work-area/PreviewPane.tsx:82` — `fullBleed` 加 `dbml`
7. `apps/desktop/src/components/icons/FileIcon.tsx` — `EXT_TO_THEME_ICON` 加 `dbml: 'sql'`，`HANDLER_TO_THEME_ICON` 加 `dbml: 'sql'`
8. `apps/desktop/package.json` — 加 `"@dbml/core": "8.3.1"`（pin，无 `^`）

### 关键技术决策

* **解析**：`Parser.parse(str, 'dbml')` 同步返回 `Database`，取 `db.export().schemas[0]` 拿纯 JSON（避免循环引用）。错误抛 `CompilerError`，读 `err.diags[i].message` + `location.start.line/column`。
* **基数**：DBML 用运算符 `>`/`<`/`-`/`<>`，输出 `endpoint.relation: '1'|'*'`。直接读两端 `relation` 画 `1`/`*` 标签，不关心运算符方向。
* **布局**：d3-force `forceSimulation` + `forceManyBody(-_strength)` + `forceLink(id=tableName)` + `forceCenter` + `forceCollide`（按表卡片尺寸）。`simulation.on('tick', ...)` 收集，`alphaMin` 后停摆取最终坐标。固定随机种子避免每次抖动（d3-force 无内置 seed，用确定初始位置）。
* **渲染**：纯 SVG，表卡片用 `<g>` + `<rect>` + `<text>`，关系线用 `<path>`（贝塞尔/折线）。主题用 CSS 变量，`fill/stroke` 引用 `var(--surf)`/`var(--brd)`/`var(--t1)` 等。
* **高亮**：不新增 `@codemirror/lang-sql` 直接依赖；从 `@codemirror/language-data` 的 `languages` 数组 `find(l => l.name === 'SQL')` 取 LanguageDescription，`.load()` 得到 `LanguageSupport` 后 reconfigure。

## Decision (ADR-lite)

**Context**: 需在 DBML 编辑体验、ER 图视觉质量、实现工作量之间权衡。用户选择了「DBML → d3-force 自绘 SVG」方案，放弃最小工作量的 mermaid erDiagram 路线。

**Decision**:
* 渲染：`@dbml/core` 解析 + d3-force 布局 + 自绘 SVG（静态，不可交互）
* 编辑：CodeMirror + SQL 高亮兜底（复用 `@codemirror/language-data` 的 SQL desc，不新增依赖）
* 扩展名：仅 `.dbml`
* parser 版本：pin `@dbml/core@8.3.1`，动态 import 懒加载

**Consequences**:
* 视觉与布局完全可控，优于 mermaid erDiagram
* 代价：自绘 SVG 需自处理主题/错误态/布局稳定性（已用 CSS 变量 + d3-force 确定初始位置覆盖）
* `@dbml/core` bundle ~15MB，靠懒加载缓解首屏；后续若不可接受可迁到 Tauri Rust sidecar
* SQL 高亮对 DBML 专属关键字（Table/Ref/Enum/Indexes）命中率有限，可读性已够，精确高亮留作后续

## Research References

* [`research/dbml-core-api.md`](research/dbml-core-api.md) — `@dbml/core@8.3.1` 解析 API、输出结构、关系基数映射、错误结构、bundle 体积、可用 `parseDbml()` 代码

## Technical Notes

* 关键参考文件：`file-types/csv/index.ts`（handler 范例）、`file-types/markdown/MermaidBlock.tsx`（主题/错误渲染参考）、`file-types/types.ts`（PreviewProps 契约）、`PreviewPane.tsx:82`（fullBleed）、`EditorView.tsx:327-348`（语言加载分支）
* spec：`.trellis/spec/desktop/frontend/file-type-editors.md`（CSV/FileViewer 机制 + 新增 handler 约定）
* `@dbml/core` 关键陷阱：默认装 9.0.0-alpha 必须 pin 8.3.1；`err.message` undefined 必须读 `err.diags`；`[1:*]` 方括号基数语法 8.3.1 不支持，用运算符
