# AI Panel Agent 模式 Skills/Commands Slash 触发

## Goal

在 AI Panel 的 Agent 输入模式下，输入 `/` 触发下拉，列出当前所选 CLI 适配器对应的 skills 与 commands 供用户选择；选中后把对应文本插入输入框。不同 CLI（Claude Code / Pi）对应不同的 skill/command 集合，**从各自 CLI 的真实来源读取**，与 CLI 保持一致。

## What I already know

- Agent 模式 = `apps/desktop/src/components/ai/inputModes.ts` 的 `agent` mode（`permissionMode: 'bypassPermissions'`）。
- 输入框 = `apps/desktop/src/components/ai/ChatInput.tsx` + `apps/desktop/src/components/chat/ChatInputBox.tsx`。目前唯一触发字符是 `@`（vault 文件 mention），实现于 `ChatInput.tsx` 的 `handleChange`/`insertMention`/`mentionOverlay`/`handleBeforeKeyDown`。无 `/` slash、无 skill/command 选择 UI。
- CLI 适配器在 `packages/cli-adapter/src/registry.ts`：`claude`（`ClaudeAdapter`，`buildClaudeArgs` 拼 `--agent/--agents/--add-dir/--bare`）+ `pi`（`PiAdapter`）。
- 适配器接口契约在 `packages/cli-adapter/src/types.ts`（`CliSendOptions` 等）。
- 输入模式注册表 `inputModes.ts` 是声明式 registry（`registerInputMode` / `listInputModes`）。
- 当前会话所选适配器：`aiConfig.cliAdapter`，per-session 适配器实例由 `apps/desktop/src/components/ai/adapterManager.ts` 管理。
- 已存在独立的 Skill 子系统（`skillStore` / `skillDefaults.ts`，clip / github-analysis）和 Command Palette（`CommandPalette.tsx` / `commandRegistry.ts`）——但都不在聊天输入框内，**与本次需求不是一回事**。

## Assumptions (temporary)

- 触发字符用 `/`，对齐 Claude Code 本体的 slash 自动补全体验。
- 只在 `agent` 模式（及可能的 `ask` 模式）启用；`chat`（rig 直连，无工具）不启用。
- 数据来源：给 `CliAdapter` 接口加 `listSkills()` / `listCommands()`，各自实现读自己 CLI 的真实来源（Claude：`~/.claude/skills/`、`~/.claude/commands/`、插件 skills；Pi：其自有位置）。
- 选中行为：把 `/skill-name` 或 command 文本插入输入框，发送时随 prompt 走 CLI。

## Research conclusions (from research/cli-skills-commands-discovery.md)

- 两个 CLI 都有 skills + commands，Pi 非空：skills `~/.pi/agent/skills/<name>/SKILL.md`，模板 `~/.pi/agent/prompts/*.md`。
- **触发无需新 flag**：两 CLI 均靠 prompt 文本里的 `/name` 触发。Claude skill → `/skill-name`；Pi skill → `/skill:name`；模板 → `/name`。→ 选中行为 = 插入对应 `/name` 文本，无额外接线。
- skills 共用 agentskills.io 规范（`SKILL.md` + `name`/`description` frontmatter）→ 一个 frontmatter 解析器覆盖两 CLI。
- Claude command 两格式：`.md`（frontmatter `description`/`allowed-tools`/`argument-hint` + `$ARGUMENTS`）和 `.toml`（`description`/`prompt`）。子目录 → `group:name`。
- 内置 slash command（`/clear` `/help` `/init`…）无法从磁盘枚举，两 CLI 均硬编码在二进制里。

## Verified: -p 通道 vs 交互模式的等效性（claude 2.1.114 实测，2026-08-02）

