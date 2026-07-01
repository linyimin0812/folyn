# Feature Agents

> How Quill defines, delivers, and invokes per-feature Claude Code agents.

---

## Overview

Quill ships 5 feature agents (`study`, `clips`, `wiki`, `schedule`, `analyze`). Each agent has a **canonical source** in the desktop app's `features/<feature>/.claude/` and is **seeded into the user's vault** at runtime. Agents are invoked by `ClaudeAdapter` with `cwd = <vault>/__<feature>__/` so Claude Code auto-discovers the seeded agent file.

This spec is mandatory when adding a new feature agent or changing the seed/invoke contract.

---

## Scenario: Add or Modify a Feature Agent

### 1. Scope / Trigger

- Adding a new feature that needs an AI agent
- Changing the seed path, CLAUDE.md/agent split, or cross-vault access rule
- Changing `featureAgentService` registry shape or `CliSendOptions` fields consumed by it

### 2. Signatures

```ts
// apps/desktop/src/services/featureAgentService.ts
type FeatureKey = 'study' | 'clips' | 'wiki' | 'schedule' | 'analyze';

interface FeatureAgentEntry {
  feature: FeatureKey;
  agentFile: string;           // e.g. 'study.md'
  agentDoc: string;            // canonical agent .md content (via `?raw` import)
  claudeDoc: string;           // canonical CLAUDE.md content (via `?raw` import)
  addVaultDir?: boolean;       // true → inject `--add-dir <vault>` at invoke time
}

// CliSendOptions fields consumed (from @quill/cli-adapter)
interface CliSendOptions {
  agent?: string;              // feature name, e.g. 'study'
  bare?: boolean;              // false → Claude CLI loads cwd's .claude/agents/*.md
  addDir?: string[];           // extra dirs visible to the agent beyond cwd
  // ... other fields omitted
}

async function getFeatureAgentSendOptions(feature: FeatureKey): Promise<CliSendOptions>;
async function runFeatureAgent(feature: FeatureKey, instruction: string): Promise<Session>;
async function seedAgentFiles(vaultBasePath: string): Promise<void>;
```

### 3. Contracts

**Canonical source layout** (version-controlled, in repo):
```
apps/desktop/src/features/<feature>/.claude/
  CLAUDE.md              # feature-level context (vault layout, data model, naming rules)
  agents/<feature>.md    # strict output contract + action definitions
```

Import via Vite `?raw`:
```ts
import agentDoc from '@/features/study/.claude/agents/study.md?raw';
import claudeDoc from '@/features/study/.claude/CLAUDE.md?raw';
```

**Runtime vault layout** (seeded, per-user):
```
<vault>/__<feature>__/.claude/
  CLAUDE.md              # seeded write-if-missing (never overwrites user edits)
  agents/<feature>.md    # seeded write-if-missing (never overwrites user edits)
```

The `__<feature>__/` directory doubles as the feature's **content directory** (e.g. `__study__/agent-dev.md` is a study topic doc). All 5 `__xxx__/` dirs are hidden from the sidebar file tree via `settingsStore.excludePatterns`.

**Invoke parameters per feature:**

| Feature | cwd | `--agent` | `--add-dir` | `bare` |
|---------|-----|-----------|-------------|--------|
| study | `<vault>/__study__` | `study` | — | `false` |
| clips | `<vault>/__clips__` | `clips` | — | `false` |
| wiki | `<vault>/__wiki__` | `wiki` | — | `false` |
| analyze | `<vault>/__analyze__` | `analyze` | — | `false` |
| schedule | `<vault>/__schedule__` | `schedule` | `<vault>` | `false` |

`schedule` is the only feature with `addVaultDir: true` because schedule events live in `__daily__/` diaries (not in `__schedule__/`), so the agent needs cross-vault read access.

**CLAUDE.md vs agents/<feature>.md split:**

| File | Holds | Does NOT hold |
|------|-------|---------------|
| `CLAUDE.md` | Vault layout, data model, file naming rules, feature-level conventions | Action definitions, output format |
| `agents/<feature>.md` | Action list, per-action output contract, general rules | Vault layout, data model |

Rationale: context can change (vault layout evolves) without touching the output contract; contract can change (new action) without rewriting context. Agent .md references `../CLAUDE.md` for context.

### 4. Validation & Error Matrix

| Condition | Behavior |
|-----------|----------|
| Vault switch → first run for feature | `seedAgentFiles` creates `__<feature>__/.claude/agents/` dir (idempotent), writes CLAUDE.md + agent .md write-if-missing |
| User edited CLAUDE.md / agent .md | `readFile` probe finds existing content → skip write (never overwrite) |
| Agent file missing at invoke time | `agentFileExists` returns false → fall back to `bare:true` + `--agents` inline delivery (graceful degradation) |
| `schedule` invoke without `--add-dir` | Agent can't see `__daily__/` diaries → schedule review fails. `getFeatureAgentSendOptions('schedule')` MUST inject `addDir: [<vault basePath>]` |
| Feature not in registry | `getFeatureAgentEntry(feature)` returns `undefined` → caller must throw or skip |
| Canonical source file renamed (e.g. `daily.md` → `schedule.md`) | Old feature key returns undefined; all callers must be updated atomically with the rename |

### 5. Good / Base / Bad Cases

**Good** — adding a new feature agent `review`:
1. Create `apps/desktop/src/features/review/.claude/{CLAUDE.md, agents/review.md}`
2. Add `?raw` imports and `FeatureAgentEntry` to the `FEATURE_AGENTS` registry in `featureAgentService.ts`
3. Add `'__review__'` to `settingsStore` default `excludePatterns` + backfill condition
4. Tests: `featureAgentService.test.ts` covers seeding + send-options; `reviewAgent.test.ts` covers canonical doc contract

