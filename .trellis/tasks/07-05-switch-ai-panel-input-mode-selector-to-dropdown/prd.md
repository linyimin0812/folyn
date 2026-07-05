# Switch AI panel input mode selector to dropdown

## Goal

将 ChatInput 底部工具条的模式选择器从 segmented toggle 改为下拉框，为未来更多模式（>3 时）节省横向空间。复用现有 `inputModes` 注册表与 `aiStore.inputMode`，仅改 UI 形态。

## What I already know

- 上一任务（已归档，`5009ca8`）已实现：`inputModes.ts` registry + `aiStore.inputMode`/`setInputMode` + ChatInput segmented toggle。
- ChatInput 当前 toggle 渲染自 `listInputModes()`，`isStreaming` 时 disabled。
- 仓库无自定义下拉组件；AiPanel 顶部有 session 下拉（`AiPanel.tsx:400-426`）可作风格参考（绝对定位面板 + 点击外部关闭）。

## Requirements

- 模式选择器改为下拉框：点击当前模式展开菜单，选项从 `listInputModes()` 渲染，选中后 `setInputMode(id)` 并收起。
- 流式中 disabled；study session 不渲染（沿用现状，ChatInput 不挂载）。
- 行为/数据流不变（`resolveSendOptions` + `CliSendOptions` 透传不动）。

## Acceptance Criteria

- [ ] 点击模式按钮展开下拉，列出全部已注册模式（label + 可选 description）。
- [ ] 选中后高亮当前项、收起菜单、下次发送生效。
- [ ] 流式中下拉 disabled；点击外部收起。
- [ ] registry/aiStore/adapter 层零改动；现有单测仍全绿。

## Out of Scope

- 不动 `inputModes.ts` / `aiStore` / cli-adapter。
- 不新增模式、不改 ask/agent 语义。

## Technical Notes

- 仅改 `apps/desktop/src/components/ai/ChatInput.tsx`（替换 segmented toggle 区块为下拉）。
- 参考 AiPanel session 下拉的"点击外部关闭"模式（`useEffect` + `mousedown` 监听）。
