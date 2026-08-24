# 删除整个 study feature

## Goal
完全删除 Folyn desktop app 中的 study (学习工作台) feature：UI、数据层、AI 动作、agent canonical 文件、i18n、所有交叉基础设施引用。vault 里 `__study__/` 已有内容不清理（用户数据，留盘）。

## Scope

### A. 整目录/文件删除

- `apps/desktop/src/components/study/` 全目录（13 个 .tsx + 测试）
- `apps/desktop/src/features/study/` 全目录（含 `.claude/agents/study.md`、`.claude/CLAUDE.md`、markdown/scheduleLink/studyAgent/studyDoc/types/progress 及测试）
- `apps/desktop/src/store/studyStore.ts` + `studyStore.test.ts`
- `apps/desktop/src/services/featureAgentService.test.ts`（76 处 study 引用，整文件几乎全为 study 测试 → 删）
- `apps/desktop/src/components/icons/StudyIcon.tsx`
- `apps/desktop/src/assets/icons/study.svg`（仅 StudyIcon + pluginStore 使用 → 删）
- `apps/desktop/src/i18n/locales/{de,en,es,fr,ja,zh}/study.json`（6 文件）

### B. 共享文件中删除 study 引用（精准 hunk 级编辑）

**App.tsx**
- L18 删 `import { StudyWorkbenchPage }`
- L721-726 删 `{currentPage === 'study' && ...}` 路由块
- L748-755 删 `function StudyContent()` 定义

**store/navStore.ts**
- `AppPage` union 去掉 `'study'`

**store/aiStore.ts**
- `AiSessionKind` 去掉 `'study'` 变体（如果只剩 `'chat'`，把 type 整个删，session.kind 字段也删）
- `AiSession.studyTopic` 字段删
- `AiSession` interface 中其它 study 专属字段同步清
- `studySessionIds` 字段 + 初始值 `{}`
- `getStudySessionId` / `getOrCreateStudySession` 方法从 interface 与实现里删
- `getOrCreateStudySession` 完整实现（约 L200-225）删，包括孤儿扫描
- `setActiveSession` 内 `if (target?.kind === 'study') return;` 删
- `deleteSession` 内 study map 清理逻辑删（保留 sessions/activeSessionId 部分）
- 所有相关注释清理

**store/aiStore.test.ts**
- L70 setup 中 `studySessionIds: {}` 去掉
- `describe('useAiStore study session (PR9)')` 整块删（L375-465+）
- 其它 stray `study` 引用清

**store/aiSessionPersistence.ts**
- L78-81 `normalizedActiveId` study 隐藏逻辑删（直接用 `activeSessionId`）

**store/appearanceStore.ts**
- `enableStudyPanel` 从 PERSISTED_KEYS、interface、defaults、setter、hydrate patch 中删

**store/pluginStore.ts**
- L27 `import studySvgText from '@/assets/icons/study.svg?raw'` 删
- L98 `{ id: 'builtin:study', ... }` 条目删
- L92 注释中 "schedule + study listed FIRST" 改为 "schedule listed FIRST"
- L231 `: def.id === 'builtin:study' ? studySvgText` 分支删

**services/featureAgentService.ts**
- L13-14 `import studyAgentDoc / studyClaudeDoc` 删
- L80 `FEATURE_AGENT_FILES` 数组中 `{ feature: 'study', ... }` 条目删
- `runFeatureAgent` 函数（L317-365 左右）整段删——它只服务 study；其它 feature 已用 bespoke flow
- `RunFeatureAgentOptions.studySlug` 字段删
- 相关注释 "study 走 aiStore 会话..." 全清
- 如果文件只剩 seedAgentFiles（且非 study 相关），保留；若 seedAgentFiles 也只服务 study，整个文件删

**services/petHostRouter.ts**
- L248-251 `case 'study':` 分支删

**services/petHostRouter.test.ts**
- L195 `target: { kind: 'study', id: 'today' }` 测试用例删

