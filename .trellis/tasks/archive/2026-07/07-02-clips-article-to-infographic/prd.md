# clips: article → infographic

## Goal

在 clips（网页知识卡片）能力里增加"把文章转为信息图"的能力，并在现有 clip 卡片页面（`ClipCardView`）下展示信息图，让用户能用一张可视化图快速回顾文章要点。

## What I already know

- clips 现有页面：`components/file-types/clip/ClipCardView.tsx`——从 markdown frontmatter + `## 摘要` + `## 要点` 渲染卡片（title/url/tags/summary/keyPoints）。
- 生成链路：`services/clipService.ts`（`generateClip` / `saveClip` / `clipUrl`，AI 流式生成元数据）+ clips agent（输出 JSON：title/tags/suggestedTags/summary/keyPoints）。
- clip 文件是 markdown，存 vault 内；`ClipCardView` 用正则解析 frontmatter 与 `## 摘要`/`## 要点` 段。
- 技术栈：React 18 + TS strict + Tailwind 3 + CodeMirror 6 + Tauri 2；AI 调用走 `@quill/cli-adapter` + feature agent 机制（`featureAgentService`）。
- 已有可视化参考：`components/graph/`（D3 force-directed wiki 图）。

## Assumptions (temporary)

- 信息图由 AI 基于已剪藏的文章内容（summary + keyPoints + 原文）生成。
- 生成是按需触发（用户点"生成信息图"按钮），非自动。
- 信息图数据持久化进 clip markdown 文件（新 `## 信息图` 段），与现有摘要/要点共存。

## Open Questions

（已收敛——见 Decision）

## Requirements

- 在 `ClipCardView` 卡片内增加"信息图"区域：无信息图时显示"生成信息图"按钮；有信息图时渲染海报式卡片并显示"重新生成"按钮。
- 扩展 clips agent 增加"信息图模式"：输入 clip 的 title/url/summary/keyPoints（来自已剪藏文件，不 WebFetch），输出 `{ version: 1, blocks: Block[] }` 纯 JSON，9 种 block 类型（hero/stat/keypoints/timeline/steps/comparison/quote/tags/source）。
- `clipService` 新增 `generateInfographic(filePath)`：读取 clip 文件 → 调 clips agent（信息图模式）→ 防御式 JSON 解析（复用 `aiText.match(/\{[\s\S]*\}/)`）→ 写回 clip markdown 的 `## 信息图` 段（fenced JSON codeblock）。
- `ClipCardView.parseClipContent` 扩展：解析 `## 信息图` 段的 JSON，传给 `InfographicView` 渲染。
- 新增 `InfographicView` 组件：`blocks.map(b => <BlockView {...b} />)`，9 个 BlockView 子组件，未知 type 走 fallback（渲染为纯文本段，不抛错）。
- 重新生成：用户可点"重新生成"覆盖现有 `## 信息图` 段（基于当前 clip 内容，反映编辑后的 summary/keyPoints）。
- 失败降级：生成失败显示错误提示，不破坏已有卡片内容。

## Acceptance Criteria

- [ ] clip 卡片页有"信息图"区域：无数据时显示"生成信息图"按钮，点击后调 clips agent 生成。
- [ ] 生成成功后渲染 9 种 block 类型的海报式卡片，重开文件信息图仍在。
- [ ] 有信息图时显示"重新生成"按钮，点击后基于当前 clip 内容覆盖刷新。
- [ ] agent 输出非法 JSON 或未知 block type 时，renderer 走 fallback 不崩溃，UI 显示降级提示。
- [ ] 生成失败不破坏已有卡片内容，显示错误。
- [ ] `parseClipContent` 单测覆盖 `## 信息图` 段解析（含空/非法 JSON）。
- [ ] BlockView 单测覆盖各 type 渲染 + 未知 type fallback。
- [ ] tsc + vitest 绿。

## Definition of Done

- tsc / vitest 绿；新增单测覆盖信息图数据解析与各 BlockView 渲染。
- 遵循 desktop frontend spec（named exports、Tailwind、`@/` alias、Zustand granular selectors）。
- clips agent 的信息图模式输出契约写进 `features/clips/.claude/agents/clips.md`。

## Technical Approach

