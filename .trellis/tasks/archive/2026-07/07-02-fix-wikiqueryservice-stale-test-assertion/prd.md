# fix: wikiQueryService stale test assertion

## Goal

修复 `wikiQueryService.test.ts` 的过时断言，对齐 `fbf5098`（runtime prompt params-only，静态契约移至 wiki agent.md）的设计。

## What I already know

- `fbf5098 refactor(agents): trim runtime prompts to params-only` 把 `buildQueryInstruction` 改成 params-only：`动作：query\n## Wiki Context\n...\n## User Question\n...\n请按 query action 契约输出。`，不再含 `[[wiki://path]]`。
- `[[wiki://path]]` 引用契约移到 `features/wiki/.claude/agents/wiki.md`（第 64 行）。
- 测试 `wikiQueryService.test.ts:21` 仍 `expect(prompt).toContain('[[wiki://path]]')` → 失败。
- 其余断言（`What is X?` / `CTX` / `动作：query`）仍有效。

## Requirements

- 把 `toContain('[[wiki://path]]')` 改为验证 params-only 委派的断言：`toContain('请按 query action 契约输出')`。

## Acceptance Criteria

- [ ] `wikiQueryService.test.ts` 该用例通过。
- [ ] 全量 vitest（repo root）绿。
- [ ] 不改实现、不改 agent.md。

## Out of Scope

- 不动 `buildQueryInstruction` 实现。
- 不动 wiki agent.md。

## Technical Notes

- 改 `apps/desktop/src/services/wikiQueryService.test.ts:21` 一行。
