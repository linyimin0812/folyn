# mmap 预览六种图解耦实现

## Goal

`MindMapCanvas.tsx` 目前把六种骨架图（mind/org/tree/fishbone/timeline/bracket）塞在一个 1817 行的组件里，共用一份 CSS、一份 `applySkeleton` 分派函数、一个 `MmapMapStyle` 状态对象。结果是改一种图就会波及其它图（最近几次 commit 在反复打补丁：`5d1833c` 防 direction 串扰、`37ce7a7`/`977a553` 调 tree 专属间距）。目标是让每种图独立演进，互不影响。

## What I already know

- 入口：`apps/desktop/src/components/file-types/mmap/MmapFileViewerPreview.tsx:4` → `MindMapCanvas.tsx`
- 单体组件：`MindMapCanvas.tsx`（1817 行）
- 骨架联合类型：`outlineConverter.ts:87` `'mind' | 'org' | 'tree' | 'fishbone' | 'timeline' | 'bracket'`
- 共用 CSS 大字符串：`SKELETON_CSS` at `MindMapCanvas.tsx:85-198`（一份塞六套 `[data-mmap-skeleton="..."]` 选择器）
- 分派表：`SKELETON_BRANCHES` at `:270`，branch 生成器散落在 `:211-265`
- 主分派：`applySkeleton(inst, skeleton)` at `:502`，内联 if/else 处理 timeline/fishbone 回退到 treeBranch/verticalBranch（:514）、bracket overlay 移除（:523）
- 特例 overlay：`drawBracketConnectors` :339、`applyTreeNonLeafBoxes` :314
- 共享状态：`MmapMapStyle` at `outlineConverter.ts:89-127`，`skeleton`/`direction` 等字段全类型共用；`setDirection` :1000 用 if 守卫挡非 mind 类型（commit `5d1833c`）
- 布局收尾钩子：`:736-741` 内联特例 bracket/tree 重绘
- 选择器：`<select>` at `:1693`，`setSkeleton` at `:1013` 调 `initRight()` + `applySkeleton` + `inst.layout()`

## Assumptions (temporary)

- mind-elixir 实例是共享的（不可能为每种图起一个实例），所以"解耦"指逻辑/CSS/状态隔离，不是实例隔离
- 现有行为不改变，只是结构重排
- 六种图的渲染结果与当前一致（不借机改样式）

## Decision (ADR-lite)

**Context**: 六种图共用 `applySkeleton`/`SKELETON_CSS`/`MmapMapStyle`，改一种波及其它（commit `5d1833c` direction 串扰、`37ce7a7`/`977a553` tree 专属间距都印证了这点）。
**Decision**: Approach A — 每图一文件 + 策略对象。`skeletons/<name>.ts` 各自导出策略，`MindMapCanvas` 留 thin registry。
**Consequences**: +6 文件，需要抽策略接口；换来每种图 CSS/branch/overlay/direction 策略全在自己文件里，新增图只加文件不改 dispatch。运行时行为不变（仍共享一个 `MmapMapStyle`，切换骨架不重置 view 设置——这是 lazy 读取，用户未提持久化需求）。

## Strategy interface (derived)

每个 `skeletons/<name>.ts` 导出 `MmapSkeletonStrategy`：

```ts
interface MmapSkeletonStrategy {
  name: MmapSkeleton;
  css: string;                              // 该图专属 CSS（含 [data-mmap-skeleton="..."] 选择器）
  branchGenerator?: BranchGenerator;        // mind/bracket 为 undefined（走 mind-elixir 默认）
  init: (inst: MindElixirInstance) => void; // initRight / initSide 等
  directionEnabled: boolean;                // direction toolbar 是否可用
  postLayout?: (inst: MindElixirInstance) => void; // bracket overlay、tree non-leaf boxes
  beforeSwitch?: (inst: MindElixirInstance) => void; // removeBracketOverlay 等
}
```

