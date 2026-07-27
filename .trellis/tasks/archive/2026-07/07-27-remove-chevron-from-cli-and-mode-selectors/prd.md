# Remove Chevron from CLI & Mode Selectors

## Goal

去掉 CLI 选择器和 Mode 选择器按钮上的下拉箭头图标（chevron svg）。按钮本身就是点击区域——点 CLI 图标弹 CLI 选择，点 Mode 文字弹 Mode 选择。

## What I already know

涉及两个文件的 chevron svg：

**`apps/desktop/src/components/ai/AdapterSelector.tsx`**
- 折叠按钮 line 55-57：`<svg ...><path d="M4 6 L8 10 L12 6" /></svg>` 是 chevron
- 点击行为已就绪：`onClick={() => setOpen((v) => !v)}`（line 50）
- 下拉渲染逻辑保留不变

**`apps/desktop/src/components/ai/ChatInput.tsx`**
- Mode 按钮 line 328-330：`<svg ...><path d="M4 6 L8 10 L12 6" /></svg>` 是 chevron
- 点击行为已就绪：`onClick={() => setModeMenuOpen((v) => !v)}`（line 323）
- 下拉渲染逻辑保留不变

**`apps/desktop/src/components/pet/PetChat.tsx`**
- Mode 用原生 `<select>`（line 415-428），无 JSX chevron，原生下拉箭头由 OS 提供
- 已是「点击弹出」语义，无需改动

## Requirements

- 删除 `AdapterSelector.tsx` 折叠按钮内的 chevron `<svg>`，只保留 `<img>` 图标
- 删除 `ChatInput.tsx` Mode 按钮内的 chevron `<svg>`，只保留 `<span>{label}</span>` 文字
- 给 `PetChat.tsx` 的 Mode `<select>` 加 `appearance-none`（含 `-webkit-appearance-none` 兜底 / Tailwind 已封装为 `appearance-none`），隐藏 OS 原生下拉箭头，使三处选择器视觉一致
- 点击按钮展开 / 收起下拉的行为完全不变（CLI 与 AI Panel Mode 用现有 `onClick`；PetChat `<select>` 仍由原生点击触发）
- 下拉菜单本身（CLI 列表 / Mode 列表）的渲染、样式、选中态不变

## Acceptance Criteria

- [ ] AI Panel 折叠态 CLI 按钮只剩图标，无箭头
- [ ] AI Panel Mode 按钮只剩文字（"Agent" / "Ask" / "Chat"），无箭头
- [ ] 桌宠 Chat CLI 按钮只剩图标，无箭头
- [ ] 桌宠 Chat Mode `<select>` 不再显示 OS 原生下拉箭头
- [ ] 点击 CLI 图标 → 弹出 CLI 列表
- [ ] 点击 Mode 文字 → 弹出 Mode 列表
- [ ] 桌宠 Chat Mode 点击仍能弹出原生选项
- [ ] `tsc -b` 通过

## Definition of Done

- typecheck 绿
- AI Panel + 桌宠 Chat 两个页面手动验证点击弹出

## Technical Approach

只删除 chevron `<svg>` 元素。button className 里 `gap-1` 可以保留（无副作用），也可以改成 `gap-0` / 删 gap；选保留——`gap-1` 对单子元素无影响，diff 最小。

## Out of Scope

- 任何下拉菜单内部样式 / 行为调整
- 任何按钮 className 之外的样式改动（除 PetChat `<select>` 的 `appearance-none`）
- 把 AI Panel Mode 自定义 dropdown 改成原生 `<select>` 或反向

## Technical Notes

- chevron svg 是上一次任务里新加的（commit `dc2c8f0`），不是历史遗留
- 现有 `onClick` 已是 toggle，无需新逻辑
- `title={description}` / `disabled` 等属性保留