- **Schema**：`{ version: 1, blocks: Block[] }`，扁平有序，9 种 block 类型（见 research/infographic-schema.md）。
- **Agent**：扩展 `features/clips/.claude/agents/clips.md`，加"信息图模式"——instruction 标注模式，agent 输出 infographic JSON（与现有卡片元数据 JSON 共存于同一 agent 的两种输出契约）。
- **Service**：`clipService.generateInfographic(filePath)` 读取 clip → 调 `featureAgentService` 发 clips agent（信息图模式 instruction）→ 防御式解析 → 写回 `## 信息图` 段。
- **Render**：`ClipCardView` 解析 `## 信息图` 段 → `InfographicView`（新组件，`components/file-types/clip/InfographicView.tsx`）按 type 渲染 9 个 BlockView。
- **Store**：`clipStore` 增加 `isGeneratingInfographic` / `infographicError` 状态 + `generateInfographic` action（参考现有 `isClipping` 模式）。
- **持久化**：`## 信息图` 段格式 = `## 信息图\n\`\`\`json\n{...}\n\`\`\``，与 `## 摘要`/`## 要点` 同级，正则解析。

## Decision (ADR-lite)

- **Context**：信息图需选 schema、agent 形态、MVP 范围。
- **Decision**：扁平 9 类型 block schema（Approach A）；扩展 clips agent 加信息图模式（不新增 agent）；MVP 含重新生成；失败降级为基线；不做图片导出/D3/grid 树。
- **Consequences**：9 个 BlockView 渲染工作量最大但表现力足；clips agent 双模式需清晰 instruction 区分，输出契约文档要写清两种 JSON 形状；后续若要图片导出或多主题再扩展。

## Implementation Plan (small PRs)

- **PR1（数据层）**：扩展 `clips.md` agent 信息图模式契约；`clipService.generateInfographic` + `## 信息图` 段读写；`clipStore` 状态/action；`parseClipContent` 解析扩展 + 单测。
- **PR2（渲染层）**：`InfographicView` + 9 个 BlockView 子组件 + 未知 type fallback + 单测；`ClipCardView` 接线（按钮 + 区域）。
- **PR3（收尾）**：重新生成流程；失败/降级 UI；spec 更新；端到端验证。

## Research References

* [`research/infographic-schema.md`](research/infographic-schema.md) — Notion/Editor.js/Lexical 三家共识：扁平有序 block 列表，布局交渲染层；推荐 ~9 种 block 类型的 `{ version, blocks: [{type,...}] }` schema。

## Research Notes

- 共识 schema：`{ version: 1, blocks: Block[] }`，扁平有序，无 grid/section 树。
- 推荐 block 类型：`hero` / `stat` / `keypoints` / `timeline` / `steps` / `comparison` / `quote` / `tags` / `source`。
- 渲染：`blocks.map(b => <BlockView type={...} {...b} />)`，每 type 一个自包含 Tailwind 卡片段，多列是 per-block 渲染决策（如 stat 用 `grid grid-cols-2 md:grid-cols-4`）。
- 关键约束：agent 输出纯 JSON 无 fence；复用 `clipService` 的 `aiText.match(/\{[\s\S]*\}/)` 防御式解析；renderer 对未知 type 走 fallback 不抛错。
- 复用：`keypoints` block 直接复用现有 `## 要点`，不重新抓页面。
- 持久化：clip markdown 新增 `## 信息图` 段，内含一个 fenced JSON codeblock，`ClipCardView.parseClipContent` 同款正则解析。

## Feasible approaches

**Approach A: 扁平 block 列表 + 9 类型全量**（研究推荐 ✅ 已选）
- 9 种 block 类型全上，表现力最强。
- 渲染工作量大（9 个 BlockView）。

**Approach B: 扁平 block 列表 + MVP 4 类型**（hero / stat / keypoints / quote）
- 最小可用，覆盖 80% 文章可视化。
- 渲染工作量小，后续按需加类型。

**Approach C: 扁平 block 列表 + MVP 6 类型**（hero / stat / keypoints / timeline / quote / tags）
- 平衡：常见文章场景都能覆盖，去掉 comparison/steps/source 这种偏场景的。
- 中等渲染工作量。

## Out of Scope (explicit)

- 不做 grid/section 布局树（扁平列表足够）。
- 不用 D3 / 重型布局引擎。
- 不重新抓取网页（基于已剪藏 summary/keyPoints）。
- 不做信息图导出为图片（后续可加）。

## Technical Notes

- 受影响文件候选：`ClipCardView.tsx`、`clipService.ts`、`features/clips/.claude/agents/clips.md`（或新 agent）、`store/clipStore.ts`。
- clip markdown 结构示例（来自 `ClipCardView` 解析逻辑）：
  ```
  ---
  title: ...
  url: ...
  tags: [...]
  clipped: ...
  ---
  ## 摘要
  ...
  ## 要点
  - ...
  ```
