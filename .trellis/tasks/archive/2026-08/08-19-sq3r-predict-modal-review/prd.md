# SQ3R 预读弹窗审阅

## Goal

把当前 SQ3R "AI 直编 `## 笔记` + diff 审阅横幅" 的流程，改为 "AI 产出文本 → 弹窗展示 → 用户保留相关内容后写入 `## 笔记` → 支持重新预读"。让用户在写入前主动筛选，而不是事后审 diff。

## What I already know

- 现状（`apps/desktop/src/features/study/.claude/agents/study.md` L54-56）：
  - SQ3R 用 Edit 工具直接编辑主题文档 `## 笔记` 段，段尾追加 callout 块（大纲 + 预读问题）
  - 与 feynman / selftest 同属"直编文件"类动作
  - 契约：append-only，不删除/改写已有内容
- 现状（`scheduleLink.ts` + `featureAgentService.ts`）：
  - SQ3R 调 `openStudyAiAction` → `runFeatureAgent('study', ...)` 在隐藏的 study 会话运行
  - file_change 事件 → `aiStore.addFileChange` → `enterDiffReview` 弹 diff 审阅横幅
  - study 会话已对 AI Panel 隐藏（per-topic 隔离）
- 现状（`StudyMaterialsSection.tsx`）：
  - SQ3R 按钮已加 per-card loading（sq3rId + studyStreaming 监听）
  - 按钮文字 `materials.sq3r`，运行中显示 `materials.sq3rRunning`
- 现状（`studyStore.ts`）：
  - `pendingSuggestion` 跟踪 `research | plan | atoms | quiz | grill`，不含 sq3r
  - research/plan/atoms/quiz 走"AI 输出文本 → store 捕获 effect 最后一条 assistant 消息 → 自动写盘 / 建议卡片"模式
- 同类参考（research/plan/atoms/quiz）：AI 输出文本行，studyStore 捕获后或自动写盘（research/atoms/quiz）或建建议卡片（plan）

## Assumptions (temporary)

- SQ3R 改为输出文本，前端写入 `## 笔记`（与 research/atoms/quiz 一致）
- 弹窗内支持编辑（用户删掉不要的部分）后点"保留"写入 `## 笔记` 段尾
- 重新预读：再次点 SQ3R → 重新生成 → 弹窗内容替换
- 不破坏现有 diff 审阅横幅（其它直编动作 feynman/selftest 仍走 diff）

## Open Questions

- 重新预读时旧 callout 如何处理（替换 / 追加 / 让用户先删）？

## Decision (ADR-lite)

**Context**: SQ3R 现走"AI 直编 ## 笔记 + diff 横幅"流程，用户需在写入前筛选内容。
**Decision**:
1. AI 输出模式：改 agent 契约，SQ3R 从"用 Edit 写文件"变为"只输出文本"（大纲 + 预读问题），与 research/atoms/quiz 一致。studyStore 捕获 study 会话最后一条 assistant 消息 → 推送入弹窗。
2. 持久化位置：`## 笔记` 段尾的标记 callout（`> [!note-sq3r]`），callout 内首行带资料标题作为 per-material 标识。前端解析 / 写入此 callout。
3. 保留语义："保留"= 把弹窗内容写入 / 替换该资料的 `[!note-sq3r]` callout。下次点同一资料的 SQ3R 按钮 → 扫 `## 笔记` 找对应 callout → 命中则直接弹窗展示（不调 AI）；未命中则调 AI 生成 → 弹窗展示 → 用户保留后写入。
4. 重新预读：弹窗内"重新预读"按钮 → 强制调 AI 重新生成 → 替换弹窗内容 → 用户再"保留"则覆盖旧 callout。

**Consequences**:
- agent 文档要改（sq3r 段落 + 顶部契约表）
- studyStore 加 sq3r 输出捕获 / 弹窗状态
- 不再触发 file_change / diff 横幅（feynman/selftest 仍走旧直编路径，不受影响）
- callout 标识靠资料标题字符串，重命名资料后旧 callout 失效（acceptable edge case）

## Requirements (evolving)

- 改 agent 契约：SQ3R 从"Edit 写 `## 笔记`"变为"只输出文本"（大纲 + 预读问题），与 research/atoms/quiz 一致
- 点 SQ3R → 先扫 `## 笔记` 找该资料的 `[!note-sq3r]` callout：
  - 命中 → 直接打开弹窗展示 callout 内容（不调 AI）
  - 未命中 → 调 AI 生成 → 弹窗展示
- 弹窗内"重新预读"按钮 → 强制调 AI 重新生成 → 替换弹窗内容
- 弹窗内"保留"按钮 → 把弹窗内容写入 / 替换 `## 笔记` 段尾该资料的 `[!note-sq3r]` callout
- callout 首行带资料标题作为 per-material 标识

## Acceptance Criteria (evolving)

- [ ] 改 agent 文档：sq3r 段改为"只输出文本"，顶部契约表 sq3r 移到"只输出文本"类
- [ ] 点 SQ3R 按钮：无持久化 → 调 AI → 弹窗显示产出
- [ ] 点 SQ3R 按钮：有持久化 → 不调 AI → 弹窗直接显示 callout 内容
- [ ] 弹窗内"重新预读"→ 调 AI 重新生成 → 弹窗内容替换
- [ ] 弹窗内"保留"→ 写入 `## 笔记` 段尾 `[!note-sq3r]` callout（首行资料标题）
- [ ] 重复"保留"→ 替换该资料的旧 callout（不追加）
- [ ] SQ3R 运行期间按钮 loading（已具备）
- [ ] 不触发 file_change / diff 审阅横幅（验证 feynman/selftest 仍触发）

## Definition of Done

- 测试：SQ3R 输出捕获 / 弹窗 UI / 写入逻辑单测
- 类型检查通过；不破坏 feynman/selftest 的 diff 流程
- i18n：zh + en + ja + de + es + fr

## Out of Scope

- 改 feynman / selftest 的直编 + diff 流程（仍走旧路径）
- 改 study 会话隐藏策略
- 多资料批量 SQ3R（暂只支持单卡 SQ3R）

## Technical Notes

- 关键文件：
  - `apps/desktop/src/features/study/.claude/agents/study.md` — agent 契约
  - `apps/desktop/src/features/study/scheduleLink.ts` — `buildStudyInstruction('sq3r', ...)`
  - `apps/desktop/src/services/featureAgentService.ts` — `runFeatureAgent` 事件路由
  - `apps/desktop/src/store/studyStore.ts` — `pendingSuggestion` / effect 捕获
  - `apps/desktop/src/store/aiStore.ts` — study 会话 streaming/file_change
  - `apps/desktop/src/components/study/StudyMaterialsSection.tsx` — SQ3R 按钮 + (新)弹窗
- 约束：append-only；不改写既有 `## 笔记` 内容；保留 callout 块格式
