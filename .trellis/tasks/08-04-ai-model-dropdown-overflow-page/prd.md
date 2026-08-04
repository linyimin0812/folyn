# AI Model 下拉框溢出页面

## Goal

语音输入设置页（以及同模式的 Plugins 设置页）底部的 `PairSelector` 下拉面板从触发器左边缘向右展开，触发器又位于 `Row`（justify-between）右侧且紧贴设置页右边缘，导致 `w-max` 面板溢出页面右边缘，无法选中部分条目，体验差。

## What I already know

- `PairSelector`（`apps/desktop/src/components/ai/PairSelector.tsx:190`）面板 className：`absolute left-0 ... w-max min-w-[220px] max-w-[360px]`。
- 调用点：
  - `VoiceSettings.tsx:291` — `trigger='full'`（默认），位于 `Row` 右侧；外层 SettingsPage 对 voice tab 用 `w-fit min-w-[60vw] shrink-0`，行内内容宽 → 触发器贴近右边缘。
  - `PluginsSettings.tsx:295` — 同模式。
  - `BubbleTemplateAIChatModal.tsx:408` — 模态内。
  - `ChatInput.tsx:772` — `trigger='icon'` + `dropDirection='up'`，聊天输入栏右上工具区。
- 上一轮已移除 `VoiceSettings` 根节点 `whitespace-nowrap`，但与本次下拉溢出无关。

## Root Cause

`absolute left-0` 锚定面板左边缘到触发器左边缘，面板向右生长。在 right-aligned 触发器场景下右侧无空间 → 溢出。

## Feasible approaches

**Approach A: 全局 `right-0`** (Recommended)

- 把 `left-0` 改为 `right-0`，面板从触发器右边缘向左生长。
- 一行改动，4 个调用点同时受益。
- 风险：ChatInput 的 icon 触发器若位于工具栏中部，`right-0` 会让面板向左延伸覆盖输入框区域 —— 但 `dropDirection='up'` 已是向上覆盖，方向一致，视觉可接受。

**Approach B: 新增 `dropAlign` prop**

- 给 `PairSelector` 加 `dropAlign?: 'left' | 'right'`，默认 `'left'`；VoiceSettings / PluginsSettings 传 `'right'`。
- 改 3 个文件，更显式但更啰嗦。

## Decision (ADR-lite)

**Context**: PairSelector 下拉面板在 right-aligned 触发器场景下向右溢出页面。

**Decision**: Approach A —— 把面板锚定从 `left-0` 改为 `right-0`，面板从触发器右边缘向左生长。

**Consequences**: 一行改动覆盖 4 个调用点（VoiceSettings / PluginsSettings / BubbleTemplateAIChatModal / ChatInput icon 变体）。ChatInput 的 icon 变体面板改向左生长，但其 dropDirection='up' 已向上覆盖输入框区域，方向一致。若后续出现新调用点位于左侧导致左溢出，再加 `dropAlign` prop。


## Out of Scope

- 下拉面板的滚动、键盘导航、max-h 行为（已存在 `max-h-[300px] overflow-y-auto`，本次不动）。
- 同类溢出但未被报告的页面（如 BubbleTemplateAIChatModal 模态内布局，单独评估）。

## Acceptance Criteria

- [ ] 语音输入设置页点击 AI Model 选择器，下拉面板完整可见、不溢出页面右边缘。
- [ ] Plugins 设置页同样不溢出。
- [ ] ChatInput 的 icon 变体下拉面板不出现错位/溢出左侧。
