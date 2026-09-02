# Feature Agents

> How Folyn defines, delivers, and invokes per-feature Claude Code agents.

---

## Overview

Folyn ships 4 feature agents (`analyze`, `clips`, `schedule`, `wiki`). Each agent has a **canonical source** in the desktop app's `features/<feature>/.claude/` and is **seeded into the user's vault** at runtime. Agents are invoked by `ClaudeAdapter` with `cwd = <vault>/__<feature>__/` so Claude Code auto-discovers the seeded agent file.

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
// Note: `feature` is typed as `string` in the actual codebase (not a literal
// union), so the registry stays open to future feature keys without churn.
// The registered features today are analyze/clips/schedule/wiki.
interface FeatureAgentEntry {
  feature: string;              // feature name; also `--agent <name>` and vault file stem
  agentFile: string;            // e.g. 'wiki.md'
  agentDoc: string;            // canonical agent .md content (via `?raw` import)
  claudeDoc: string;           // canonical CLAUDE.md content (via `?raw` import)
  addVaultDir?: boolean;       // true → inject `--add-dir <vault>` at invoke time
  adapterId?: 'claude' | 'pi';  // which CLI adapter runs this agent (default 'claude');
                                 //   'pi' seeds an extra AGENTS.md the pi adapter auto-discovers
}

// CliSendOptions fields consumed (from @folyn/cli-adapter)
interface CliSendOptions {
  agent?: string;              // feature name, e.g. 'wiki'
  bare?: boolean;              // false → Claude CLI loads cwd's .claude/agents/*.md
  addDir?: string[];           // extra dirs visible to the agent beyond cwd
  // ... other fields omitted
}

async function getFeatureAgentSendOptions(feature: string): Promise<CliSendOptions>;
async function runFeatureAgent(feature: string, instruction: string): Promise<Session>;
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
import agentDoc from '@/features/wiki/.claude/agents/wiki.md?raw';
import claudeDoc from '@/features/wiki/.claude/CLAUDE.md?raw';
```

**Runtime vault layout** (seeded, per-user):
```
<vault>/__<feature>__/.claude/
  CLAUDE.md              # seeded always-overwrite (canonical is single source of truth;
                         #   vault copies do NOT preserve user edits to these canonical files)
  agents/<feature>.md    # seeded always-overwrite (same — canonical re-applied each seed)
```

The `__<feature>__/` directory doubles as the feature's **content directory** (e.g. `__wiki__/` holds wiki agent working files). The 4 registered `__xxx__/` dirs (`__analyze__`, `__clips__`, `__schedule__`, `__wiki__`) are hidden from the sidebar file tree via `appearanceStore` `BUILTIN_EXCLUDE_DIRS` (the default `excludePatterns`).

> **Residual**: `__study__` is still in `BUILTIN_EXCLUDE_DIRS` / `DEFAULT_EXCLUDE_PATTERNS` even though the `study` feature agent was removed (commit `11f5bf0d`). The pattern is kept so existing user vaults with leftover `__study__/` content stay hidden; it does NOT imply a registered study agent. Do not add a study `FeatureAgentEntry` without first removing this residual note.

**Invoke parameters per feature:**

| Feature | cwd | `--agent` | `--add-dir` | `bare` |
|---------|-----|-----------|-------------|--------|
| analyze | `<vault>/__analyze__` | `analyze` | — | `false` |
| clips | `<vault>/__clips__` | `clips` | — | `false` |
| schedule | `<vault>/__schedule__` | `schedule` | `<vault>` | `false` |
| wiki | `<vault>/__wiki__` | `wiki` | — | `false` |

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
| Vault switch → first run for feature | `seedAgentFiles` creates `__<feature>__/.claude/agents/` dir (idempotent), writes CLAUDE.md + agent .md **always-overwrite** (canonical is the single source of truth; user edits to these seeded canonical files are NOT preserved across seeds) |
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
3. Existing user vaults get the new canonical agent .md on the next seed (always-overwrite re-applies canonical) — document in release notes

**Bad** — hardcoding seed path:
```ts
// ❌ Don't: per-feature hardcoded paths
await manager.writeFile('.claude/agents/wiki.md', wikiDoc);       // old shared path
await manager.writeFile('__wiki__/.claude/agents/wiki.md', doc); // hardcoded feature dir
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
| always-overwrite re-seeds canonical | `featureAgentService.test.ts` | A second `seedAgentFiles` call re-writes every canonical path (CLAUDE.md + agent .md) — canonical is single source of truth, NOT write-if-missing; `writeFile` IS called on every seed even when content already exists |
| `schedule` send-options include `addDir` | `featureAgentService.test.ts` | `getFeatureAgentSendOptions('schedule')` returns `{ agent: 'schedule', bare: false, addDir: [<vault basePath>] }` |
| Non-schedule features omit `addDir` | `featureAgentService.test.ts` | `getFeatureAgentSendOptions('wiki')` returns `{ agent: 'wiki', bare: false }` (no `addDir`) |
| Canonical agent .md contract | `features/wiki/wikiAgent.test.ts` | Asserts action names, output format lines present in the `?raw`-imported wiki agent doc |
| `appearanceStore` hides all `__xxx__/` | `appearanceStore.test.ts` | Default `excludePatterns` / `BUILTIN_EXCLUDE_DIRS` includes `__analyze__`, `__clips__`, `__schedule__`, `__wiki__` (and residual `__study__`) |