`MindMapCanvas` 内：
- `SKELETON_REGISTRY: Record<MmapSkeleton, MmapSkeletonStrategy>`
- `applySkeleton(inst, name)` = 注册表查表 → 写 `data-mmap-skeleton` → 注入 `css` → 调 `init`/`branchGenerator`/`postLayout`/`beforeSwitch`
- `setDirection` 的守卫改为 `if (!SKELETON_REGISTRY[skeleton].directionEnabled) return`

## Implementation Plan (small PRs)

- PR1: 建策略接口 + `skeletons/mind.ts` + `SKELETON_REGISTRY` 骨架，把 mind 走通（行为不变，验证 dispatch）
- PR2: 逐个迁移 org/tree/fishbone/timeline/bracket（每图一个小 commit，每迁移一个跑一遍预览）
- PR3: 清理 `MindMapCanvas` 里的 `SKELETON_CSS` 大字符串、散落 branch fn、inline if，删 `setDirection` 守卫

## Open Questions

- 无（接口形状可自行设计，最终确认时一并给出）

## Requirements (evolving)

- 改一种图的 CSS/分支/overlay 不需要碰其它图的代码
- `direction` 等共享字段的守卫逻辑收敛到每种图自己负责，而不是在共享路径上 if 判断
- 现有六种图的渲染行为保持一致

## Acceptance Criteria (evolving)

- [ ] 任一种图的 CSS 修改只动它自己的文件/区块
- [ ] 任一种图的 branch 生成器修改只动它自己的文件/区块
- [ ] direction toolbar 的可用性由该图自己决定，不在 `setDirection` 里写跨类型 if
- [ ] 六种图渲染结果与重构前一致（肉眼对比）

## Definition of Done

- Lint / typecheck 绿
- 六种图各跑一遍预览，渲染与重构前一致
- 没有引入新依赖

## Out of Scope (explicit)

- 不新增图类型
- 不改 mind-elixir 版本
- 不改 mmap 文件解析（`outlineConverter` 的 AST 转换保持现状）
- 不借机调样式参数（间距、配色等保持当前值）

## Feasible approaches

**Approach A: 每图一文件 + 策略对象（Recommended）**
- 做法：新建 `skeletons/{mind,org,tree,fishbone,timeline,bracket}.ts`，每个文件导出 `{ css, branchGenerator, overlayHooks, directionPolicy, init }`。`MindMapCanvas` 留一个 `SKELETON_REGISTRY` 查表 + thin dispatch。
- 优点：最强隔离；新增图只加文件；测试可按图独立跑
- 缺点：文件数 +6；需要抽接口；diff 较大

**Approach B: 单文件分区**
- 做法：保留 `MindMapCanvas.tsx`，但把 `SKELETON_CSS` 拆成六段、branch 生成器和 overlay 按类型分区组织，`applySkeleton` 改成纯查表分派，去掉内联 if
- 优点：最小文件 churn；diff 集中
- 缺点：仍在 1817 行单文件里，物理隔离弱

**Approach C: 配置表抽离 if/else**
- 做法：只把 `applySkeleton`/`setDirection` 里的 if 分支抽成 per-type config 表（`{ fallbackBranch?, overlay?, directionEnabled }`），CSS 和生成器原地不动
- 优点：最小 diff；直接解决 direction 串扰根因
- 缺点：CSS 仍共用一份字符串，改一种图还是要在大字符串里找；物理隔离最弱

## Technical Notes

- 关键文件：`apps/desktop/src/components/file-types/mmap/MindMapCanvas.tsx`、`outlineConverter.ts`
- mind-elixir 实例共享：`inst` 在 `MindMapCanvas` 内创建，`applySkeleton` 是回调注入到 outlineConverter
- 最近相关 commit：`5d1833c`（direction 守卫）、`37ce7a7`（fishbone spine）、`977a553`（tree 间距）
