# Tighten Leading-Slot Icon Spacing to 1px

## Goal

AI Panel 与桌宠 Chat 输入框 `leadingSlot` 内图标间距收紧到 1px，视觉更紧凑。

## What I already know

**容器** `apps/desktop/src/components/chat/ChatInputBox.tsx:124`
```
<div className="flex items-center gap-0.5 py-0.5 px-1.5 pb-1.5">
  {leadingSlot}
  ...
</div>
```
- `gap-0.5` = 2px 间距

**子元素额外 `ml-0.5`（导致不一致）：**
- `apps/desktop/src/components/ai/AdapterSelector.tsx:47` 根 `<div className="relative ml-0.5" ref={ref}>`
- `apps/desktop/src/components/ai/ChatInput.tsx:314` Mode wrapper `<div className="relative ml-0.5" ref={modeMenuRef}>`
- `apps/desktop/src/components/pet/PetChat.tsx:396` `<select className="ml-0.5 ...">`

**无 ml 的子元素：** 文件按钮、VoiceInputButton

**当前实际间距：** CLI→Mode = 4px，Mode→File = 2px，File→Voice = 2px（不一致）

## Requirements

- 删除 `AdapterSelector.tsx` 根 `<div>` 的 `ml-0.5`
- 删除 `ChatInput.tsx` Mode wrapper `<div>` 的 `ml-0.5`
- 删除 `PetChat.tsx` `<select>` className 中的 `ml-0.5`
- 把 `ChatInputBox.tsx` 容器 `gap-0.5` 改为 `gap-px`（1px）
- 最终间距统一 1px

## Acceptance Criteria

- [ ] AI Panel: CLI → Mode → File → Voice 间距均为 1px
- [ ] 桌宠 Chat: CLI → Mode → File → Voice 间距均为 1px
- [ ] 容器其他 padding（py-0.5 px-1.5 pb-1.5）保持不变
- [ ] `tsc -b` 通过

## Definition of Done

- typecheck 绿
- 两页面手动验证视觉

## Technical Approach

四处改动，纯 className 字符串调整：
1. `AdapterSelector.tsx:47` — `"relative ml-0.5"` → `"relative"`
2. `ChatInput.tsx:314` — `"relative ml-0.5"` → `"relative"`
3. `PetChat.tsx:396` — 删除 `ml-0.5 `（保留其他 class）
4. `ChatInputBox.tsx:124` — `gap-0.5` → `gap-px`

## Out of Scope

- 任何 padding 调整
- 任何按钮内部尺寸 / 图标尺寸调整
- 任何非 leadingSlot 区域的间距
- chat 组件 trailingSlot / clear 按钮的间距

## Technical Notes

- ChatInputBox 是共享组件（AI Panel + 桌宠 Chat + 测试文件 `ChatInputBox.test.tsx:72` 都用），改 `gap-0.5 → gap-px` 会影响所有调用方的 leadingSlot 间距——但本次任务目标正是统一收紧，因此是预期效果
- AdapterSelector / Mode / PetChat select 的 `ml-0.5` 是历史遗留，删除后间距由容器 `gap-px` 统一控制