- `claude -p "/help"` → `"/help isn't available in this environment."`
- `claude -p "/clear"` → 同上（session 命令在 one-shot `-p` 下不可用）。
- `claude -p "/trellis:nonexistent"` → `"Unknown command: /trellis:nonexistent"`（证明 `-p` **会**对自定义 command 做 lookup/展开）。
- `claude -p "/nonexistent-skill-xyz"` → `"Unknown command: …"`（skill 同样被 lookup）。
- **结论**：skills + 自定义 command 在 `-p` 通道与交互模式**效果一致**（均为 prompt 模板展开，发模型前插值）；**内置 session 命令不一致**（`-p` 下不可用）。
- → 下拉**不列内置 command**，不仅为避免漂移，更因其在本通道**功能上不工作**。方案 A 成立。

## Decisions (all settled)

- **方案 A**：两 CLI（claude + pi）都做 + skills + 用户/插件 command，**不含内置 command**（功能上 `-p` 通道不工作）。
- **触发字符** `/`，对齐 Claude Code 本体 slash 自动补全。
- **启用模式**：仅 `agent` 模式。`ask`（plan 只读，会误导）与 `chat`（rig 无工具）不启用。
- **数据来源**：`CliAdapter` 接口加 `listSkills()` / `listCommands()`，各自实现读自己 CLI 真实磁盘来源。
- **选中行为**：把对应 `/name` 文本（Claude skill `/skill-name`、Pi skill `/skill:name`、模板 `/name`）插入输入框，发送时随 prompt 走 CLI。无新 flag。
- **带参数 command**：command 有 `argument-hint` 时弹参数输入框，凑齐后插入 `/name <args>`；无 `argument-hint` 的直接插入 `/name`。
- **无 `description` 的 skill**：Pi 不加载，跳过。
- **Pi `disable-model-invocation: true` 的 skill**：对模型隐藏但可被用户 `/skill:name` 触发 → **出现在下拉里**（正是用户触发场景）。

## Requirements

- `CliAdapter` 接口（`packages/cli-adapter/src/types.ts`）扩展 `listSkills(): Promise<SkillEntry[]>` / `listCommands(): Promise<CommandEntry[]>`，默认空数组。
- `ClaudeAdapter` 实现：读 `~/.claude/skills/`、`<cwd>/.claude/skills/`、插件 `skills/`（经 `installed_plugins.json`）；commands 同源三树，glob `*.md` + `*.toml`，子目录 → `group:name`。共用 YAML frontmatter 解析。
- `PiAdapter` 实现：读 `~/.pi/agent/skills/`、`~/.agents/skills/`、`.pi/skills/`、`.agents/skills/`、packages、settings `skills[]`；commands 读 `~/.pi/agent/prompts/*.md`（非递归）、`.pi/prompts/`、packages、settings `prompts[]`。skill 插入串用 `/skill:<name>`，模板用 `/name`。
- 名称冲突优先级：user > project > plugin（镜像 config 分层）。
- `ChatInput.tsx` 在 agent 模式输入框加 `/` 触发分支，与现有 `@`-mention overlay 共存（互斥：触发字符决定走哪条）。
- 下拉项：icon/label(name)/description/source 分组；键盘导航（↑↓/Enter/Tab/Esc）复用现有 mention 模式。
- 选中带 `argument-hint` 的 command → 弹参数输入框，凑齐插入 `/name <args>`；无 hint → 直接插入 `/name`。
- 列表按 session 缓存，不每键重读磁盘；project 列表依赖 cwd（vault 路径），cwd 变或手动刷新时重建。
- i18n：`apps/desktop/src/i18n/locales/{en,zh}/ai.json` 新增下拉相关文案。

## Acceptance Criteria

- [ ] agent 模式下输入框输入 `/` 弹出下拉（chat/ask 模式不弹）
- [ ] 下拉内容 = 当前 CLI 适配器的 skills + commands，切换适配器后内容变化
- [ ] Claude 适配器 listSkills/listCommands 读 `~/.claude` + 项目 `.claude` + 插件真实来源（含 `.md` 和 `.toml`，子目录 `group:name`）
- [ ] Pi 适配器 listSkills 读 `~/.pi/agent/skills/` 等，listCommands 读 `~/.pi/agent/prompts/`
- [ ] 选中 skill 插入 `/skill-name`（Claude）或 `/skill:name`（Pi）；选中模板插入 `/name`；选中带 `argument-hint` 的 command 弹参数框，凑齐插入 `/name <args>`
- [ ] `disable-model-invocation: true` 的 Pi skill 仍出现在下拉；无 `description` 的 skill 不出现
- [ ] `/` overlay 与 `@`-mention 互斥共存，键盘导航正常
- [ ] 列表 session 内缓存，cwd 变化时刷新
- [ ] adapter 列表逻辑 + 输入框触发有测试

