# Markdown 表格预览算法优化

## Goal

让 `.md-preview` 里的 markdown 表格用浏览器原生 `table-layout: auto`（它本身就是内容感知 + 最小/理想宽度 + 优先级压缩算法）正常工作，修掉阻碍它的 CSS，并对宽表加溢出兜底。

## What I already know

现状（`apps/desktop/src/index.css:536-539`）：

```css
.md-preview table { border-collapse: collapse; width: 100%; margin: 12px 0; table-layout: auto; }
.md-preview th, .md-preview td { border: 1px solid var(--brd); padding: 6px 12px; font-size: 12px; text-align: left; }
.md-preview td { overflow-wrap: anywhere; word-break: break-word; }
.md-preview th { background: var(--surf); font-weight: 600; white-space: nowrap; }
```

容器 `.md-preview { max-width: 800px; margin: 0 auto }`（`index.css:468`）。

聊天消息里 `.msg-md table`（`index.css:420`）已用 `display: block; width: max-content; max-width: 100%; overflow-x: auto` —— 可作为参考模式，但 `display: block` 会丢掉 `table-layout: auto` 的列压缩能力（中等表会直接撑到 max-content 而非按容器压缩）。

## 坏的 CSS 与影响

| CSS | 破坏了什么 |
|---|---|
| `width: 100%` | 窄表被撑满容器，留大量空白 |
| `th { white-space: nowrap }` | 长表头撑爆容器，不允许换行 |
| `td { overflow-wrap: anywhere; word-break: break-word }` | 最小宽度被压成单字符宽，列宽失真 |

## Technical Approach

### 目标 CSS

```css
.md-preview table {
  border-collapse: collapse;
  width: max-content;       /* 窄表不撑满 */
  max-width: 100%;          /* 超过容器时压缩 */
  margin: 12px 0;
  table-layout: auto;       /* 浏览器内容感知 + 优先级压缩 */
}
.md-preview th, .md-preview td {
  border: 1px solid var(--brd);
  padding: 6px 12px;
  font-size: 12px;
  text-align: left;
}
.md-preview td { overflow-wrap: break-word; }  /* 只在长无空格串才断 */
.md-preview th { background: var(--surf); font-weight: 600; }  /* 去掉 nowrap */
```

行为：
1. 窄表 → `width: max-content` 保持自然宽度
2. 中等表（理想宽 > 容器）→ `max-width: 100%` 触发，`table-layout: auto` 按优先级压缩列
3. 宽表（所有列最小宽度之和 > 容器）→ 溢出，需兜底（见 Open Question 1）

## Decisions

### 宽表溢出兜底：componentMap wrapper + overflow-x:auto

在 `MarkdownPreview.tsx` 的 `componentMap` 加 `table` 映射，包一层 `<div class="md-table-wrap">`，CSS 设 `overflow-x: auto`。仅表格本身滚动，不动 `.md-preview` 父容器。与聊天 `.msg-md table` 模式一致。

```tsx
map['table'] = function TableWrapper(props: any) {
  const { children, node, ...rest } = props;
  return createElement('div', { className: 'md-table-wrap' },
    createElement('table', rest, children));
};
```

```css
.md-table-wrap { overflow-x: auto; max-width: 100%; margin: 12px 0; }
.md-preview .md-table-wrap table { width: max-content; max-width: 100%; margin: 0; }
```

## Requirements

- 窄表格保持自然宽度，不被 `width:100%` 撑满
- 表头允许换行（去掉 `white-space: nowrap`）
- 单元格不在任意字符断行（去掉 `word-break: break-word`），仅长无空格串断行
- 宽表（min-widths 之和 > 容器）在 `md-table-wrap` 内横向滚动，不破坏整体布局

## Acceptance Criteria (evolving)

- [ ] 3 列窄表（每列 1-2 词）渲染宽度 ≈ 内容自然宽度，不撑满 800px
- [ ] 含长表头的表，表头自动换行而非撑爆容器
- [ ] 含长 URL/路径的单元格，仅在长串处断行，普通文本按词换行
- [ ] 宽表（如 8 列长内容）在容器内不撑破布局

## Definition of Done

- CSS 改动落地，无回归
- 手动验证窄/中/宽三类表
- 不引入新依赖

## Out of Scope

- JS 测量列宽的自定义算法（浏览器 auto-layout 已是内容感知 + 优先级压缩）
- 列优先级可配置（哪些列优先压缩）
- 跨 export/preview 一致行为（export 走 `renderMarkdownToHtmlViaDom`，继承 preview，天然一致）

## Technical Notes

- `table-layout: auto` 的浏览器算法：每列计算 `min-content`（最长不可断 token）和 `max-content`（理想单行宽度），可用宽度按 `(max-min)` 比例分配——这正是用户描述的"内容感知 + 最小/理想宽度 + 容器约束 + 优先级压缩"。
- `.md-preview` 容器有 `max-width: 800px`，是表格压缩的约束边界。
- 影响范围：仅 `.md-preview table`；`.msg-md table`（聊天）独立样式不在本次范围。