**components/pet/PetBubbleApp.tsx**
- L49 `kind` union 去掉 `'study'`

**components/ai/AiPanel.tsx**
- L86-87 `sessions.filter((s) => s.kind !== 'study')` 改回 `sessions`（不再过滤）

**components/ai/ChatInput.tsx**
- L147 注释 "Feature-agent sessions (kind='study')..." 删
- L829 `sessionKind !== 'study' &&` 条件去掉（永远渲染 AdapterSelector）

**components/shell/ActivityBar.tsx**
- L32 `import { StudyIcon }` 删
- L54 `const enableStudyPanel = useAppearanceStore(...)` 删
- L61 `const onStudy = currentPage === 'study'` 删
- L119-126 `{enableStudyPanel && (...)}` 整块 study 按钮删
- 顶部注释中 "study" 字样清理

**components/shell/ActivityBar.test.tsx**
- L20, L48, L95 注释 "daily/study/settings" 改 "daily/settings"
- L48 注释 "3 page-nav buttons (daily/study/settings) = 6" 改 "2 page-nav buttons (daily/settings) = 5"（或重新数）
- 测试断言中 study 相关 expectations 删

**components/shell/Topbar.tsx**
- L115 `currentPage === 'editor' || currentPage === 'study'` 改 `currentPage === 'editor'`

**components/settings/PluginsSettings.tsx**
- L177 `enableStudyPanel` selector 删
- L205 `entry.id === 'builtin:study' ? enableStudyPanel` 分支删
- L295 `entry.id === 'builtin:study'` setEnableStudyPanel 分支删

**components/settings/FeatureAdapterDropdown.tsx**
- L30 `'builtin:study': 'study'` mapping 条目删

**i18n locales/{de,en,es,fr,ja,zh}/shell.json**
- `"nav.study"` 键删

**i18n locales/{de,en,es,fr,ja,zh}/settings.json**
- `appearance.panels.study` 对象删

**store/scheduleStore.ts:592 / store/vaultStore.ts:569**
- 注释中 "studyStore" 提及清掉（改为只提 scheduleStore 或留 "其它工作台"）

### C. 不动
- vault 里 `__study__/` 已有用户内容（用户数据，不删）
- `.trellis/tasks/08-19-*` 任务目录（流程记录，不动）
- aiStore 的 `sessions`、`activeSessionId`、`switchSession`、`deleteSession`、`addFileChange` 等通用机制（只删 study 专属字段/方法）
- schedule、clips、wiki、reports、analyze 等其它 feature
- 编辑器、AI 面板、终端 host（共享基础设施）

## Acceptance Criteria

- [ ] `grep -rln "study\|Study" apps/desktop/src --include="*.ts" --include="*.tsx" --include="*.json"` 仅剩 i18n 中残留的中文 study 关键字（如有）或无任何命中
- [ ] `apps/desktop/src/components/study/` 与 `apps/desktop/src/features/study/` 目录不存在
- [ ] `apps/desktop/src/store/studyStore.ts` 不存在
- [ ] 6 个 locale 的 `study.json` 不存在
- [ ] `AppPage` type 不含 `'study'`
- [ ] `AiSessionKind` 不含 `'study'`（或 type 整个被删）
- [ ] `runFeatureAgent` 函数不存在
- [ ] `enableStudyPanel` 不在 appearanceStore
- [ ] `builtin:study` 不在 pluginStore
- [ ] `pnpm vitest run src/store/aiStore.test.ts src/store/aiSessionPersistence.test.ts src/services/petHostRouter.test.ts` 全绿
- [ ] `pnpm typecheck` 绿
- [ ] App 启动时不再有 study 路由/按钮/会话

## Definition of Done
- 上述 AC 全绿
- i18n JSON 文件合法（python3 -m json.tool 校验）
- 注释中残留的 "study" 字样清理

