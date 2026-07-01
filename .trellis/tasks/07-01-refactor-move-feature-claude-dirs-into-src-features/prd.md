# refactor: move feature dirs into src/features

## Goal

把 `apps/desktop/src/` 下 5 个 feature 顶层目录（`study` / `analyze` / `clips` / `schedule` / `wiki`，含源码与 `.claude`）整体迁入新建的 `apps/desktop/src/features/`，统一 feature 的物理位置，降低 `src` 顶层目录密度。

## What I already know

- `@` alias → `./src`（`tsconfig.json` paths + `vite.config.ts` alias 一致）。
- 5 个 feature 目录均无 `index.ts` barrel。
- 所有跨 feature 引用都走 `@/{feature}/...`，**无相对路径引用**（`../study/` 等 0 处）。
- 受影响文件 31 个（含 `services/featureAgentService.ts` 的 `?raw` import：`@/study/.claude/agents/study.md?raw` 等）。
- `featureAgentService.ts` 在运行时构造的 vault 路径（`__study__/.claude/...`）是 vault 相对，与源码位置无关，**不受影响**。
- `components/schedule/`、`components/study/` 在 `components/` 下，不在本次迁移范围，保持不动。
- 无 `.json` / `.md` / 构建脚本硬编码引用这些源码路径。

## Requirements

- 新建 `apps/desktop/src/features/`。
- `git mv` `src/{study,analyze,clips,schedule,wiki}` → `src/features/{study,analyze,clips,schedule,wiki}`（保留 git 历史，含已 modified 的 `.claude` 内文件）。
- 全量替换 import：`@/{study,analyze,clips,schedule,wiki}/` → `@/features/{...}/`（仅 `.ts` / `.tsx`）。
- typecheck / lint / 既有测试全绿。
- 不改变任何运行时行为。

## Acceptance Criteria

- [x] `apps/desktop/src/features/{study,analyze,clips,schedule,wiki}` 存在且内容完整（含 `.claude`）。
- [x] 原 `src/{study,analyze,clips,schedule,wiki}` 已不存在。
- [x] `grep -rn "@/study/\|@/analyze/\|@/clips/\|@/schedule/\|@/wiki/" src` 0 命中（全部已改为 `@/features/...`）。
- [x] `tsc -b` 通过。
- [x] desktop 无独立 lint 脚本（package.json 仅 dev/build/clean），跳过。
- [x] vitest 55 文件 / 776 用例全过（含迁移后的 `features/study/*`、`features/wiki/*` 测试）。

## Definition of Done

- Tests green / typecheck green / lint green。
- 无行为变更，纯结构重构。
- 一次 commit，message 说明是目录重构。

## Technical Approach

1. `mkdir -p apps/desktop/src/features`
2. `git mv` 5 个目录进 `features/`。
3. `sed` 批量替换 5 个 import 前缀（带尾 `/`，避免误伤 `scheduler` 之类；不存在同名风险，已确认无 `@/study` 等裸引用）。
4. `tsc` / `lint` / `test` 验证。

## Decision (ADR-lite)

- **Context**: feature 目录迁入 `features/` 后，import 前缀有两种写法。
- **Decision**: 沿用现有 `@` alias，import 写 `@/features/{feature}/`，不改 tsconfig / vite。
- **Consequences**: 零配置改动；import 路径稍长但语义清晰；未来若 feature 多可再加 `@features` alias。

## Out of Scope

- `components/{schedule,study,...}` 不动。
- 不调整 feature 内部结构、不合并/拆分文件。
- 不引入新 barrel export。

## Technical Notes

- 受影响文件清单（31）：`components/schedule/*`(16)、`components/study/*`(7)、`services/featureAgentService.ts`、`services/planMyDayService.ts`、`store/scheduleStore.ts`、`store/settingsStore.ts`、`store/studyStore.ts`、`store/studyStore.test.ts`、`study/scheduleLink.ts`、`study/scheduleLink.test.ts`。
- `featureAgentService.ts` 的 `?raw` import 同步改路径即可，运行时 vault 播种逻辑不变。
