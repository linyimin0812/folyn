# AI Panel & Desktop Pet CLI Selector: Icon + Name

## Goal

让 AI Panel 和桌宠 Chat 共用的 CLI 选择器（`AdapterSelector`）折叠时只显示图标，下拉时显示「图标 + 名称」。当前两处都只显示纯文字，仓库里已有的 `pi.svg` / `claude_code.svg` 一直没被引用。

## What I already know

- 共用组件：`apps/desktop/src/components/ai/AdapterSelector.tsx`
  - 折叠按钮：`{current?.displayName}` + chevron（line 47-50）
  - 下拉行：`{a.displayName}`（line 63）
  - 使用方：`ChatInput.tsx:313`、`PetChat.tsx:411`
- Registry：`packages/cli-adapter/src/registry.ts`
  - `AdapterDescriptor = { displayName, description, factory }` — **无 icon 字段**
  - `listAdapters()` 返回 `{ id, displayName, description }[]`
- 资源：`apps/desktop/src/assets/agents/{pi,claude_code}.svg` 存在但零引用
- Registry 是 package，不能反向引用 app 内的 assets

## Requirements

- 折叠按钮渲染：当前选中 adapter 的图标（Pi→pi.svg，Claude Code→claude_code.svg），不再渲染 `displayName` 文字；保留 chevron 与 `title={description}`
- 下拉每行渲染：图标 + `displayName` 文字
- 图标 → adapter id 的映射放在 `AdapterSelector.tsx` 内（registry 保持 package-pure，不引用 app assets）
- 未知 adapter id 兜底：不渲染图标，仅保留文字 / 现有行为
- 仅两个 adapter，映射表硬编码即可，不引入新抽象

## Acceptance Criteria

- [ ] AI Panel 输入框折叠态：只显示当前 CLI 的图标 + chevron
- [ ] 桌宠 Chat 折叠态：同上
- [ ] 下拉打开：每项显示「图标 + 名称」，选中项高亮（保留现有 active 样式）
- [ ] 鼠标悬停下拉项仍显示 `title={description}`
- [ ] `pnpm typecheck` 通过（registry / listAdapters 的形状未变，无需改类型）

## Definition of Done

- lint / typecheck 绿
- 两个使用页面手动验证（AI Panel + 桌宠 Chat）

## Technical Approach

`AdapterSelector.tsx` 顶部新增：

```tsx
import claudeIcon from '@/assets/agents/claude_code.svg';
import piIcon from '@/assets/agents/pi.svg';
const ADAPTER_ICON: Record<string, string> = { claude: claudeIcon, pi: piIcon };
```

按钮：把 `<span>{current?.displayName}</span>` 替换为 `<img src={ADAPTER_ICON[current.id]} alt={current.displayName} className="w-4 h-4" />`，`title` 保留。

下拉行：`<img .../>` + `<span>{a.displayName}</span>`，flex 居中、`gap-1.5`。

不动 `registry.ts`，不动 `listAdapters()` 的返回形状。

## Decision (ADR-lite)

**Context**: SVG 资源在 app 包，registry 在独立 package；让 registry 引用 app assets 会破坏 package 边界。
**Decision**: 图标映射放 `AdapterSelector.tsx` 内的局部常量表；adapter id 是稳定 key。
**Consequences**: 新增 adapter 时需同时在这里加一行 import + 表项。可接受——adapter 极少新增，且本就是 app 层 UI 决策。

## Out of Scope

- registry / `listAdapters()` 类型变化
- 动态从 registry 读 icon 字段
- 其他 CLI（只 pi / claude code 两个）
- 国际化 / dark mode 图标变体

## Technical Notes

- 共用单组件 → 一处改动覆盖 AI Panel + 桌宠 Chat
- SVG import 走 Vite 默认资源处理（同仓库其他 `*.svg` import 已有先例）