## Definition of Done

- Tests added/updated（adapter frontmatter 解析 + 列表读取 + 输入框 `/` 触发/选中）
- Lint / typecheck / CI green
- i18n 文案中英双份更新
- 边界文档：PRD Technical Notes 标注 Pi extension 命令、project trust、内置 command 不工作等已知 gap

## Technical Approach

1. **cli-adapter 包**：`types.ts` 加 `SkillEntry`/`CommandEntry` 接口与 `CliAdapter` 的 `listSkills/listCommands`（默认返回 `[]`）。`ClaudeAdapter`/`PiAdapter` 各实现磁盘读取 + 共用 frontmatter 解析（skills 用一个解析器；commands 分 `.md`/`.toml`）。
2. **ChatInput `/` overlay**：复用 `@`-mention 的 overlay/键盘导航骨架，新增 `/` 触发分支与数据源（调用 `getAdapterForSession` → `listSkills/listCommands`，按 session 缓存）。
3. **参数输入框**：选中带 `argument-hint` 的 command 时切换到 mini input（复用 overlay 容器），回车/确认后插入完整串。
4. **i18n**：补 `ai.json` 文案。

实现按小步：PR1 adapter 接口 + 两适配器列表读取 + 测试；PR2 ChatInput `/` overlay + 选中插入 + 缓存；PR3 argument-hint 参数框 + i18n + 边界文档。

## Decision (ADR-lite)

**Context**: AI Panel Agent 模式需触发 skills/commands，且要"和 CLI 保持一致"。不同 CLI（claude/pi）skill/command 集合不同。
**Decision**: 不自维护镜像 registry，而是给 CLI adapter 加 `listSkills/listCommands` 读各自 CLI 真实磁盘来源；触发靠 prompt 文本 `/name`（已实测 `-p` 通道等效）；下拉只含 skills + 用户/插件 command，不含内置 session 命令（`-p` 下不可用，已实测）。
**Consequences**: 与 CLI 天然一致、不漂移；多一层磁盘读取（session 缓存兜底）；Pi extension 命令（TS 代码注册）无法静态枚举 → 留空 + 文档标注，后续可加 hook。

## Out of Scope (explicit)

- rig/chat 模式的 slash 支持
- quill 侧自维护 skill/command 镜像 registry（明确不做，避免漂移）
- 内置 session 命令（`/clear` `/help` `/config` 等，`-p` 通道不工作）
- Pi extension 命令（TS 代码注册，无法静态枚举）
- 复制 Pi project trust 逻辑（adapter 只读文件，trust 由 Pi 自己管）

## Technical Notes

- 复用 `ChatInput.tsx` 现有 `@`-mention 的 overlay/键盘导航骨架（`handleChange`/`insertMention`/`mentionOverlay`/`handleBeforeKeyDown`），新增 `/` 触发分支。
- adapter 接口扩展点：`packages/cli-adapter/src/types.ts` + `ClaudeAdapter.ts` + `PiAdapter.ts`。
- per-session adapter：`apps/desktop/src/components/ai/adapterManager.ts` 的 `getAdapterForSession`。
- frontmatter 用真 YAML 解析器（`---` 围栏内），不用 regex。
- 已知 gap（文档标注）：Pi project trust、Pi extension 命令、内置 command 不工作、名称冲突 precedence 自定义。
- i18n: `apps/desktop/src/i18n/locales/{en,zh}/ai.json`。

## Research References

- `research/cli-skills-commands-discovery.md` — Claude Code 与 Pi 各自如何暴露 skills/slash commands（on-disk 布局、frontmatter、CLI flag），以便 adapter 实现读取。
