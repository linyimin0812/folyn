# refactor study / wiki / clips / schedule / project-analysis to per-vault claude agents

## Goal

重构 5 个功能模块（study、WIKI、CLIPS、日程、项目分析）的 agent 实现：每个功能用 `.claude/CLAUDE.md` + `.claude/agents/*.md` 定义，`.claude` 目录放在该功能的 `__{feature}__` vault 子目录下。统一规范、补齐 WIKI、引入 CLAUDE.md 作为 feature 级上下文。

## Confirmed decisions

1. **Vault 物理结构**：每 feature 独立子目录 `<vault>/__{feature}__/.claude/`（含 CLAUDE.md + agents/<feature>.md）。Agent 调用时 cwd = `<vault>/__{feature}__/`。
2. **子目录命名**：`__{feature}__` 双下划线包裹，与现有 `__clips__` / `__wiki__` / `__daily__` 约定一致。5 个 feature 目录：
   - `__study__/`（替代旧 `学习/`，不自动迁移）
   - `__clips__/`（已存在）
   - `__wiki__/`（已存在）
   - `__schedule__/`（新建，schedule agent 专用；事件仍在 `__daily__/` 日记里）
   - `__analyze__/`（新建）
3. **文件树隐藏**：`__{feature}__/` 目录不在主文件树中显示（与现有 `__clips__` / `__wiki__` 隐藏规则一致，由 sidebar 过滤）。
4. **WIKI agent 范围**：单 agent 多 action（ingest / lint / query），输出格式按 action 分区。把现有 `wikiIngestService` / `wikiLintService` / `wikiQueryService` 的内联 prompt 重构进 `__wiki__/.claude/agents/wiki.md`。
5. **日程 agent 命名**：`daily` 重命名为 `schedule`，放在 `__schedule__/.claude/agents/schedule.md`。cwd = `<vault>/__schedule__/`，调用时 `--add-dir <vault>` 以便访问 `__daily__/` 日记与今日修改文档。
6. **CLAUDE.md vs agent .md 职责分工**：
   - CLAUDE.md 装 feature 级上下文（vault 布局、数据模型、文件命名规则、feature 约定、数据目录结构）
   - agent .md 装严格的输出契约与 action 逻辑（action 列表、每个 action 的输出格式、通用规则）
   - 现有 4 个 agent prompt 中的上下文部分（如 study 的 "vault 是 cwd、可读写 学习/*.md"）迁入对应 CLAUDE.md，输出契约保留在 agent .md
7. **不迁移现有 vault 内容**：旧 `学习/` 等中文目录不自动重命名，由用户手动处理或留作历史。App 只在新结构下创建 `__{feature}__/`。

## Requirements

- 5 个 feature 各有 `<vault>/__{feature}__/.claude/CLAUDE.md` + `<vault>/__{feature}__/.claude/agents/<feature>.md`
- canonical 源文件位于 `apps/desktop/src/<feature>/.claude/{CLAUDE.md,agents/<feature>.md}`，通过 `?raw` import
- `featureAgentService` 种入路径从 `<vault>/.claude/agents/` 改为 `<vault>/__{feature}__/.claude/`，并新增 CLAUDE.md 种入（write-if-missing，不覆盖用户修改）
- `featureAgentService` 支持 schedule feature 的 `--add-dir <vault>` 调用参数
- WIKI 新增 `__wiki__/.claude/agents/wiki.md`，重构 `wikiIngestService` / `wikiLintService` / `wikiQueryService` 调用 feature agent（替代内联 prompt）
- `daily` agent 重命名为 `schedule`，canonical 源文件 `apps/desktop/src/schedule/.claude/agents/daily.md` → `schedule.md`
- 文件树过滤规则增加 `__study__` / `__schedule__` / `__analyze__`（`__clips__` / `__wiki__` 已过滤）
- 现有 4 个 agent prompt 拆分：上下文部分迁入 CLAUDE.md，输出契约留 agent .md
- `study/scheduleLink.ts` 注释中的路径 `<vault>/.claude/agents/study.md` 更新为 `<vault>/__study__/.claude/agents/study.md`

## Acceptance Criteria

- [ ] 5 个 feature 在干净 vault 下首次运行能自动种入完整 `__{feature}__/.claude/` 结构（含 CLAUDE.md + agents/<feature>.md）
- [ ] 用户修改的 CLAUDE.md / agent .md 不会被覆盖（write-if-missing）
- [ ] WIKI agent 可被调用，3 个 action（ingest/lint/query）返回契约格式输出
- [ ] schedule agent（原 daily）在 `<vault>/__schedule__/.claude/agents/schedule.md`，调用时 cwd=`__schedule__/` + `--add-dir <vault>`
- [ ] 现有 study/clips/analyze 调用路径不破坏，行为与重构前一致
- [ ] 文件树不显示 `__study__` / `__schedule__` / `__analyze__` / `__clips__` / `__wiki__`
- [ ] 单测覆盖：种子逻辑（新路径 + CLAUDE.md 不覆盖）、agent 调用参数（schedule 含 --add-dir）、文件树过滤、WIKI 3 action 输出契约

## Definition of Done