**Base** — editing an existing agent's output contract:
1. Edit `apps/desktop/src/features/<feature>/.claude/agents/<feature>.md` only
2. Bump any related service tests that assert the contract
3. Existing user vaults keep their old agent .md (write-if-missing won't overwrite) — document in release notes

**Bad** — hardcoding seed path:
```ts
// ❌ Don't: per-feature hardcoded paths
await manager.writeFile('.claude/agents/study.md', studyDoc);       // old shared path
await manager.writeFile('__study__/.claude/agents/study.md', doc);   // hardcoded feature dir
```
```ts
// ✅ Do: derive path from FeatureAgentEntry
const dir = `__${entry.feature}__/.claude`;
await manager.createDir(`${dir}/agents`);
await manager.writeFile(`${dir}/agents/${entry.agentFile}`, entry.agentDoc);
await manager.writeFile(`${dir}/CLAUDE.md`, entry.claudeDoc);
```

### 6. Tests Required

| Test | File | Assertion points |
|------|------|------------------|
| Seeding writes to `__<feature>__/.claude/` | `featureAgentService.test.ts` | `createDir` called with `__<feature>__/.claude/agents`; `writeFile` called with `__<feature>__/.claude/CLAUDE.md` and `__<feature>__/.claude/agents/<feature>.md` |
| Write-if-missing does not overwrite | `featureAgentService.test.ts` | When `readFile` returns existing content, `writeFile` is NOT called for that path |
| `schedule` send-options include `addDir` | `featureAgentService.test.ts` | `getFeatureAgentSendOptions('schedule')` returns `{ agent: 'schedule', bare: false, addDir: [<vault basePath>] }` |
| Non-schedule features omit `addDir` | `featureAgentService.test.ts` | `getFeatureAgentSendOptions('study')` returns `{ agent: 'study', bare: false }` (no `addDir`) |
| Canonical agent .md contract | `features/<feature>/<feature>Agent.test.ts` | Asserts action names, output format lines present in the `?raw`-imported doc |
| `settingsStore` hides all `__xxx__/` | `settingsStore.test.ts` | Default `excludePatterns` includes all 5 `__<feature>__` dirs |

### 7. Wrong vs Correct

#### Wrong — agent .md duplicates context that belongs in CLAUDE.md
```markdown
---
name: study
---
你是 Quill 学习工作台的 study agent。工作区是当前 vault（cwd），可读写 `__study__/*.md` 主题文档。
主题文档结构：## 资料 / ## 计划 / ## 笔记 / ## 复习。
文件命名：slug 来自标题，CJK 保留，非字母数字折叠为 `-`。

## research（找资料）
...输出契约...
```

**Why bad**: vault layout and doc structure are context — they change when the feature evolves, independent of the output contract. Duplicating them in agent .md means a context change requires editing the contract file, and the agent .md grows unbounded.

#### Correct — context in CLAUDE.md, contract in agent .md
```markdown
// features/study/.claude/CLAUDE.md
# Quill 学习工作台（study feature）
Agent cwd = `<vault>/__study__/`. 主题文档 `__study__/<slug>.md` 结构：## 资料 / ## 计划 / ## 笔记 / ## 复习。
命名规则：slug 来自标题，CJK 保留，非字母数字折叠为 `-`。

// features/study/.claude/agents/study.md
---
name: study
---
你是 Quill 学习工作台的 study agent。Feature 上下文（vault 布局、主题文档结构、文件命名规则）见同目录 `../CLAUDE.md`。

## research（找资料）
...输出契约...
```

**Why correct**: context lives in CLAUDE.md (auto-loaded by Claude CLI when cwd has `.claude/CLAUDE.md`); agent .md stays focused on the output contract. The agent .md references `../CLAUDE.md` so readers know where context lives.

---

## Convention: Cross-Vault Access via `addVaultDir`

**What**: Features whose content lives outside their `__<feature>__/` dir set `addVaultDir: true` in the registry. `getFeatureAgentSendOptions` then injects `addDir: [<vault basePath>]` into `CliSendOptions`.

**Why**: Agent cwd is `__<feature>__/` by design (isolates each feature's file namespace). But some features need to read across the vault — `schedule` reads `__daily__/` diaries and "today's modified docs" across all dirs. `--add-dir <vault>` grants that access without changing cwd.

**Example**:
```ts
// featureAgentService.ts registry
{ feature: 'schedule', agentFile: 'schedule.md', agentDoc, claudeDoc, addVaultDir: true }

// getFeatureAgentSendOptions
const opts: CliSendOptions = { agent: entry.feature, bare: false };
if (entry.addVaultDir) {
  opts.addDir = [vaultBasePath];
}
return opts;
```

**Related**: `ClaudeAdapter.buildClaudeArgs` appends `--add-dir` after `--agent` and before `--resume`/prompt, so it's never interpreted as part of the prompt.

---

## Reference Files

- `apps/desktop/src/services/featureAgentService.ts` — registry, seed logic, send-options
- `apps/desktop/src/services/featureAgentService.test.ts` — seeding + send-options tests
- `apps/desktop/src/features/<feature>/.claude/` — canonical CLAUDE.md + agents/*.md for each feature
- `packages/cli-adapter/src/claudeAdapter.ts` — `buildClaudeArgs` flag ordering
- `apps/desktop/src/store/settingsStore.ts` — `excludePatterns` default + backfill
