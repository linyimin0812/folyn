# dbml 预览布局自适应与连线优化

## Goal

修复 dbml 预览页面连线问题：连线穿过表 card、连线折来折去。
当前用 d3-force 布局 + x6 `manhattan` 路由器（A* 网格搜索），
manhattan 天生产生阶梯折线，且失败时静默回退 `orth`（不避障）→
直线穿过卡片。换为 x6 `er` 路由器（单弯、按相对位置出口）+
调优 d3-force 让相连表聚类。

## Decision (ADR-lite)

**Context**: manhattan 路由器有两个本质问题：A* 网格搜索天然产生
阶梯折线；失败时静默回退 orth 路由器，直线穿过卡片。用户要求
「连线不穿过卡片、不折来折去」。

**Decision**: Approach A — 换 `er` 路由器（单弯直线，按相对位置
自动选出口侧），同时优化 d3-force 让相连表更靠近、不相连表更疏，
靠布局 mitigate 「C 夹在 A-B 中间」的极端情况。

**Consequences**:
- ✅ 零折线（最多 1 个弯）。
- ✅ source/target 自身不会被穿过（出口侧由相对位置算出）。
- ⚠️ 不避障其他卡片 — 若 A-B 相连但 C 夹在中间，直线穿过 C。
  靠布局 mitigate；若实际出现可加自定义 router（Out of Scope）。
- ✅ diff 小、风险低。

## Requirements

* 连线不穿过 source/target 表/枚举 card 的 bounding box。
* 连线弯数最少（理想 0-1，复杂场景 ≤ 2）。
* 容器 resize 时画布跟随（已有 ResizeObserver），不重新布局。
* 保留：manualPositions 持久化、zoom / grid 工具栏、meta 写回、
  拖拽碰撞保护。

## Acceptance Criteria

* [ ] 打开任一 .dbml 预览，所有连线不与 source/target card 相交。
* [ ] 多数连线弯数 ≤ 1。
* [ ] 容器 resize 后画布跟随，无溢出 / 留白过大。
* [ ] 已有拖拽位置、zoom、grid 行为不退化。
* [ ] erLayout 已有测试不破；新增 er 路由器出口选择的纯函数测试
  （若把出口选择抽成纯函数）。

## Definition of Done

* Tests added/updated（erLayout 测试不破，新增若抽函数）。
* Lint / typecheck / CI green。
* 视觉验证：至少 3 个不同规模 dbml 文件（少表 / 多表 / 含枚举）。

## Out of Scope

* 不重写整个 ER 渲染器（仍基于 x6）。
* 不引入 dagre 等层级布局新依赖。
* 不改 dbml 解析、meta 持久化协议。
* 不实现自定义混合 router（er 失败时回退 manhattan）。

## Technical Approach

### 改动 1: `ErDiagramX6.tsx:599-623` 路由器换为 `er`

```ts
graph.addEdge({
  source: { cell: `t:${r.fromTable}`, ...(sourcePort ? { port: sourcePort } : {}) },
  target: { cell: `t:${r.toTable}`, ...(targetPort ? { port: targetPort } : {}) },
  router: {
    name: 'er',
    args: {
      offset: 24,        // 出口距 card 边界的距离
      min: 16,           // 出口距 card 角的最小距离
      direction: 'H',    // 优先水平方向（ER 表关系默认水平连接）
    },
  },
  // connector 仍为 graph-level 'normal'（直线）
  attrs: { ... },  // 不变
});
```

- `direction: 'H'`：er 路由器会根据 source 在 target 左/右自动选
  具体水平方向；强制水平避免出现垂直连线穿越表头。
- 移除 `startDirections` / `endDirections` / `excludeNodes` /
  `padding` / `step` / `maxLoopCount` / `snapToGrid` — er 路由器
  不需要。

### 改动 2: `erLayout.ts:285-303` d3-force 调参

```ts
const sim = forceSimulation<SimNode>(allNodes)
  .force('link', forceLink<SimNode, SimLink>(simLinks)
    .id((d) => d.id)
    .distance(200)       // 280 → 200，相连表更近
    .strength(0.5))     // 显式拉力，避免随机散开
  .force('charge', forceManyBody().strength(-700))  // -900 → -700
  .force('center', forceCenter(0, 0))
  .force('collide', forceCollide<SimNode>()
    .radius((d) => Math.max(d.width, d.height) / 2 + 40))  // 24 → 40
  .stop();
```

- link distance 280 → 200：相连表更近，连线更短，减少穿越其他卡片概率。
- charge -900 → -700：弱化排斥，配合更短的 link 让聚类更紧。
- collide padding 24 → 40：card 间距更大，er 路由器有足够空间走直线。
- link strength 0.5：显式设置，d3 默认 strength 反比节点度数，
  高度数节点拉力弱；固定 0.5 让所有 link 都有合理拉力。

### 改动 3: 移除 `boxesTooClose` / `DRAG_MIN_GAP` 中 manhattan 相关注释

- `boxesTooClose` 函数仍保留（拖拽碰撞保护仍需要），但注释里
  「manhattan router treats every OTHER card as obstacle」相关说明
  改为「拖拽时保持卡片间距，避免视觉重叠」。

## Implementation Plan (small PRs)

* PR1（本任务一次性提交）:
  - 改路由器 manhattan → er
  - 调 d3-force 参数
  - 更新 erLayout.ts 注释（移除 manhattan 相关说明）
  - 跑现有测试确认不破

## Technical Notes

* `ErDiagramX6.tsx:599-623` — 当前 addEdge 的 router 配置。
* `erLayout.ts:285-303` — d3-force 配置。
* `lib/registry/router/er.js` — er 路由器源码（已读过）。
* `manhattan/options.d.ts` — 调参清单（参考用，改后不再用 manhattan）。

## Research References

（本任务直接读 x6 源码即可决策，未启用 trellis-research 子代理。）
