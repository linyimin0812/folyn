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
- [x] 拖拽表卡时不能拖到与其他卡片间距 < 24px（否则连线会因 manhattan router 找不到可达点而穿过卡片）

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

## Amendment: router 从 `er` 改为 `manhattan`（实现偏离原 ADR，补记）

原 ADR/研究都建议用 x6 内置 `er` router（§5，边界框中点折线），但 `er` router **不做障碍物规避**——纯按 source/target 的 bbox 中心算一条 Z 形折线，完全不知道画面上还有第三张表挡在中间。多轮实测（`3b9472a`→`836872e`→`9c073b0`→`b22e7c9` 等 commit）后改用 `manhattan` router（A* 网格寻路，唯一 obstacle-aware 的内置 router），每条边单独传 `excludeNodes: [源表id, 目标表id]`（否则共享 obstacle map 缓存错误，见 `9c073b0` 注释）+ 单方向 `startDirections`/`endDirections`（否则 A* 会选到穿卡片的候选点）。

**遗留失效模式（本次修复）**：`excludeNodes` 只让 source/target 不再是障碍物，其余每张卡片仍是障碍物（padded by `padding: 16`）。当用户拖拽把两张卡片拖到彼此 `padding` 范围内（画布没有任何防重叠约束）时，A* 找不到可达的起点/终点，`findRoute` 返回 `null`，`manhattan` 静默 fallback 到**不感知障碍物**的 `orth` router，连线直接穿过卡片——这正是"连线穿过表"复现的根因，而不是 obstacle map 本身没生效。

**修复**：`ErDiagramX6.tsx` 的 `node:change:position` 拖拽回调新增碰撞守卫（`erLayout.ts` 新增 `boxesTooClose(a, b, minGap)` 纯函数，`DRAG_MIN_GAP = 24`）——任何一次拖拽如果会让两张卡片的间距小于 24px，直接把该卡片位置还原到最后一次合法（不碰撞）位置，从源头保证 manhattan router 的障碍物间距要求始终满足，而不是事后检测/修补错误的路由。自动布局（d3-force `forceCollide` 半径已含 +24 buffer）不受影响。

**验证**：`boxesTooClose` 单测（`erLayout.test.ts`，5 组：重叠/间距不足/恰好达标/远离/单轴对齐但另一轴够远）+ `tsc -b` 通过 + `parseDbml.test.ts` 11 个测试不回归。

## Amendment: 关系线点击动效（新增需求，补记）

**需求**：点击一条关系线（relationship edge）时要有视觉动效反馈；点击空白画布或另一条线时恢复正常。

**动效方案**：流动虚线（不是呼吸脉动）——选中态把 `attrs.line` 切到 `stroke: var(--acc)` + `strokeWidth: 2` + `strokeDasharray: '6 4'`，再用 `attrs.line.style = { animation: 'er-edge-flow .6s linear infinite' }` 挂一个只动 `stroke-dashoffset`（0 → -20，两个虚线周期，首尾无缝）的 CSS `@keyframes`。选纯 CSS 动画而不是呼吸脉动，是因为流动方向感和现有 crow's foot 细线风格更搭，且比透明度/线宽脉动更容易一眼识别出"这条线被选中了"。`@keyframes` 定义放在组件渲染的一个 `<style>` 标签里（`EDGE_FLOW_ANIMATION_CSS` 常量），不新增 CSS 文件/方案，也不污染全局样式。

**事件绑定**：mount 时的 Graph 实例上挂 `graph.on('edge:click', ...)` 和 `graph.on('blank:click', ...)`，都转发到同一个 `selectEdge(clickedEdgeId)` 闭包。单选模型用 `useRef<string | null>` (`selectedEdgeIdRef`) 记录当前选中边 id，没有引入状态管理库。选中态切换的 next-id 逻辑抽成了纯函数 `nextSelectedEdgeId(current, clickedEdgeId)`（导出自 `ErDiagramX6.tsx`，仿照 `boxesTooClose` 的模式），补了 4 组单测（`ErDiagramX6.test.ts`）：blank click 清空选中 / 点击新线切换 / 点击已选中的线再切换为取消选中（额外加的小 UX：单选模型下再点一次同一条线会取消高亮，不在原始需求描述里但不冲突） / 二者组合。

**清理时机**：内容变更触发的「Sync state → graph」`useEffect` 里，`graph.clearCells()` 之后立刻把 `selectedEdgeIdRef.current` 置空——`clearCells()` 会销毁所有边 cell（包括被选中的那条），不同步清空的话下次点击同 id 的新边会被 `nextSelectedEdgeId` 误判成"已选中"而变成取消选中的 no-op。

**未触碰**：marker（crow's foot 端点符号）颜色保持 `var(--t3)` 不随选中态变化——marker 是独立注册的 SVG `<defs>`，不跟着单条边的 `attrs.line` 走，改动会牵扯到按边生成独立 marker 变体，超出本次需求范围（需求只要求线本身响应点击）。`interacting.edgeMovable: false` 未改动，点击选中不会让边可拖动。
