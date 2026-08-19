# 删除 study 复习和检测模块 (feynman + selftest)

## Goal
删除 study feature 中的两个 AI 动作：feynman（费曼挑战 / 复习）和 selftest（自测 / 检测）。两者都是写 `## 笔记` callout 的 AI 笔记增强动作，成对移除。

## Scope

### 删除
- `AiAction` 类型枚举值 `'feynman'` 和 `'selftest'`（types.ts）
- `buildStudyInstruction` 的 `case 'feynman'` / `case 'selftest'` 分支（scheduleLink.ts）
- `StudyNotesSection` 中的"费曼挑战"按钮（feynman 唯一 UI 入口）
- agent canonical 文件 `study.md` 中 `## feynman` / `## selftest` 段，以及 front-matter description 与通用规则中相关提及
- `CLAUDE.md` 中 `feynman/selftest` 相关描述行
- 6 个 i18n locale 的 `notes.feynman` / `notes.feynmanTitle` 键
- 测试：`scheduleLink.test.ts` 的 feynman/selftest 两个用例；`studyAgent.test.ts` 中第 28 行 it 描述与断言（callout 契约）
- `studyStore.ts` 已经只有 `'research' | 'plan' | 'grill' | 'sq3r'`，无需改
- 注释清理：`StudyWorkbenchPage.tsx:159`、`scheduleLink.ts:144,274`、`StudyNotesSection.tsx:71`、`studyAgent.ts:9`
- i18n `sessionHint` 字符串中"自测"字样（已是陈旧文案）

### 保留
- research / plan / grill / sq3r 四个动作完全不变
- `## 笔记` 段本身保留（用户自由写 + 子文档 wiki 链接）
- `appendToNotesSection` + `ELABORATION_TEMPLATE` 模板插入按钮（精细加工模板，不是 AI 动作）
- DiffView 审阅机制（仍服务 sq3r 子文档写入，由前端触发而非 AI Edit）

## Acceptance Criteria
- [ ] `grep -rn "feynman\|selftest\|费曼挑战\|自测题" apps/desktop/src` 在 study 相关文件中无残留（"自测"陈旧文案清掉）
- [ ] `AiAction` 类型不含 `'feynman' | 'selftest'`
- [ ] `buildStudyInstruction` switch 无 feynman/selftest case（TS 穷尽检查会强制 default）
- [ ] StudyNotesSection 不再渲染 feynman 按钮，不再 import `buildStudyInstruction` / `openStudyAiAction` / `isAiAvailable`
- [ ] `study.md` 不含 feynman/selftest 段，description 不再提"费曼/自测"
- [ ] `pnpm test` scheduleLink + studyAgent 套件绿
- [ ] 6 个 i18n locale 删除 `feynman` / `feynmanTitle` 键，json 合法

## Out of Scope
- 已存在的 `## 笔记` callout 历史内容不清理（用户自己的笔记）
- vault 副本的手动覆盖（`seedAgentFiles` 是 always-overwrite，重启即刷新）
- 学习会话内其它 AI 动作的 UI 调整

## Technical Notes
- feynman 是唯一 UI 入口（StudyNotesSection 按钮）；selftest 本来就没挂按钮，删它只清类型 + 指令分支 + agent canonical + 测试
- `seedAgentFiles` 已改为 always-overwrite（commit b6f2a22c），编辑 canonical study.md 后重启会自动刷新 vault 副本
- 不需要新增迁移代码：AiAction 是 union，去掉两个字面量类型自动收窄
