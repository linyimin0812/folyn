# ER 图显示注释/索引/枚举等信息

## Goal

当前 ER 图（DBML file preview）只渲染表名 + 字段名 + 类型 + PK 钥匙图标。DBML 源里的字段 `note`、表 `Note:`、`Enum`、`indexes`、Project `Note` 全部丢失。要让 ER 图把这些注释/元数据展示出来，参考 `~/folyn/default_vault/claude code/agent-loop/ER.dbml` 这种真实文件的内容应能完整呈现。

## Requirements

### Parser 层 (`parseDbml.ts`)

* 暴露字段级 `note`（string，可空）
* 暴露表级 `note`（string，可空，DBML `Note: '''...'''` 三引号块）
* 暴露 `indexes`（每项：`name`, `unique?`, `columns[]`, `note?`）
* 暴露 `enums`（每项：`name`, `values[{name, note}]`）
* 暴露 Project `note`（顶层，string，可空）
* 类型层 `ErSchema` 同步扩展

### Layout 层 (`erLayout.ts`)

* `estimateTableSize` 同步加高：
  * 字段 note 行高（每字段 +一行小字 ≈ 14px）
  * 表 Note 折叠区高度（默认 2 行 ≈ 32px + padding）
  * indexes 区高度（每个 index 一行 ≈ 14px + padding）
  * Enum 卡片高度（每个 value 一行）
* forceCollide 半径跟随新尺寸，避免重叠

### Render 层 (`ErDiagramPreview.tsx`)

* **字段 note**：字段名+类型行下方再加一行 12px 灰色小字（var(--t3)），超宽截断 + `title` tooltip 显示全文
* **表 Note**：卡片底部画一个折叠区，默认显示 2 行（按字符切片成 `<tspan>`，CHAR_W 近似估算宽度），底部加"展开/收起"小按钮切换全文/截断
* **indexes**：表 Note 下方画一个小列表，每行 `idx_name (col1, col2) [unique]` 12px 小字；如无 index 则不画
* **Enum**：当作伪表卡片，复用 `TableCard`，header 用不同色板（EnumPalette）+ header 文字加 `«enum»` 前缀；每个 value 一行（value 名 + 灰色小字 note）
* **Project Note**：SVG 顶部（在 transform group 外、屏幕坐标）一条 banner，显示 `Project: AgentLoop` + Note 全文（长则截断 + 点击展开）
* 长文本换行用 SVG `<tspan>` 按字符切片（CHAR_W 估算），不引入 `<foreignObject>`（避免 SVG transform 下字体不缩放的坑）

## Acceptance Criteria

* [ ] 用 `~/folyn/default_vault/claude code/agent-loop/ER.dbml` 作为预览源时，能看到：
  * 顶部 Project banner
  * 每张表卡片底部有 Note 折叠区，默认 2 行截断，点击展开全文
  * 字段下方一行中文小字 note
  * 卡片底部 indexes 列表
  * 三个 Enum 渲染为伪表卡片，value 带 note
* [ ] parser 单测更新（`parseDbml.test.ts`）：note / indexes / enums / project note 字段在解析结果里存在
* [ ] layout 单测更新：`estimateTableSize` 反映新高度
* [ ] 现有拖拽 / 缩放 / 适应 / 网格切换 不回归
* [ ] lint / typecheck 绿

## Definition of Done

* 测试更新（`parseDbml.test.ts` + 任何布局相关测试）
* lint / typecheck 绿
* 在 dev server 中用真实 ER.dbml 目视验收
* 不破坏现有 ER 图交互（drag / zoom / pan / fit / grid）

## Technical Approach

```
parseDbml.ts
  + ErField.note?: string
  + ErTable.note?: string
  + ErTable.indexes?: ErIndex[]
  + ErSchema.enums?: ErEnum[]
  + ErSchema.projectNote?: string
  + ErEnum { name, values: {name, note}[] }
  + ErIndex { name, unique, columns, note? }

erLayout.ts
  estimateTableSize: +fieldNoteRows +noteBlock +indexBlock
  EnumPalette: 6 色循环
  layoutEr: 把 enums 当作 additional "tables" 喂给 force simulation

ErDiagramPreview.tsx
  TableCard: 增加 field-note 行 / table-note 折叠区 / index 列表
  EnumCard: 复用 TableCard 渲染逻辑（或 TableCard 增加 variant: 'table' | 'enum'）
  ProjectBanner: SVG 顶部 fixed 屏幕坐标，独立于 transform group
  Note 切行工具函数: wrapText(text, maxWidth, charW) => string[]
```

## Decision (ADR-lite)

* **Context**：五类信息要呈现，全内嵌在卡片里
* **Decision**：
  * 字段 note: 字段下方一行小字（截断 + title 全文）
  * 表 Note: 卡片底部折叠区（2 行截断 + 点击展开）
  * indexes: 卡片底部小列表
  * Enum: 伪表卡片（复用 TableCard，header 标 `«enum»`）
  * Project Note: SVG 顶部 banner
  * 长文本换行: SVG `<tspan>` 切片，不用 foreignObject
* **Consequences**：
  * 卡片高度显著增加，force simulation 距离参数需要同步调（distance 220 → 可能需要 280）
  * 字段 note 行可能让卡片宽度也变化（note 文本比 name+type 长），estimateTableSize 已考虑取 max
  * Project banner 在 transform group 外，不随 zoom/pan 移动 — 用户拖图时 banner 固定顶部

## Out of Scope

* Ref 关系线上的 note / label 文本（cardinality marker 已有，关系线本身不需要额外注释）
* DBML TableGroup（分组盒子）渲染
* 修改 DBML 源码（只读预览）
* 导出 PNG/SVG 等导出功能
* Note 内的 Markdown 渲染（按纯文本处理）

## Technical Notes

* `@dbml/core` 的 `export().schemas[0]` 已经返回 `tables[].note` / `tables[].indexes` / `schemas[].enums`，只是当前代码丢掉了
* Project 顶层 note 需要从 `db.export()` 拿（注意不是 schema 级别）—— 实际 `@dbml/core` 把 Project 放在哪需要写代码时验证（可能也在 schema 上，也可能要单独取）
* CHAR_W = 7.2（12px system-ui 近似值，已用于 estimateTableSize）
* ROW_H = 22；新增 FIELD_NOTE_H ≈ 14；NOTE_PAD ≈ 8

## Open Questions

* 无（已收敛）
