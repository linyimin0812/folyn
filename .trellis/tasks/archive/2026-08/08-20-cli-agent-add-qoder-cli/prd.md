# CLI Adapter: Add Qoder (International + China)

## Goal

为 `packages/cli-adapter` 新增 Qoder adapter。国际版与中国版是两个独立 binary，CLI 表层完全一致（仅 binary 名 / 配置目录 / 环境变量前缀 / endpoint 不同）。用一个参数化实现类 + 两条 factory 注册。

## What I already know

* 现有 adapter 注册在 `packages/cli-adapter/src/registry.ts`：`claude` / `codex` / `pi`
* `codexAdapter.ts` 是一发一进程 + JSONL 流模板
* Tauri sidecar 注册在 `apps/desktop/src-tauri/capabilities/default.json` 和 `pet-panel.json`，`codex-cli` 走 `/bin/sh -lc "<cmd>"`
* `BaseCliAdapter` 提供 `emit` / `listSkills` / `listCommands` 空实现

## Research Findings (see `research/qoder-cli-shape.md`)

* **Binary 名**：国际 `qodercli`（npm `@qoder-ai/qodercli`）；中国 `qoderclicn`（npm `@qodercn-ai/qoderclicn`）
* **CLI 形态**：一发一进程 + JSONL。`qodercli -p --output-format stream-json --no-session-persistence <prompt>` 输出每行一个 `{"type":"system"|"assistant"|"result",...}`
* **Resume**：`-r/--resume <id>` / `-c/--continue` / `--session-id <id>` / `--list-sessions`
* **配置目录**：`~/.qoder/`（国际）/ `~/.qodercn/`（中国，推断）
* **国际版 vs 中国版差异**：binary 名、npm 包、内部 `QODERCLI_SITE` flag（`global`/`cn`）、配置目录与环境变量前缀（`QODER_*` vs `QODERCN_*`）、API endpoint（`openapi.qoder.sh` vs `openapi.qoder.com.cn`）、CDN。**CLI 表层完全一致**
* **Auth**：`qodercli login` 浏览器 OAuth；或 `QODER_PAT`/`QODER_PERSONAL_ACCESS_TOKEN` env + settings.json `qoder-pat` selectedType。首版只写 settings 模板，不引导登录
* **未观察的事件形态**：tool-use 事件在未认证本地试跑时没出现。首版按 codex 的事件映射兜底，未知 `type` → `[]`，跑通后再校准

## Requirements

* 新增 `packages/cli-adapter/src/qoderAdapter.ts`：导出 `QoderAdapter` 类 + `buildQoderArgs` / `buildQoderShellCommand` / `translateQoderEvent` 三个纯函数（参照 codex 形态）
* 类构造接受 `{ id, displayName, description, cliPath, settingsFilePath }` 参数；`registry.ts` 注册两条 factory：
  - `qoder`：displayName `Qoder`，cliPath 默认 `qodercli`，settings `~/.qoder/settings.json`
  - `qoder-cn`：displayName `Qoder (China)`，cliPath 默认 `qoderclicn`，settings `~/.qodercn/settings.json`
* `registry.ts` 同时导出 `QODER_SETTINGS_TEMPLATE`（空 JSON 模板，与 claude 一致）
* Tauri sidecar：`apps/desktop/src-tauri/capabilities/default.json` + `pet-panel.json` 各加两条 `qoder-cli` / `qoder-cli-cn`（`/bin/sh` + `args: true`）
* `Command.create('qoder-cli', ...)` 与 `Command.create('qoder-cli-cn', ...)` 按 binary 选 sidecar

## Acceptance Criteria

* [ ] `listAdapters()` 含 `qoder` + `qoder-cn` 两条，`displayName` / `settingsFilePath` 正确
* [ ] `createAdapter('qoder')` 与 `createAdapter('qoder-cn')` 返回实例的 `id` 分别为 `qoder` / `qoder-cn`
* [ ] `buildQoderArgs(prompt, {resumeSessionId})` 输出 `['-p','--output-format','stream-json','--no-session-persistence', prompt]`（resume 时加 `--resume <id>`）
* [ ] `translateQoderEvent` 单测：`system`+`session_id` → `session_id` 事件；`assistant`+`text` → `text` 事件；`result` → `done`；未知 → `[]`
* [ ] Tauri capabilities default + pet-panel 各含 `qoder-cli` + `qoder-cli-cn` 条目

## Definition of Done

* `qoderAdapter.test.ts` 覆盖 args 构造 + 事件翻译（参照 `codexAdapter.test.ts`）
* Lint / typecheck green
* sidecar 注册同步更新（default + pet-panel）
* settingsFilePath 用 `~` 前缀

## Technical Approach

**单一参数化实现 + 两条 factory 注册**（ponytail 选择）：

```ts
// qoderAdapter.ts
export class QoderAdapter extends BaseCliAdapter {
  readonly id: string;
  readonly displayName: string;
  readonly description: string;
  private readonly sidecarName: string;
  private readonly cliPathDefault: string;
  private sessionId: string | null = null;
  // ... (mirror codexAdapter lifecycle)
  constructor(opts: { id, displayName, description, sidecarName, cliPathDefault }) { ... }
}

// registry.ts
qoder: { factory: () => new QoderAdapter({ id:'qoder', ..., sidecarName:'qoder-cli', cliPathDefault:'qodercli' }), settingsFilePath: '~/.qoder/settings.json', ... },
'qoder-cn': { factory: () => new QoderAdapter({ id:'qoder-cn', ..., sidecarName:'qoder-cli-cn', cliPathDefault:'qoderclicn' }), settingsFilePath: '~/.qodercn/settings.json', ... },
```

事件翻译映射（基于 research；tool_use 事件形态待校准，先兜底）：
- `{"type":"system","session_id":"..."}` → `{type:'session_id', sessionId}`
- `{"type":"assistant","message":{"content":[{"type":"text","text":"..."}]}}` → `{type:'text', content}`（非 delta，整段）
- `{"type":"assistant","message":{"content":[{"type":"tool_use","id":"...","name":"...","input":{...}}]}}` → `{type:'tool_start', toolName, toolId, toolInput}`（待校准）
- `{"type":"result","is_error":bool,...}` → `{type:'done'}`（若 `is_error` → 先 emit `error`）

## Decision (ADR-lite)

**Context**：qoder 国际/中国两 binary，CLI 表层完全一致，差异仅在 binary 名 / 配置目录 / endpoint。
**Decision**：单一参数化 `QoderAdapter` 类 + 两条 factory 注册，不写两个独立类。
**Consequences**：少一份重复代码；后续若发现中国版有专属行为需要分叉时再拆。tool_use 事件形态未实测，首版按 codex 范式兜底。

## Out of Scope

* qoder 专属 skills / commands 发现（首版返回 `[]`，同 codex）
* 自动登录 / auth 引导
* tool_use 事件精确校准（首版兜底，跑通后补）
* resume 多轮会话的实际验证（仅实现 `--resume <id>` 参数构造）

## Research References

* [`research/qoder-cli-shape.md`](research/qoder-cli-shape.md) — binary 名、CLI 形态、配置目录、国际/中国差异、auth 方式

## Implementation Plan

* PR1：`qoderAdapter.ts` + `qoderAdapter.test.ts` + `registry.ts` 注册两条
* PR2：Tauri capabilities sidecar 注册 `qoder-cli` + `qoder-cli-cn`（default + pet-panel）