- 单测通过、lint/typecheck 通过
- 5 个 feature 在干净 vault 下首次运行能自动种入完整 .claude 结构
- 用户修改的 CLAUDE.md / agent .md 不会被覆盖
- 现有功能行为不破坏（study/clips/analyze/daily→schedule）
- sidebar 过滤新增 3 个 `__xxx__` 目录

## Technical Approach

### 文件结构（canonical 源）
```
apps/desktop/src/
  study/.claude/
    CLAUDE.md          (NEW — feature 上下文)
    agents/study.md    (重构 — 移除上下文，保留契约)
  clips/.claude/
    CLAUDE.md          (NEW)
    agents/clips.md    (重构)
  wiki/.claude/        (NEW — 整个 feature agent 是新增)
    CLAUDE.md
    agents/wiki.md
  schedule/.claude/    (rename from daily)
    CLAUDE.md          (NEW)
    agents/schedule.md (rename from daily.md，重构)
  analyze/.claude/
    CLAUDE.md          (NEW)
    agents/analyze.md  (重构)
```

### 运行时种入（featureAgentService）
- 检测 vault 切换后，对每个 feature：
  1. `createDir('<vault>/__{feature}__/.claude/agents')` (idempotent)
  2. `readFile('<vault>/__{feature}__/.claude/CLAUDE.md')` → 若缺失，`writeFile` canonical CLAUDE.md
  3. `readFile('<vault>/__{feature}__/.claude/agents/<feature>.md')` → 若缺失，`writeFile` canonical agent .md
- 调用 agent 时：
  - cwd = `<vault>/__{feature}__/`
  - `--agent <feature>` + `bare:false`（cwd 自动发现）
  - schedule 额外 `--add-dir <vault>`

### WIKI 重构
- 新增 canonical `apps/desktop/src/wiki/.claude/agents/wiki.md`（注意：wiki 模块当前没有独立 src 目录，需新建或放在 services/ 下）
- `wikiIngestService` / `wikiLintService` / `wikiQueryService` 改为调用 feature agent（action=ingest/lint/query），替代当前的内联 prompt + 通用 chat
- 3 个 service 的输出解析逻辑保留（JSON / ReviewItem[] / Markdown）

### 文件树过滤
- sidebar 文件树过滤规则新增 `__study__` / `__schedule__` / `__analyze__`（现有 `__clips__` / `__wiki__` / `__daily__` 已过滤）

## Decision (ADR-lite)

**Context**: 5 个 feature 的 agent 实现路径不统一（WIKI 用内联 prompt，其他用 feature agent 但无 CLAUDE.md），且都种入共享的 `<vault>/.claude/agents/`，缺少 feature 级上下文隔离。

**Decision**:
- 每 feature 独立 `__{feature}__/.claude/` 子目录（cwd 隔离 + 文件树隐藏）
- CLAUDE.md（上下文） + agents/<feature>.md（契约）分工
- WIKI 用单 agent 多 action 统一
- daily → schedule 重命名 + --add-dir 跨目录访问

**Consequences**:
- ✅ feature 间完全隔离，用户可独立定制每个 feature 的 CLAUDE.md
- ✅ WIKI 3 个 AI 任务统一为 feature agent，风格一致
- ✅ 文件树更干净（5 个 `__xxx__` 全隐藏）
- ⚠️ 现有 vault 的 `学习/` 等旧目录需用户手动迁移（不自动）
- ⚠️ schedule 调用需额外 --add-dir，与其他 feature 调用路径略不一致

## Out of Scope

- 现有 vault 中文目录（`学习/` 等）自动迁移到 `__study__` 等
- canonical 源升级后的 vault 内 agent .md 版本同步机制（用户改过就不覆盖，需未来引入版本号）
- 新 feature（如 review/flashcard）的 agent 定义
- WIKI 新增 action（如 synthesize 自动生成 synthesis 页）
- 多 vault 并行场景的特殊处理

## Implementation Plan (small PRs)

- **PR1**: 结构与服务层 — `featureAgentService` 种入路径改 `__{feature}__/.claude/`，新增 CLAUDE.md 种入，schedule agent rename + --add-dir 支持，sidebar 过滤新增 3 个 `__xxx__`
- **PR2**: 现有 4 agent 拆分 — 各 feature 新增 CLAUDE.md（上下文），agent .md 移除上下文部分（保留契约），`study/scheduleLink.ts` 路径注释更新
- **PR3**: WIKI agent — 新增 `wiki/.claude/{CLAUDE.md,agents/wiki.md}`，重构 3 个 wiki service 调用 feature agent

## Technical Notes

- canonical agent 源文件位于 `apps/desktop/src/<feature>/.claude/agents/*.md`，通过 `?raw` import
- `featureAgentService` 是种入与发现的核心（`apps/desktop/src/services/featureAgentService.ts`）
- `ClaudeAdapter.buildClaudeArgs` 已支持 `--agent` / `--agents` / `--add-dir` / `bare` 所有所需 flag
- 现有 `__clips__` / `__wiki__` / `__daily__` 双下划线目录约定已建立（`types/wiki.ts:WIKI_DIR`、`clipService`、`CalendarPanel`）
- WIKI 现有 services：`wikiIngestService` / `wikiLintService` / `wikiQueryService` / `wikiProvider`
- `study/scheduleLink.ts:135` 注释提到旧路径 `<vault>/.claude/agents/study.md`，需更新
