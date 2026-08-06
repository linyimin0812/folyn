# 优化 mmap 树型图样式

## 背景

`apps/desktop/src/components/file-types/mmap/MindMapCanvas.tsx` 中的 `tree` skeleton 是 mmap 文件预览的六种骨架之一（mind/org/tree/fishbone/timeline/bracket）。当前实现可工作，但有几处不符合 better-layout 原则：

1. **间距比例不达标**：`--node-gap-y: 48px`（兄弟节点）/ `--main-gap-y: 90px`（根→一级）。better-layout 原则 1 要求 inter-group ≥ 2× intra-group，90/48 ≈ 1.875 不达标。
2. **物理属性而非逻辑属性**：`margin-left: 56px` / `padding-left: 0` 使用物理左右，RTL 布局会破。原则 3 要求方向相关布局用 logical properties。
3. **连接线为硬直角 elbow**：treeBranch 用直角 elbow，视觉偏硬；树型图常用圆角连接更柔和。
4. **非叶节点边框偏重**：`border: 2px solid var(--main-color)` + `background-color: var(--main-bgcolor)`，与叶节点（无边框纯文本）对比过强，层级感粗暴。

## 目标

按 better-layout 原则优化 tree skeleton 的视觉与方向无关性，不改渲染结构、不改数据流、不影响其他五种骨架。

## 方案

### 1. 间距比例（intra/inter）

`SKELETON_CSS` 中 tree 段：
- `--node-gap-y: 48px` 保持（intra-group，兄弟节点）
- `--main-gap-y: 90px` → `--main-gap-y: 96px`（inter-group，根→一级，恰好 2×）

### 2. 逻辑属性

`SKELETON_CSS` 中 tree 段：
- `me-children { margin-left: 56px }` → `margin-inline-start: 56px`
- `me-parent { padding-left: 0 }` → `padding-inline-start: 0`

注：`me-nodes { padding: 24px }` 是对称的，无需改。

### 3. 连接线圆角

`treeBranch` 函数（MindMapCanvas.tsx:212）改用圆角 elbow：

```ts
function treeBranch({ pT, pL, pW, pH, cT, cL, cH }: SkeletonBranchParams): string {
  const x1 = pL + pW;
  const y1 = pT + pH / 2;
  const x2 = cL;
  const y2 = cT + cH / 2;
  if (Math.abs(y2 - y1) < 2) {
    return `M ${x1} ${y1} L ${x2} ${y2}`;
  }
  const midX = x1 + (x2 - x1) / 2;
  const r = 8;
  const dy = y2 - y1;
  const rY = Math.sign(dy) * Math.min(r, Math.abs(dy) / 2);
  return `M ${x1} ${y1} H ${midX - r} Q ${midX} ${y1} ${midX} ${y1 + rY} V ${y2 - rY} Q ${midX} ${y2} ${midX + r} ${y2} H ${x2}`;
}
```

- 当父子 y 接近时仍是单条水平线
- 否则用两个二次贝塞尔在拐角处过渡，半径 8px
- `rY` 用 `Math.sign(dy)` 处理 y2 < y1（子在父上方）情形

### 4. 非叶节点边框柔化

`SKELETON_CSS` 中 tree 段 `me-wrapper:has(...)` 选择器：
- `border: 2px solid var(--main-color)` → `border: 1.5px solid var(--main-color)`
- `background-color: var(--main-bgcolor)` → 删除（透明）
- `border-radius: var(--main-radius)` 保留

效果：非叶节点只剩细边框轮廓，叶节点仍是纯文本，层级对比柔和。

## 验收

- 切到 tree skeleton 预览时：
  - 根→一级间距 96px，兄弟间 48px（2:1）
  - 连接线拐角圆滑（半径 8px）
  - 非叶节点细边框（1.5px），无填充
  - 切到 RTL 字体（如阿拉伯语）布局不破
- 其他五种骨架（mind/org/fishbone/timeline/bracket）渲染不变
- `MindMapCanvas.click.test.tsx` 现有用例不破

## 不做

- 不改 outlineConverter、不改数据模型
- 不动其他 skeleton 的 CSS / branch 函数
- 不引入新依赖
- 不改样式面板（StylingPanel / StylePanelFooter）
- 不加 RTL 测试用例（仅保证 CSS 不破即可，验证靠手测）
