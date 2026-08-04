# CLI 工具设置页 i18n

## Goal
CliSettings.tsx 仍残留两处中文硬编码，与已 i18n 的 `settings:cli.*` 不一致。将其切换到 i18n，模式对齐 08-04-shortcuts-settings-i18n。

## What I already know
- `apps/desktop/src/components/settings/CliSettings.tsx:75` 硬编码中文："每个 Adapter 独立配置可执行文件路径；会话使用哪个 Adapter 在 AI Panel / 桌宠 Chat 里选，此处仅做配置。"
- `apps/desktop/src/components/settings/CliSettings.tsx:90` 直接渲染 `a.description`，该值来自 `packages/cli-adapter/src/registry.ts`：
  - claude: `'Anthropic 官方 CLI 工具，支持对话式编辑与多工具调用'`
  - pi: `'pi 代码 Agent（@earendil-works/pi-coding-agent），read/bash/edit/write 工具，rpc 多轮会话'`
- `a.displayName`（"Claude Code" / "Pi"）是产品名，无需翻译。
- `a.settingsFilePath` 是技术路径，不翻译。
- en/zh `settings.json` 已有 `cli` 节点，结构齐全。
- 08-04-shortcuts-settings-i18n 的做法：i18n 加 `items.<id>` 键 + 组件用 `t(key, { defaultValue: shortcut.name })` fallback 到 store 原值，不删 store 字段。

## Requirements
- en/zh `settings.json` 的 `cli` 下新增：
  - `adapterHint`: 替代 CliSettings.tsx:75 的中文句。
  - `adapters.claude.description` / `adapters.pi.description`: 替代 registry.ts 的两条 description。
- `CliSettings.tsx:75` 改用 `t('settings:cli.adapterHint')`。
- `CliSettings.tsx:90` 改用 `t('settings:cli.adapters.<id>.description', { defaultValue: a.description })`，id 取 `a.id`。
- 不动 `registry.ts` 的 `description` 字段——留作 i18n 缺键 fallback，避免影响 cli-adapter 包的其它调用点与现有测试。

## Acceptance Criteria
- [ ] 切换语言到 en/zh，CliSettings 页面顶部 hint 句与每个 adapter 的 description 行随之翻译。
- [ ] 删除任一 `adapters.<id>.description` 键，UI 回退到 registry.ts 中的中文原值（fallback 生效）。
- [ ] `tsc` / `eslint` / 现有测试不回归。

## Definition of Done
- i18n 键 en/zh 对齐。
- 组件改用 `t()` + `defaultValue` fallback。
- 类型检查、lint 通过。

## Out of Scope
- 不删 `registry.ts` 的 `description` 字段。
- 不重构 `CliSettings.tsx` 其它逻辑（detect / test / openFile 流程）。
- 不翻译 `displayName`、`settingsFilePath`。
- 不动 `cli.cliAdapter`（已存在但组件未使用，留待后续清理）。

## Technical Approach
镜像 shortcuts-settings-i18n：
1. en/zh settings.json `cli` 节点下加 `adapterHint` 字符串 + `adapters` 对象（按 id 键）。
2. CliSettings.tsx 两处替换为 `t()` 调用，registry.description 作为 `defaultValue` fallback。

## Technical Notes
- 参考 `.trellis/tasks/archive/2026-08/08-04-shortcuts-settings-i18n/prd.md` 的 fallback 模式。
- 文件：
  - `apps/desktop/src/i18n/locales/en/settings.json` (cli 节点 ~L141-169)
  - `apps/desktop/src/i18n/locales/zh/settings.json` (cli 节点 ~L141-169)
  - `apps/desktop/src/components/settings/CliSettings.tsx:75,90`
