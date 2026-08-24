# fix feature agent fallback: inline-deliver canonical agent via --agents

## Goal

修复所有 5 个 feature agent（study/clips/wiki/schedule/analyze）在 vault 未种入 agent 文件时丢失 contract 的 bug。根因：`getFeatureAgentSendOptions` 与 `runFeatureAgent` 在 `agentFileExists=false` 时回退到 `{ bare: true }`，**没有内联交付 canonical agent 定义**，agent 收不到 contract 自由发挥。clips 的信息图区渲染为原始 JSON 是最明显的症状（`UnknownBlock` fallback 渲染 `JSON.stringify`），其他 feature 表现为输出格式错乱/解析失败。

## Root Cause Analysis

### 症状（clips 最明显）
- `ClipCardView` 信息图区显示 `未知信息图块\n{ "type": "header", "style": {...}, "content": {...} }` 而非海报式块
- 每个 block 走 `InfographicView.UnknownBlock` fallback（`JSON.stringify(block, null, 2)`）
- 其他 feature（study/wiki/schedule/analyze）同因不同症：输出格式不符合契约、解析失败或静默错乱

### 数据流追踪（两条调用路径共享同一 bug）

**路径 A: `getFeatureAgentSendOptions`**（clips / wiki / schedule / analyze 调用方各自 `adapter.send`）
1. `lazySeedAgentFiles()` 尝试种入 `<vault>/__<feature>__/.claude/agents/<feature>.md`（write-if-missing）
2. `agentFileExists(manager, feature)` 检查文件是否存在
3. **存在** → `{ agent: feature, bare: false }`（cwd 自动发现，contract 生效）
4. **不存在** → `{ bare: true }`（❌ 无 contract）

**路径 B: `runFeatureAgent`**（study 专用）
- `featureAgentService.ts:305-310`：`agentFileExists=false` → `{ bare: true, resumeSessionId, addDir }`（❌ 无 contract）

### 为什么 seed 失败
可能原因（不深究，fallback 要兜底所有情况）：
- vault 只读 / `__<feature>__/` 不存在且 createDir 失败
- vault basePath 含 `~` 未解析
- 非 tauri provider 的 writeFile 未自动建父目录
- 用户 vault 从未触发过 lazySeed（首次调用即失败）

### Spec 承诺 vs 实现
`feature-agents.md` spec Validation Matrix 写了："Agent file missing at invoke time → `agentFileExists` returns false → fall back to `bare:true` + `--agents` inline delivery (graceful degradation)"。但两条路径的实现只做了 `bare:true`，**没做 `--agents` inline delivery**。这是 spec 与实现的差距。

## Requirements

- `getFeatureAgentSendOptions` 在 `agentFileExists=false` 时，内联交付 canonical agent 定义 via `--agents` flag
- `runFeatureAgent`（study 路径）在 `agentFileExists=false` 时，同样内联交付 canonical agent 定义
- 内联交付的 agent 定义从 canonical .md 解析 frontmatter（description/tools）+ body 构建为 `CliAgentDefinition`
- schedule feature 的 `addDir` 在两条 fallback 路径都要保留
- 单测覆盖两条 fallback 路径：agent 文件不存在时返回值含 `agents` 字段且形状正确

## Acceptance Criteria

- [ ] `getFeatureAgentSendOptions('clips')` 在 `agentFileExists=false` 时返回 `{ agent: 'clips', bare: true, agents: { clips: { description, prompt, tools } } }`
- [ ] `getFeatureAgentSendOptions('schedule')` fallback 返回值保留 `addDir: [<vault>]`
- [ ] `runFeatureAgent('study')` fallback 路径返回值含 `agents: { study: {...} }`
- [ ] canonical agent .md 的 frontmatter 正确解析为 `description` / `tools`，body 作为 `prompt`（5 个 feature 全覆盖）
- [ ] 单测：mock `agentFileExists=false`，断言两条路径返回值含 `agents` 字段且形状正确
- [ ] 单测：frontmatter 解析器对 5 个 feature 的 canonical .md 都能正确解析
- [ ] 端到端验证（clips）：删除 vault 里的 `__clips__/.claude/agents/clips.md`，重新生成信息图，blocks 应匹配 9 种已知类型

## Definition of Done

- 单测通过、typecheck clean
- 在干净 vault（无 agent 文件）下各 feature 调用仍能拿到 contract
- 现有功能不破坏（agent 文件已种入时走 cwd 发现路径，行为不变）

## Technical Approach

