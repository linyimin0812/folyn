# CLI 设置页：适配器图标 + 检测/测试按钮分隔

## Goal

CLI 工具设置页（`apps/desktop/src/components/settings/CliSettings.tsx`）每张卡片当前只显示 `displayName` 文字，缺乏视觉识别；"检测路径" 与 "测试连接" 两个按钮被拼成同一胶囊（`rounded-l` + 分隔线 + `rounded-r`），用户视觉上不易区分两个动作。本次任务给每张卡片加适配器品牌图标，并把两个按钮在视觉上分开。

## What I already know

* 6 个适配器：claude / codex / pi / qoder / qoder-cn / opencode / gemini（共 7 项，qoder-cn 与 qoder 共享图标）。
* 品牌图标已存在于 `apps/desktop/src/assets/agents/`：`claude_code.svg / codex.svg / gemini.svg / opencode.svg / pi.svg / qoder.svg`。
* 现状按钮组：`CliSettings.tsx:98-161`，input → 检测按钮(`rounded-l-md`) → 1px divider → 测试按钮(`rounded-r-md`)，连成一个胶囊。input 与按钮组也是连体的（input `rounded-l-md`，按钮组右端 `rounded-r-md`）。
* `a.id` → 图标文件映射：claude→claude_code.svg；codex→codex.svg；pi→pi.svg；qoder 与 qoder-cn→qoder.svg；opencode→opencode.svg；gemini→gemini.svg。

## Decision (ADR-lite)

**Context**: 检测/测试按钮当前连成单胶囊，视觉动作边界不清；标题缺图标识别。
**Decision**: 
1. 图标：放 `displayName` 左侧，16×16，与基线对齐。复用 `AdapterSelector.tsx` 同款 `ADAPTER_ICON` 映射（claude→claude_code.svg 等，qoder-cn 复用 qoder.svg）。
2. 按钮：拆开连体胶囊，检测按钮独立 `rounded-md`，测试按钮独立 `rounded-md`，中间 6px gap（`gap-1.5`）；input 仍 `rounded-l-md` 与检测按钮连体（input→检测 是输入+自动填充的关系，保持连体合理；检测→测试 是两个独立动作，需分开）。

**Consequences**: 
- 图标映射第三份拷贝（AdapterSelector / AgentCliTag / CliSettings）— 用 `ponytail:` 注释标记，后续可提取共享模块。
- input 与检测按钮仍连体，保留"path 输入 → 一键检测"的视觉关系。

## Open Questions

* (无)

## Requirements

* 每张适配器卡片在标题左侧显示对应品牌 SVG 图标（16×16，与 `displayName` 基线对齐）。
* "检测" 与 "测试连接" 按钮各自独立圆角（`rounded-md`），中间留 `gap-1.5` (~6px)；input→检测 仍连体。
* 行为/文案/loading 不变。

## Acceptance Criteria

* [ ] 7 张适配器卡片标题左侧均出现正确品牌图标（qoder-cn 复用 qoder.svg）。
* [ ] 检测按钮和测试按钮不再共享同一胶囊外形，各自独立圆角，中间留 ~6px gap。
* [ ] input → 检测按钮仍保持连体（共用胶囊左半）。
* [ ] 按钮行为、loading 态、结果文案不变。

## Definition of Done

* TS 编译无新增 error。
* `CliSettings.tsx` 内通过；无新依赖。
* 6 个图标在浅/深色背景下均可见（SVG 已有，沿用既有渲染方式即可）。

## Out of Scope

* 新增适配器或调整适配器注册顺序。
* 重构按钮 loading / 状态机。
* 国际化文案改动。

## Technical Notes

* 渲染 SVG：项目已用 Vite，可直接 `import claudeIcon from '@/assets/agents/claude_code.svg'`，标签 `<img src={...} />`。或用 `?react` 转内联组件 — 看项目已有用法。
* `qoder-cn` 与 `qoder` 同 id 前缀，映射时注意不要漏掉 cn。
* 图标尺寸若 > 行高会顶起布局，需控制 `h-[16px] w-[16px]` 之类固定尺寸。
