# seed-always-overwrite canonical agent files

## Goal

Vault 内 feature agent 文件（`<vault>/__<feature>__/.claude/{agents/<feature>.md, CLAUDE.md}`）与 canonical 源（`apps/desktop/src/<feature>/.claude/...`）漂移时，开发期改 canonical 不刷新 vault 副本，导致 AI 跑旧契约。把 `seedAgentFiles` 的 write-if-missing 改成 always-overwrite：canonical 是 single source of truth，vault 副本始终以 canonical 为准。

## Background

- 上个任务 `08-19-sq3r-persist-subdoc`（commit 7a903b00）改了 canonical `study.md` / `CLAUDE.md` 去掉 callout 包裹、改为子文档约定，但 vault 副本仍是旧版 —— AI 仍按旧 callout 格式输出 SQ3R，弹窗显示旧文本。
- 根因：`featureAgentService.ts:240-254` 的 `seedAgentFiles` 对每个目标先 `readFile` 探测，成功则 `status='exists'` 不覆盖。设计意图是保护用户对 vault 副本的手改，但开发期 canonical 变更后老副本不刷新。

## Requirements

- `seedAgentFiles` 对 CLAUDE.md / agent .md / pi AGENTS.md 三个目标都去掉 readFile 探测分支，直接 `writeFile(canonical)`。失败仍走 `status='failed'`。
- `SeedAgentResult.status` 字段保留语义：'seeded'（写了，不论新旧）/ 'failed'。'exists' 不再触发（可保留枚举值兼容类型，或删掉——选保留，最小 diff）。
- 诊断日志（`feature-agent-seed.log`）随之反映每次都 'seeded'，便于排查。
- 不改 `lazySeedAgentFiles` / `agentFileExists` 调用点；不改 schedule 的 `addVaultDir`；不改 pi 路径结构。

## Acceptance Criteria

- [ ] 启动 / vault 切换后，`<vault>/__study__/.claude/agents/study.md` 内容 == canonical 源。
- [ ] 手改 vault 副本后重启，副本被 canonical 覆盖（手改丢失，符合预期）。
- [ ] `feature-agent-seed.log` 显示所有 feature 'seeded'（非 'exists'）。
- [ ] `featureAgentService.test.ts` 现有用例不破（除非断言 'exists'，需同步改）。
- [ ] SQ3R 二次点击：弹窗显示新格式 `**大纲**` + `**预读问题**`（不再 `:::callout`）。

## Definition of Done

- Tests added/updated（断言 writeFile 被调用而非 readFile 短路）
- Lint / typecheck green（不跑全项目编译；用户自验）
- 行为变更点在 commit message 写清（用户手改会被覆盖）
- 4 个 vault 副本（llm-proxy-server + default_vault × {study.md, CLAUDE.md}）已与 canonical 一致

## Out of Scope

- 版本戳 / 内容 hash 比对机制（用户明确否决，选 always-overwrite）
- 按需只 seed 被调用的 feature（现在是全量 seed，IO 浪费但 ponytail 不扩）
- canonical 文件热更新（不引入 watcher）

## Technical Approach

`apps/desktop/src/services/featureAgentService.ts` 的 `seedAgentFiles` 内三个 try/catch 块（CLAUDE.md / agent .md / pi AGENTS.md）：

```ts
// before
try {
  await manager.readFile(path);
  results.push({ ..., status: 'exists' });
} catch {
  try { await manager.writeFile(path, content); results.push({ ..., status: 'seeded' }); }
  catch (err) { results.push({ ..., status: 'failed', error: msg }); }
}

// after
try {
  await manager.writeFile(path, content);
  results.push({ ..., status: 'seeded' });
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  console.warn(`[featureAgent] seed failed at ${path}:`, err);
  results.push({ ..., status: 'failed', error: msg });
}
```

`SeedAgentResult.status` 类型保留 `'seeded' | 'exists' | 'failed'`（'exists' 不再触发，但删字段会破向后兼容，留空枚举不增成本）。

## Decision (ADR-lite)

**Context**: write-if-missing 保护用户手改，但开发期 canonical 变更不刷新 vault 副本，导致 AI 跑旧契约。
**Decision**: 改 always-overwrite。canonical 是 single source of truth；用户若想定制 agent，fork canonical 源在 `apps/desktop/src/<feature>/.claude/` 而非改 vault 副本。
**Consequences**: 用户对 vault 副本的手改会在 vault 切换/启动/lazy-seed 时丢失。每次 `runFeatureAgent` 都全量写 5 features × 2 文件（+ pi），IO 成本可接受。

## Technical Notes

- 关键文件：`apps/desktop/src/services/featureAgentService.ts:210-279`（`seedAgentFiles`）。
- 调用点：`switchVault`（启动/切 vault）+ `lazySeedAgentFiles`（每次 `runFeatureAgent` / `isAgentAvailable`）。
- 测试：`featureAgentService.test.ts` 现状需 grep 看是否断言 'exists'。
- spec：`feature-agents.md` Validation Matrix 承诺 graceful degradation（agent 不存在走 --bare + --agents 内联），本改动不破该承诺（agentFileExists 仍可用）。
