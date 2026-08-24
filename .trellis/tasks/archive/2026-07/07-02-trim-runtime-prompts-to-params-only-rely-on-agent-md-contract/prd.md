# trim runtime prompts to params only rely on agent md contract

## Goal

Trim runtime prompt builders across 5 feature callers so they only emit runtime parameters (action name, topic path/name, selected context, mode markers). All static contract content (output format rules, "不要 Edit 改文件", callout syntax, JSON shape, 字数限制) stays in canonical `.claude/agents/<feature>.md` as the single contract source. This is refactor leftover cleanup from the CLAUDE.md/agent split.

## What I already know

- Canonical agent .md files (5) already contain the full contract:
  - `features/study/.claude/agents/study.md` — research/plan/feynman/selftest/sq3r format rules + callout syntax + append-only rule
  - `features/clips/.claude/agents/clips.md` — card metadata JSON shape + infographic block schema
  - `features/wiki/.claude/agents/wiki.md` — query action Markdown + `[[wiki://path]]` citation rule
  - `features/schedule/.claude/agents/schedule.md` — 300字限制, 内容包含, Markdown格式
- Runtime agent files seed from canonical via `write-if-missing` (PR2: bare:false + cwd auto-discovery, fallback `--agents` inline delivery from PR-2-fix).
- The CORRECT pattern already exists: `clipService.ts:287` infographic prompt only passes `[infographic-mode]` marker + runtime data (title/url/summary/keyPoints), no contract duplication.
- The WRONG pattern (current): study/scheduleLink.ts `buildStudyInstruction` duplicates research format rules (`- @book ...`), "只输出资料行，不要用 Edit 改文件", feynman "扮演 5 岁小孩" description, etc.
- 5 callers in scope:
  1. `apps/desktop/src/features/study/scheduleLink.ts:147` `buildStudyInstruction` — research/plan/feynman/selftest/sq3r
  2. `apps/desktop/src/services/clipService.ts:93-95` — card metadata fallback (non-skill branch)
  3. `apps/desktop/src/services/clipService.ts:287-302` — infographic (CORRECT, no change)
  4. `apps/desktop/src/services/wikiQueryService.ts:57-69` `buildQueryInstruction` — mostly thin pointer, light trim
  5. `apps/desktop/src/components/editor/DailyDigest.tsx:102-113` — schedule prompt with full contract duplication

## Requirements

- `buildStudyInstruction`: emit only `head` (topicName + cwdFileName), `动作：<action>`, and runtime-only context:
  - research: nothing extra (agent .md has format rules)
  - plan: `selectedMaterials` list (dynamic data the agent can't derive)
  - feynman: `unitTitle` if present (dynamic focus)
  - selftest: nothing extra
  - sq3r: `materialTitle` / `materialUrl` if present (dynamic target)
- `clipService.ts` card metadata fallback (line 93-95): replace inline JSON shape with thin instruction (`请分析以下网页生成知识卡片元数据。` + `原始 URL: ${url}` + `curl.md URL: ${mdUrl}`). JSON shape lives in `clips.md`.
- `clipService.ts` infographic prompt: leave as-is (already correct).
- `wikiQueryService.ts buildQueryInstruction`: keep `动作：query` + `## Wiki Context` + `## User Question` + thin pointer line. Drop the contract restatement ("请按 query action 输出契约..." → replace with one-line "请按 query action 契约输出。").
- `DailyDigest.tsx` prompt: drop "你是 Folyn 知识库的 AI 助手" preamble, drop "请输出 Markdown 格式...300 字以内" contract. Keep `今日：${todayStr}` + `## 今日修改文档` block + `## 最近日记` block.
- Canonical agent .md files: verify each action's contract is complete (so trimming prompts doesn't lose information). Add missing rules if a runtime prompt currently carries content not in .md.
- No behavior change in production output: research still returns `@book`/`@web` lines, plan still returns unit lines, feynman still appends callout, etc.

## Acceptance Criteria

- [ ] `buildStudyInstruction` output for each of 5 actions contains no format-rule duplication (no `@book` syntax, no callout block examples, no "不要 Edit 改文件")
- [ ] Card metadata fallback prompt ≤ 4 lines, no inline JSON shape
- [ ] `DailyDigest.tsx` prompt contains no 300字限制 / 内容包含 / Markdown格式 contract
- [ ] `wikiQueryService.ts` instruction ≤ 5 lines (excluding the wiki context block)
- [ ] Running each agent end-to-end produces the same shape of output as before (manual smoke test for at least study research + clips infographic + schedule digest)
- [ ] `featureAgentService.test.ts` still passes 45/45
- [ ] No canonical agent .md loses information vs. the pre-trim runtime prompt (cross-check: every rule that existed in old runtime prompt is now in .md or dropped as redundant)

## Definition of Done

- Tests added/updated (unit tests for `buildStudyInstruction` output shape if not already present)
- Lint / typecheck / CI green
- Code-spec `feature-agents.md` updated with "runtime prompt = params only, contract = agent .md" rule + trim pattern example
- No behavior regression in production agent output

## Technical Approach

**Trim pattern** (apply to every caller):
1. Drop role/preamble ("你是 ... 助手")
2. Drop output format rules (JSON shape, callout syntax, line grammar)
3. Drop meta-instructions ("不要 Edit 改文件", "只输出 ...")
4. Keep: action name, dynamic runtime data (paths, names, selected items, mode markers)

**Cross-check step**: before trimming each caller, diff the runtime prompt against the agent .md. Any rule in the runtime prompt that's NOT in .md must be added to .md first (so we don't silently lose contract).

**Reference correct pattern**: `clipService.ts:287` infographic prompt.

## Out of Scope

- Rewriting or reorganizing canonical agent .md files beyond adding missing rules (no architectural change)
- Changing `featureAgentService` seeding/discovery mechanism (PR-2-fix stays)
- Adding new actions or new feature agents
- Prompt internationalization
- Token-optimization (this is contract-deduplication, not compression)

## Technical Notes

- Files to edit:
  - `apps/desktop/src/features/study/scheduleLink.ts:147-205`
  - `apps/desktop/src/services/clipService.ts:85-113` (card metadata branch only)
  - `apps/desktop/src/services/wikiQueryService.ts:57-69`
  - `apps/desktop/src/components/editor/DailyDigest.tsx:100-113`
  - (verify) `apps/desktop/src/features/{study,clips,wiki,schedule}/.claude/agents/*.md`
- Reference pattern: `apps/desktop/src/services/clipService.ts:287-302` (infographic, correct)
- Spec: `.trellis/spec/desktop/frontend/feature-agents.md` (will add "runtime prompt = params only" rule)
