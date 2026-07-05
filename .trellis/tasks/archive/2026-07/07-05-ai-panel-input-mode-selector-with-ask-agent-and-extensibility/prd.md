# AI panel input mode selector (ask / agent, extensible)

## Goal

在 AI 面板输入框内新增一个「模式选择器」，至少包含 `ask` 与 `agent` 两种模式，并通过可注册的扩展机制让后续新模式（如 `plan`、`research` 等）能以声明式接入，无需改动 ChatInput / AiPanel 主体逻辑。

## What I already know

- `ChatInput.tsx`（apps/desktop/src/components/ai/ChatInput.tsx）为输入框组件，底部工具条有附件按钮 + spacer + 发送/停止按钮。
- `AiPanel.tsx` 已存在 `chatMode: 'chat' | 'wiki' | 'clip'`（store/aiStore.ts:15），是顶栏 tab，切换会话；与本次的 ask/agent 是正交维度，不冲突。
- 真正决定 CLI 行为的是 `packages/cli-adapter/src/claudeAdapter.ts`，当前固定 `--permission-mode bypassPermissions` 全工具集；`CliSendOptions`（types.ts:67）已支持 `agent` / `agents` / `addDir` / `bare` 等扩展点，但没有 permission-mode / 工具白名单字段。
- Claude Code CLI 支持 `--permission-mode {default,acceptEdits,plan,bypassPermissions}` 与 `--allowedTools` / `--disallowedTools`。
- 现有 `getAdapterForSession(sessionId)` 在 AiPanel.handleSend 中调用，`adapter.start({cliPath, workingDir})` + `adapter.send(prompt, {resumeSessionId})`。

## Assumptions (temporary)

- ask 模式 ≈ 只读问答：限制为 Read/Grep/Glob/WebSearch 等无副作用工具，不修改文件。
- agent 模式 ≈ 当前行为：bypassPermissions 全工具自主执行。
- 模式选择是全局输入态（非 per-session），持久化在 aiStore，与 chatMode 解耦。
- 扩展机制 = 一个模式注册表（id/label/icon + 构建 CliSendOptions 的策略）。

## Decision (ADR-lite) — Q1

**Context**: 需要定义 ask/agent 在 CLI 行为层的差异，并据此设计扩展点。
**Decision**: 方案 A。ask = `--permission-mode plan`（只读调研，可 Read/Grep/Glob/WebSearch，无副作用）；agent = 现状 `bypassPermissions` 全工具。扩展点在 `CliSendOptions` 增加 `permissionMode?: 'default'|'acceptEdits'|'plan'|'bypassPermissions'`，由模式策略对象构建。
**Consequences**: 复用 Claude Code 原生 plan 模式，语义清晰；未来 plan/research 等模式只需声明 permissionMode（与可选 allowedTools）。需在 claudeAdapter 启动参数里读取该字段覆盖默认的 bypassPermissions。

### Q2 — UI 形态与放置位置
**Decision**: 方案 A。ChatInput 底部工具条「附件按钮右侧」加 segmented toggle（ask|agent，点击直切，当前项高亮），从 registry 渲染，新模式登记即自动横向扩展。

### Q3 — 持久化范围
**Decision**: 方案 A。全局单值 `aiStore.inputMode`（默认 `agent`，保持现状行为），跨会话共享；与 `chatMode` 解耦。提供 `setInputMode`。

### Q4 — 注册表 API 形态
**Decision**: 方案 B。声明式字段 + 可选 `buildSendOptions` 逃生舱。

```ts
type PermissionMode = 'default' | 'acceptEdits' | 'plan' | 'bypassPermissions';
interface AiInputModeDef {
  id: string; label: string; description?: string;
  permissionMode?: PermissionMode;
  allowedTools?: string[]; disallowedTools?: string[]; bare?: boolean;
  systemPrompt?: string;                                  // 透传 --append-system-prompt
  buildSendOptions?: (base: CliSendOptions) => CliSendOptions;
}
const inputModeRegistry: AiInputModeDef[] = [
  { id: 'agent', label: 'Agent', permissionMode: 'bypassPermissions' },
  { id: 'ask',   label: 'Ask',   permissionMode: 'plan' },
];
function registerInputMode(def: AiInputModeDef): void;
function getInputModeDef(id: string): AiInputModeDef | undefined;
```
ChatInput 从 registry 渲染 toggle；AiPanel.handleSend 读 `inputMode` → 查 def → 合并 `{permissionMode, bare, allowedTools}` 进 `adapter.send` 的 options（buildSendOptions 存在则用其结果覆盖）。