### Fallback 内联交付（两条路径）

`getFeatureAgentSendOptions` 修改：
```ts
if (available) {
  return { agent: feature, bare: false, ...(addDir ? { addDir } : {}) };
}
// Fallback: 内联交付 canonical agent 定义
const def = parseAgentDoc(entry.agentDoc);
return {
  agent: feature,
  bare: true,
  agents: { [feature]: def },
  ...(addDir ? { addDir } : {}),
};
```

`runFeatureAgent` 修改（study 路径）：
```ts
if (available) {
  return { agent: 'study', bare: false, resumeSessionId, ...(opts.addDir ? { addDir: opts.addDir } : {}) };
}
const def = parseAgentDoc(studyEntry.agentDoc);
return { agent: 'study', bare: true, agents: { study: def }, resumeSessionId, ...(opts.addDir ? { addDir: opts.addDir } : {}) };
```

### Frontmatter 解析器

canonical agent .md 形如：
```markdown
---
name: clips
description: Folyn 网页知识卡片 agent，...
tools: WebFetch, WebSearch, Read
---

<body>
```

解析为 `CliAgentDefinition`：
```ts
function parseAgentDoc(md: string): CliAgentDefinition {
  const fmMatch = md.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!fmMatch) return { prompt: md };
  const fm = fmMatch[1];
  const body = fmMatch[2];
  const description = matchField(fm, 'description');
  const toolsLine = matchField(fm, 'tools');
  const tools = toolsLine ? toolsLine.split(',').map(t => t.trim()).filter(Boolean) : undefined;
  return { description, prompt: body, tools };
}
```

放在 `featureAgentService.ts` 内部（不导出，单测通过 entry 间接测）。

### 为什么不用 `--agent` + cwd 发现
因为 cwd 是 `<vault>/__<feature>__/`，如果该目录下没有 `.claude/agents/<feature>.md`（seed 失败），cwd 发现找不到 agent。`--agents` 内联交付绕过文件系统，直接把 agent 定义传给 CLI。

## Decision (ADR-lite)

**Context**: `getFeatureAgentSendOptions` 和 `runFeatureAgent` 的 fallback 路径只返回 `{ bare: true }`，agent 收不到 contract，导致各 feature 输出不符合契约。

**Decision**: 两条 fallback 路径都内联交付 canonical agent 定义 via `--agents` flag（`CliAgentDefinition` 形状），从 canonical .md frontmatter 解析 description/tools，body 作为 prompt。

**Consequences**:
- ✅ 5 个 feature 的 agent 总能收到 contract，无论 seed 是否成功
- ✅ 与 spec `feature-agents.md` Validation Matrix 承诺的 graceful degradation 一致
- ⚠️ 每次调用 fallback 都要解析 frontmatter（小成本，可接受；若热路径可考虑缓存）
- ⚠️ 内联交付的 agent 不会触发 cwd 的 CLAUDE.md 加载（`bare:true`），但 feature 上下文已在 agent prompt body 里（CLAUDE.md 的内容 agent .md 已 reference）

## Out of Scope

- 深入调查 seed 为什么失败（vault 路径解析、provider 写入能力等——留作后续诊断）
- 缓存解析后的 `CliAgentDefinition`（YAGNI，先看是否有性能问题）
- 修复已生成的错误信息图（用户需重新生成，或手动删除 `## 信息图` 段后重生成）
- 其他 feature 的端到端验证（只验证 clips，因为只有 clips 有可见渲染 fallback；其他 feature 的契约遵守靠单测保证）

## Implementation Plan (single PR)

- PR1: `featureAgentService` 两条 fallback 路径内联交付 + frontmatter 解析器 + 单测

## Technical Notes

- `CliAgentDefinition` 形状（`packages/cli-adapter/src/types.ts:60`）：`{ description?, prompt, tools? }`
- `buildClaudeArgs`（`packages/cli-adapter/src/claudeAdapter.ts:298`）已支持 `--agents` flag（`JSON.stringify`）
- canonical agent .md 位于 `apps/desktop/src/features/<feature>/.claude/agents/<feature>.md`，经 `?raw` import 存于 `FeatureAgentEntry.agentDoc`
- 5 个 feature 的 frontmatter 都是一致的 `name/description/tools` 三字段格式
- spec `feature-agents.md` Validation Matrix 已记录此 fallback 路径
- 两条调用路径：`getFeatureAgentSendOptions`（clips/wiki/schedule/analyze）+ `runFeatureAgent`（study only）
