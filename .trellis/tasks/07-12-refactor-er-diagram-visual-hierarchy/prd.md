# refactor-er-diagram-visual-hierarchy

## Goal

用 @antv/x6 v3 重写 ER 图预览，建立清晰视觉主次（中性表头、note/index 折叠 chip、enum 虚线无色、grid 默认关），替换原手写 SVG 渲染器（~1179 行）为 ~300 行 X6 React-shape 实现。数据层（`parseDbml` + `erLayout` 的 d3-force + 尺寸估算）保留不动。

## Decision (ADR-lite)

**引擎**: @antv/x6 v3.1.7 + `@antv/x6-react-shape` v3.0.1 + `@antv/x6-plugin-transform` v3.0.0（plugin 必须钉 v3，`latest` 仍指 v2 会 peer 冲突）。MIT。

**渲染路径**: React 组件注册（`register({ shape: 'er-table', component: TableCardNode })`）—— 直接移植现有 `TableCard`/`EnumCard` JSX，保留所有视觉决策。不用 X6 Markup/attrs DSL（会重写 600 行 JSX）。

**数据层**: `parseDbml.ts` 不动。`erLayout.ts` 保留 `layoutEr` / `estimateTableSize` / `wrapText` / `tablesBounds`，但 `refEndpoints` / `orthoRefPath` / `fieldAnchor` 这块几何代码（~120 行）将被 X6 的 `router: 'er'` + per-field ports 取代，最终在 step 3 删除。

**视觉决策（沿用上一轮 brainstorm 的极简单色方案）**:
- 表头：去掉 8 色饱和循环，默认中性灰（var(--surf) + brd），表名 t1 加粗；仅当 DBML 显式 `headerColor` 时上色
- note/index/field-note 默认折叠为卡片底部 chip "⋯ N notes · M indexes"，点击展开
- enum：去掉色块表头，虚线边框 + «enum» 小标签 + 名称 t1 加粗
- project banner：已是中性，不动
- 网格默认关闭
- 关系线：var(--t3) 1.5px + crow's foot（`er-one`/`er-many` 自定义 marker，复用现有 path d）

**懒加载**: `index.ts` 用 `React.lazy(() => import('./ErDiagramX6'))`，x6 主包 + plugin 在打开 .dbml 时才下载（沿用 `@dbml/core` 的 dynamic import 模式）。

## Requirements

- 新增 `ErDiagramX6.tsx`：挂载 `Graph` 实例，注册 `er-table` / `er-enum` React-shape，注册 `er-one`/`er-many` marker，使用 `@antv/x6-plugin-transform` 提供缩放/平移
- 节点数据来自 `parseDbml` + `layoutEr`：`graph.addNode({ shape: 'er-table', x, y, width, height, data: { table } })`
- 边数据来自 `ErSchema.refs`：`graph.addEdge({ source: { cell, port }, target: { cell, port }, router: { name: 'er' }, connector: 'rounded', attrs: { line: { sourceMarker, targetMarker } } })`
- `manualPositionsRef` 行为保留：拖拽后 `node:change:position` 写入 `manualPositionsRef`，content edit 后 re-layout 时复用
- `index.ts` 改为 `React.lazy` + `Suspense`（fallback "正在加载 ER 渲染器…"）
- 视觉决策全部移植（见上）
- 删除 `ErDiagramPreview.tsx`（被 `ErDiagramX6.tsx` 取代）+ 删除 `erLayout.ts` 中仅被 SVG 路径使用的 `refEndpoints` / `orthoRefPath` / `fieldAnchor`
- `parseDbml.test.ts` 11 个测试不回归

## Acceptance Criteria

- [ ] `.dbml` 文件打开时显示 ER 图（X6 渲染）
- [ ] 表头中性灰（无 8 色循环）；DBML 显式 `headerColor` 仍生效
- [ ] note/index/field-note 默认折叠为底部 chip；点击展开
- [ ] enum 虚线边框 + «enum» 标签，无色块表头
- [ ] 关系线带 crow's foot marker，拖拽表卡时线跟随
- [ ] 滚轮缩放（向光标）+ 拖拽平移正常
- [ ] 网格默认关，工具栏可切换
- [ ] x6 主 chunk 不进入主 bundle（懒加载）
- [ ] tsc + 11 个 parseDbml 测试通过
- [ ] `ErDiagramPreview.tsx` 删除，`ErDiagramX6.tsx` 取代

## Definition of Done

- 类型检查 / 测试通过
- 同一 DBML 文件视觉与原 SVG 版本一致（中性表头 + chip 折叠 + enum 虚线 + grid 默认关）
- 拖拽 / 缩放 / 平移 / 折叠交互不回归
- 净代码量下降（删 ~1179 行，加 ~300 行 + 索引改动）

## Out of Scope

- 布局算法重写（d3-force 保留）
- parseDbml 语法扩展
- 选中表高亮关系（X6-plugin-selection 可后续加）
- minimap / stencil / keyboard undo
- 兼容旧 SVG 渲染器（直接替换，不保留 fallback）

## Research References

- [`research/antv-x6-er-diagram.md`](research/antv-x6-er-diagram.md) — x6 v3 API、React-shape 注册、er router、自定义 marker、懒加载模式、迁移计划

## Technical Notes

- 依赖已装：`@antv/x6 ^3.1.7` / `@antv/x6-react-shape ^3.0.1` / `@antv/x6-plugin-transform 3.0.0`（plugin 被 deprecated 标记但 v3 仍可用）
- 主要文件：`apps/desktop/src/components/file-types/dbml/ErDiagramX6.tsx`（新建）、`index.ts`（改 lazy）、`ErDiagramPreview.tsx`（删）、`erLayout.ts`（删 refEndpoints 块）
- CSS 变量：`--bg / --surf / --brd / --brd2 / --t1 / --t2 / --t3 / --acc / --hov`
- `examples/src/pages/table/index.tsx`（官方 ER 示例）参考 `router: { name: 'er', args: { direction: 'H' } }`

## Migration Plan

| Step | Action |
|------|--------|
| 1 | 新建 `ErDiagramX6.tsx`：Graph 实例 + 注册 React-shape + 移植 TableCard/EnumCard JSX（视觉决策一并带上）；`index.ts` 切到 `React.lazy` |
| 2 | 加边：`router: 'er'` + 注册 `er-one`/`er-many` marker（复用 SVG path d）；删 `recomputeRefs` |
| 3 | 删 `ErDiagramPreview.tsx`；删 `erLayout.ts` 中 `refEndpoints`/`orthoRefPath`/`fieldAnchor` 块 |