## Out of Scope
- vault 里 `__study__/` 用户数据清理
- `.trellis/tasks/` 历史任务记录清理
- 当前工作树里 user 的其它 WIP（paper 支持、SQ3R、StudyAddTopicDialog 等）——这些文件如果属于 study 目录会一并被删除；如果不属于，保留
- 其它 feature（schedule、clips、wiki 等）的改动

## Technical Notes

### 关于 working tree 的现有改动
当前工作树有大量 study 相关 WIP（用户之前在做）+ 我刚做的 feynman/selftest 删除。本任务的删除会覆盖所有这些改动——study 目录整个被 rm 掉，studyStore.ts 删掉。非 study 目录的文件（如 aiStore.ts、App.tsx）按 hunk 精准编辑。

### seedAgentFiles 是否保留
`featureAgentService.ts` 的 `seedAgentFiles` 函数原本服务 study agent。删除后：
- 如果文件中除 study 外没有其它 feature 的 seeding 逻辑 → 整个 featureAgentService.ts 删除
- 如果有其它 feature 的 seeding → 保留 seedAgentFiles，只删 study 条目

实施时检查 `FEATURE_AGENT_FILES` 数组，若删 study 后空，整文件删；否则保留剩余。

### runFeatureAgent 是否保留
`runFeatureAgent` 当前注释明确 "only study"。删 study 后整个函数可删（其它 feature 用 bespoke flow via getFeatureAgentSendOptions）。

### AiSessionKind 是否保留
若 `'study'` 删后只剩 `'chat'`，整个 `kind` 字段可删（type 简化为不存在该字段，或固定为 'chat'）。实施时按 ponytail 原则：删干净，不留单值 type。

### PetBubbleApp 'study' kind
声明在 union 里但全局无生产代码 emit 该 kind——是死代码。删 union 项即可。

### StudyIcon / study.svg
StudyIcon 仅 ActivityBar 用，study.svg 仅 StudyIcon + pluginStore 用。三者一起删。

### ActivityBar.test.tsx 断言数变化
原断言 "3 page-nav + 3 panel = 6"。删 study 按钮后变 "2 page-nav + 3 panel = 5"。需同步改测试。

## Implementation Plan

单次 trellis-implement dispatch，按以下顺序：

1. **删整目录/文件**（rm -rf + git rm 等价）：components/study/、features/study/、store/studyStore*、study i18n、StudyIcon、study.svg、featureAgentService.test.ts
2. **删 aiStore study 基础设施**：kind 字段、studyTopic、studySessionIds、getOrCreate/Get*、orphan scan、setActive/deleteSession 中的 study 分支
3. **删 featureAgentService**：study imports、FEATURE_AGENT_FILES 条目、runFeatureAgent 整函数（确认其它 feature 不依赖）。若文件只剩非 study 代码则保留，否则整文件删
4. **删 appearanceStore + pluginStore**：enableStudyPanel 全套、builtin:study 条目、studySvgText import
5. **删 App.tsx**：StudyContent、import、route 块
6. **删 navStore + petHostRouter + pet bubble**：AppPage 'study'、case 'study'、PetBubbleApp kind 'study'
7. **删 ActivityBar**：StudyIcon import、enableStudyPanel selector、study button、注释；同步修 ActivityBar.test.tsx 断言
8. **删 aiStore.test + aiSessionPersistence + AiPanel + ChatInput**：study test block、normalizedActiveId study 隐藏、kind !== 'study' filter、sessionKind !== 'study' check
9. **删 Topbar + PluginsSettings + FeatureAdapterDropdown**：currentPage === 'study'、enableStudyPanel 用法、builtin:study mapping
10. **删 6 locale 的 shell.json nav.study + settings.json appearance.panels.study**
11. **清 scheduleStore.ts:592 + vaultStore.ts:569 注释**
12. **删 petHostRouter.test.ts:195 study 测试用例**

每步后跑 `pnpm vitest run <相关测试文件>`。最后 `pnpm typecheck`。grep 残留验证。
