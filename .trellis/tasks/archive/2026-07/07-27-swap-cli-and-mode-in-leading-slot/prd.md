# Swap CLI and Mode Order in Leading Slot

## Goal

把 leadingSlot 前两个图标（CLI / Mode）位置交换：当前 CLI → Mode → File → Voice，目标 Mode → CLI → File → Voice。

## What I already know

**AI Panel — `apps/desktop/src/components/ai/ChatInput.tsx:310-352`**
当前 JSX 顺序：
1. `<AdapterSelector disabled={isStreaming || sessionLocked} />` (gated by `sessionKind !== 'study'`)
2. Mode dropdown block `<div className="relative" ref={modeMenuRef}>...</div>`
3. File button
4. `<VoiceInputButton />`

**PetChat — `apps/desktop/src/components/pet/PetChat.tsx:388-431`**
当前 JSX 顺序：
1. `<AdapterSelector disabled={streaming} />`
2. `<select>...</select>` (mode)
3. File button
4. `<VoiceInputButton disabled={streaming} />`

## Requirements

- AI Panel `leadingSlot`：把 Mode dropdown 块移到 `<AdapterSelector />` 之前；CLI 与 Mode 交换位置
- PetChat `leadingSlot`：把 `<select>` 移到 `<AdapterSelector />` 之前；CLI 与 Mode 交换位置
- 不改任何子组件本身（AdapterSelector / mode dropdown / select / file button / VoiceInputButton 原样保留）
- 现有 className / disabled / title / ref 等属性保持不变
- AI Panel Mode 条件渲染 `{inputModes.length > 1 && (...)}` 保留；AdapterSelector 的 `sessionKind !== 'study'` 门控保留

## Acceptance Criteria

- [ ] AI Panel 输入框从左到右：Mode → CLI → File → Voice
- [ ] 桌宠 Chat 输入框从左到右：Mode → CLI → File → Voice
- [ ] study session 时 AdapterSelector 仍隐藏，Mode 仍显示
- [ ] `tsc -b` 通过

## Definition of Done

- typecheck 绿
- 两页面手动验证

## Technical Approach

只移动 JSX 顺序，零逻辑改动。两个文件各一处块移动。

## Out of Scope

- 子组件内部行为 / 样式
- 任何 className 调整
- 任何 props / 类型变化

## Technical Notes

- AI Panel Mode 是自定义 dropdown（整块 div 整体移动）
- PetChat Mode 是原生 `<select>`（单元素移动）
- AdapterSelector 在 `sessionKind === 'study'` 时被隐藏——位置仍紧贴 Mode 之后