## Open Questions

- （已全部收敛，见上方 Decision）

## Requirements (evolving)

- 输入框内可见当前模式，可切换 ask/agent（segmented toggle，从 registry 渲染）。
- 新增模式只需声明式注册到 `inputModeRegistry` / `registerInputMode`，无需改 ChatInput/AiPanel 主体。
- `CliSendOptions` 增加 `permissionMode?` 与 `systemPrompt?`；`buildClaudeArgs` 据此输出 `--permission-mode`（默认 `bypassPermissions` 兼容现状）与 `--append-system-prompt`。
- study session（不可手动输入）不渲染该 toggle；流式中 toggle disabled。
- chatMode=wiki/clip 下输入框同样支持 ask/agent（正交生效）。

## Acceptance Criteria (evolving)

- [x] 输入框内可在 ask / agent 间切换，切换后下次发送即生效。
- [x] ask 模式下 AI 不会修改 vault 文件（permission-mode=plan）；agent 模式下行为与现状一致。
- [x] `CliSendOptions.permissionMode` 缺省时维持 `bypassPermissions`，现有调用方不破。
- [x] 模式 def 带 `systemPrompt` 时，发送命令含 `--append-system-prompt <text>`。
- [x] 新增一个第三方模式（如 plan）只需在 registry 登记，ChatInput toggle 自动出现，无需改 ChatInput/AiPanel。
- [x] study session 不渲染 toggle；流式中 toggle disabled。
- [x] 现有 chat/wiki/clip 顶栏 tab 不受影响；`/clip` 命令路径不受影响。
- [x] 单测：registry 注册/查询、buildClaudeArgs 在 permissionMode/systemPrompt 各组合下的输出。

## Definition of Done

- 单测覆盖模式注册表 + ChatInput 模式切换。
- lint/typecheck/CI 通过。
- 行为变更在 PRD/notes 中记录。

## Out of Scope (explicit)

- 不重构现有 chatMode（chat/wiki/clip）。
- 不在本任务落地第三种模式（如 plan/research），仅留扩展点与示例 def。
- 不做 per-session 模式记忆（统一全局）。
- 不做模式相关的 UI 图标/tooltip 富化（除现有 label + 高亮外）。

## Technical Notes

- 关键文件：apps/desktop/src/components/ai/ChatInput.tsx、AiPanel.tsx、store/aiStore.ts、packages/cli-adapter/src/{claudeAdapter.ts,types.ts}。
- 扩展点候选：在 CliSendOptions 增加 `permissionMode?` 与 `allowedTools?` / `disallowedTools?`，由模式策略对象构建。

## Technical Approach

**新增**
- `apps/desktop/src/components/ai/inputModes.ts`：`PermissionMode` 类型、`AiInputModeDef`、`inputModeRegistry`（含 agent/ask 两条）、`registerInputMode` / `getInputModeDef` / `resolveSendOptions(id, base)`（合并声明式字段后应用 `buildSendOptions`）。
- `aiStore`：`inputMode: string`（默认 `'agent'`）+ `setInputMode`。
- `CliSendOptions`：新增 `permissionMode?: PermissionMode`、`systemPrompt?: string`（`allowedTools/disallowedTools` 留字段，本任务 buildClaudeArgs 暂只透传 permissionMode/systemPrompt，其余后续接）。

**改动**
- `claudeAdapter.buildClaudeArgs`：`--permission-mode` 取 `options.permissionMode ?? 'bypassPermissions'`；`options.systemPrompt` 存在时追加 `--append-system-prompt <text>`（置于 base flags 之后、`--resume` 之前）。
- `ChatInput`：底部工具条附件按钮右侧渲染 segmented toggle（registry map），`isStreaming` 时 disabled；从 aiStore 读/写 `inputMode`。
- `AiPanel.handleSend`：调用 `adapter.send` 前，用 `resolveSendOptions(inputMode, { resumeSessionId })` 合并模式选项。
- study session 分支不渲染 ChatInput，故 toggle 天然不出现，无需额外处理（确认即可）。

**实现计划（小步）**
- PR1：cli-adapter 侧——`CliSendOptions` 加字段 + `buildClaudeArgs` 透传 + 单测（permissionMode/systemPrompt 各组合）。
- PR2：inputModes.ts 注册表 + resolveSendOptions + 单测；aiStore.inputMode/setInputMode。
- PR3：ChatInput toggle UI + AiPanel.handleSend 接线；手测 ask 不改文件、agent 维持现状。