> **Note on test coverage**: as of writing, only the `wiki` feature has a `<feature>Agent.test.ts`; `analyze`/`clips`/`schedule` do not yet have canonical-doc contract tests. `featureAgentService.test.ts` is the shared seeding + send-options test for all features. When adding a new feature, add a `features/<feature>/<feature>Agent.test.ts` following the `wiki` shape.

### 7. Wrong vs Correct

#### Wrong — agent .md duplicates context that belongs in CLAUDE.md
```markdown
---
name: wiki
---
你是 Folyn 的 wiki agent。工作区是当前 vault（cwd），可读写 `__wiki__/*.md` 主题文档。
主题文档结构与命名规则见 `../CLAUDE.md`。

## research（找资料）
...输出契约...
```

**Why bad**: vault layout and doc structure are context — they change when the feature evolves, independent of the output contract. Duplicating them in agent .md means a context change requires editing the contract file, and the agent .md grows unbounded.

#### Correct — context in CLAUDE.md, contract in agent .md
```markdown
// features/wiki/.claude/CLAUDE.md
# Folyn wiki feature
Agent cwd = `<vault>/__wiki__/`. wiki 主题文档 `__wiki__/<slug>.md` 结构与命名规则。
命名规则：slug 来自标题，CJK 保留，非字母数字折叠为 `-`。

// features/wiki/.claude/agents/wiki.md
---
name: wiki
---
你是 Folyn 的 wiki agent。Feature 上下文（vault 布局、主题文档结构、文件命名规则）见同目录 `../CLAUDE.md`。

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

## Convention: Runtime Prompt = Params Only, Contract = Agent .md

**What**: Runtime prompt builders (e.g. `buildQueryInstruction`, card metadata fallback, `DailyDigest` schedule prompt) emit only runtime parameters — action name, topic path/name, selected context, mode markers, dynamic data the agent can't derive. All static contract content (output format rules, line grammar, callout syntax, JSON shape, "不要 Edit 改文件", 字数限制, role/preamble) lives in canonical `.claude/agents/<feature>.md` as the single contract source.

**Why**: Duplicating contract in the runtime prompt means a contract change requires editing two places (caller + agent .md) — and the agent .md is the only file the agent actually loads at invoke time (via cwd auto-discovery). Trimming prompts to params-only keeps the contract authoritative in one place, matches how the agent actually loads context, and shrinks token overhead without changing behavior.

**Trim pattern** (apply to every caller):
1. Drop role/preamble ("你是 ... 助手")
2. Drop output format rules (JSON shape, callout syntax, line grammar)
3. Drop meta-instructions ("不要 Edit 改文件", "只输出 ...")
4. Keep: action name (e.g. `动作：research`), dynamic runtime data (paths, names, selected items, mode markers)

**Reference pattern** (correct): `apps/desktop/src/services/clipService.ts` infographic prompt — only passes `[infographic-mode]` marker + runtime data (title/url/summary/keyPoints), no contract duplication. JSON block schema lives in `clips.md`.

**Anti-pattern** (pre-trim, incorrect): a runtime builder used to inline the full format rules:
```ts
// ❌ Don't: duplicate contract in the runtime prompt
return [
  head,
  '动作：research',
  '检索高质量资料...返回 5-8 条资料建议。',
  '每条严格单行，格式（| 两侧留空格；难度用 易/中/难）：',
  '- `- @book <书名> | <作者> | <简介> | 难度:<易|中|难>`...',
  '- `- @web <标题> | <链接> | <简介>`',
  '只输出资料行，不要用 Edit 改文件。',
].join('\n');
```
```ts
// ✅ Do: params only; format rules live in agents/wiki.md
return [head, '动作：research'].join('\n');
```

**Cross-check before trimming**: diff the runtime prompt against the agent .md. Any rule in the runtime prompt that's NOT in .md must be added to .md first (so we don't silently lose contract). All 4 canonical agent .md files already contain the full contract for their actions.

**Related files**:
- `apps/desktop/src/services/wikiQueryService.ts` — `buildQueryInstruction` (params + wiki context block)
- `apps/desktop/src/services/clipService.ts` — card metadata fallback (thin) + infographic (reference pattern)
- `apps/desktop/src/components/editor/DailyDigest.tsx` — schedule prompt (today + modified docs + recent daily notes)

> **Removed**: the former `features/study/scheduleLink.ts` + `buildStudyInstruction` were deleted with the `study` feature (commit `11f5bf0d`). The params-only pattern now lives in the surviving `buildQueryInstruction` (wiki) and `DailyDigest` (schedule) callers.

---

## Convention: Clip `## 正文` Storage + Infographic Content Enrichment

**What**: The clips feature stores the full page markdown (fetched via `curl.md` at card-gen time) under a `## 正文` section in the clip file. The infographic is auto-generated at clip time by chaining a second agent call in `[infographic-mode]` right after the card-metadata call; that call receives `## 正文` (and summary/keyPoints) in its runtime prompt and produces 7-9 dense blocks (vs. 2-5 for clips without `## 正文`).

**Why**: Without `## 正文`, the infographic agent only has `## 摘要` (2-4 sentences) + `## 要点` (3-5 bullets) to work with — the resulting poster is content-thin. Storing the full page markdown at clip time makes the infographic offline-safe (no re-fetch needed) and dead-link-safe (the clip survives even if the source URL goes away). The infographic becomes "一图胜千言" — a real poster.

**Clip file section order** (poster-first):
```
front-matter
> **来源**: [<hostname>](<url>)
## 信息图        ← optional; auto-generated at clip time; ALWAYS written at TOP position
## 摘要
## 要点
## 正文          ← optional; full page markdown from curl.md
```

**Top-position rule for `## 信息图`**: `saveClip` writes the `## 信息图` section (when an infographic was auto-generated) at the TOP position — right after the `> **来源**` quote line, before `## 摘要`. The poster is the first thing the user sees when opening a clip.

**Order-agnostic parsing**: `parseClipContent` finds `## 信息图` / `## 摘要` / `## 要点` / `## 正文` by heading, not by position — so old clips with `## 信息图` at the end still parse correctly. Never assume section order in the parser.

**Content flow**:
```
generateClip
  ├─ Phase 1: card-metadata agent call (WebFetch curl.md → JSON metadata + pageContent field)
  └─ Phase 2: chained infographic-mode agent call (passes ## 正文 + summary/keyPoints → 7-9 blocks)
  ↓ returns { metadata, infographic: InfographicDoc | null }
saveClip ({ metadata, infographic })
  → writes ## 信息图 (top) + ## 摘要 + ## 要点 + ## 正文
  ↓
InfographicView (renders blocks as unified poster)
```

**Auto-generation, not on-demand**: there is no manual "重新生成" / "生成信息图" button in the UI. The infographic is generated automatically during `generateClip` (chained agent call). If the chained call fails, `infographic` is `null` and `saveClip` skips writing `## 信息图` — the clip itself still succeeds (best-effort). The user can re-clip to retry.

**Backward compatibility**: existing clips without `## 正文` (or without `## 信息图`) still work — the renderer just shows nothing in the infographic slot. No auto-migration; the user re-clips manually to get the enriched flow.

**Runtime prompt discipline**: the infographic prompt is params-only (reference pattern, see `clipService.runInfographicAgent`). It passes `[infographic-mode]` marker + title/url + `## 摘要` + `## 要点` + (optional) `## 正文`. The 7-9 block minimum, block-type enum, and content-density rules live in `agents/clips.md` (the contract source).

**Related files**:
- `apps/desktop/src/services/clipService.ts` — `ClipMetadata.pageContent`, `GenerateClipResult`, `generateClip` (chained card + infographic calls), `saveClip` writes `## 信息图` at top + `## 正文`
- `apps/desktop/src/features/clips/clipParse.ts` — `parseClipContent` (order-agnostic), `serializeInfographicSection`, `writeInfographicSection` (top-position rule)
- `apps/desktop/src/features/clips/.claude/agents/clips.md` — card mode (`pageContent` field) + infographic mode (`## 正文` input, 7-9 block minimum)
- `apps/desktop/src/components/file-types/clip/InfographicView.tsx` — unified poster container (single background, hero header, 3-column body, source footer)
- `apps/desktop/src/components/file-types/clip/ClipCardView.tsx` — renders infographic region BEFORE 摘要, no chrome (just `<InfographicView doc={...} />`)

---

## Reference Files

- `apps/desktop/src/services/featureAgentService.ts` — registry, seed logic, send-options
- `apps/desktop/src/features/<feature>/.claude/` — canonical CLAUDE.md + agents/*.md for each feature (analyze, clips, schedule, wiki)
- `packages/cli-adapter/src/claudeAdapter.ts` — `buildClaudeArgs` flag ordering
- `apps/desktop/src/store/appearanceStore.ts` — `BUILTIN_EXCLUDE_DIRS` default + `backfillBuiltinExcludePatterns`

> **Test coverage**: `featureAgentService.test.ts` covers the Tests Required table above — registry, path helpers, seeding (always-overwrite, createDir, verbatim content, failure tolerance), `agentFileExists`, `getFeatureAgentSendOptions` (seeded / schedule-addDir / read-only fallback / unregistered), `isAgentAvailable`. The fallback path is triggered by a read-only vault (write failures), not by an unseeded vault — `lazySeedAgentFiles` seeds in-place before checking existence.
