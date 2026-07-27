# Chat Input Leading Slot Reorder: CLI → Mode → File → Voice

## Goal

调整 AI Panel 与桌宠 Chat 输入框 `leadingSlot` 的图标顺序，让用户视觉路径从「选哪个 CLI」开始，到「以什么模式问」，再到「附什么文件」，最后到「是否语音输入」。

## What I already know

**AI Panel — `apps/desktop/src/components/ai/ChatInput.tsx:310-352`**

当前顺序：
1. `<VoiceInputButton />` (line 312)
2. `<AdapterSelector />` CLI (line 313)
3. File attach `<button>` (line 314-318)
4. Mode dropdown `inputModes` (line 319-350)

目标顺序：
1. CLI — `<AdapterSelector />`
2. Mode — `inputModes` dropdown
3. File — attach button
4. Voice — `<VoiceInputButton />`

**PetChat — `apps/desktop/src/components/pet/PetChat.tsx:388-429`**

当前顺序：
1. File button (line 390-410)
2. `<AdapterSelector />` (line 411)
3. Mode `<select>` (line 415-428)

目标顺序：
1. CLI — `<AdapterSelector />`
2. Mode — `<select>`
3. File — button

PetChat 没有 `VoiceInputButton`（已 grep 确认），无需调整 voice。

## Requirements

- AI Panel `leadingSlot` 子元素顺序：CLI → Mode → File → Voice
- PetChat `leadingSlot` 子元素顺序：CLI → Mode → File → Voice（新增 VoiceInputButton，与 AI Panel 对齐）
- PetChat 引入 `VoiceInputButton`（from `@/components/ai/VoiceInputButton`），放在文件按钮之后，`disabled={streaming}`
- 不改动任何子组件本身（AdapterSelector / VoiceInputButton / mode dropdown / file button 都原样保留，只移动位置 / 新增）
- 现有 className / disabled / title 等属性保持不变
- PetChat 的 mode 用原生 `<select>`，AI Panel 用自定义 dropdown；两者各自原样保留，仅位置变化

## Acceptance Criteria

- [ ] AI Panel 输入框从左到右：CLI 图标 → Mode 文字下拉 → 文件图标 → 麦克风图标
- [ ] 桌宠 Chat 输入框从左到右：CLI 图标 → Mode 下拉 → 文件图标 → 麦克风图标
- [ ] 桌宠 Chat 的麦克风按钮在非 macOS / WebGL 不可用时显示为 disabled 状态（VoiceInputButton 内部已处理）
- [ ] 每个子组件的功能不受影响（点击、disabled、tooltip 维持原状）
- [ ] `tsc -b` 通过

## Definition of Done

- lint / typecheck 绿
- 两个页面手动验证顺序

## Technical Approach

只移动 JSX 顺序，零逻辑改动。

`ChatInput.tsx` 的 `leadingSlot`：把 `<AdapterSelector />` 提到第一，紧跟 `inputModes` 块，再文件按钮，最后 `<VoiceInputButton />`。

`PetChat.tsx` 的 `leadingSlot`：把 `<AdapterSelector />` 提到第一，紧跟 `<select>`，再文件按钮。

## Out of Scope

- 子组件内部行为 / 样式调整
- 引入 flex gap 等额外布局（现有 `ml-0.5` / `w-7 h-7` 间距保留）
- 任何 props / 类型变化

## Technical Notes

- AI Panel mode dropdown 整块（`<div className="relative ml-0.5" ref={modeMenuRef}>...</div>`）作为整体移动
- PetChat 的 `<select>` 是单元素，整体移动即可
- AdapterSelector 在 `sessionKind === 'study'` 时会被隐藏（条件渲染不变），位置仍在最前
