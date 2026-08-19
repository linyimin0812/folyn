# SQ3R 预读内容单独持久化到子文档

## Goal

把 SQ3R 预读内容从「写入 `## 笔记` 段尾 `[!note-sq3r]` callout」改为「单独落盘到子文档文件」。弹窗仍负责展示与"保留/重新预读"，但持久化路径不再寄生在 `## 笔记` 段；命中检测由扫描 callout 改为子文档文件存在性。

## What I already know

- 当前实现（commit `3f2cd47c`）：`saveSq3rCallout` 调 `upsertSq3rCallout(content, materialTitle)` 把 callout 写入 `## 笔记`；`findSq3rCallout` 从 `## 笔记` 段扫描匹配 `title="预读问题：{materialTitle}"` 的 callout。
- CLAUDE.md（study feature）已规定子文档约定：`__study__/<slug>/<link>.md` — "主题下的子文档（精细加工笔记、SQ3R 预读等）"。本次改动就是把 SQ3R 落到这条约定上。
- vaultStore 提供 `readFile` / `writeFile` / `createDir` / `listFiles`（无 `exists`，用 listFiles 或 try-readFile 兜底）。
- material 有 `id`（含 lineIndex，重排会变）与 `title`；`slugifyTopic(title)` 可复用做稳定文件名。

## Assumptions (temporary)

- 文件名：`__study__/<slug>/sq3r-<materialSlug>.md`，其中 materialSlug = `slugifyTopic(material.title)`。重名 / 改标题会留下孤儿文件——可接受（与 `## 笔记` callout 用 title 匹配的同类问题）。
- 文件内容：最小 front-matter（`materialTitle` + `source` 回链 topic slug）+ 原样 body（AI 产出的预读 markdown，含大纲与预读问题）。
- 命中检测：点击 SQ3R → 列 `<slug>/` 目录文件，按文件名匹配；命中读文件 → `setSq3rOutput`，未命中调 AI。

## Open Questions

- 文件名与命中方案是否同意？见下"Preference"。

## Requirements (evolving)

- 移除 `## 笔记` 段的 SQ3R callout 读写路径（`findSq3rCallout` / `upsertSq3rCallout` / `saveSq3rCallout` 重写或删除）。
- 新增 `__study__/<slug>/sq3r-<materialSlug>.md` 子文档的读/写/存在性检测。
- `runSq3r` 在 StudyWorkbenchPage：命中文件 → 直接 `setSq3rOutput(fileContent)`；未命中 → 调 AI，AI 产出 → `consumeSuggestion` 填 `sq3rOutput`，"保留"时 `saveSq3rCallout` 改为写子文档。
- study agent 契约无需改（仍只输出文本）。

## Acceptance Criteria (evolving)

- [ ] 点击已"保留"过预读的资料 SQ3R → 直接弹窗展示内容（不调 AI）。
- [ ] "保留" → 内容写入 `__study__/<slug>/sq3r-<materialSlug>.md`，`## 笔记` 段无 `[!note-sq3r]` callout 残留。
- [ ] "重新预读" → 清空弹窗 + 调 AI，产出后再次"保留"覆盖同一路径文件。
- [ ] material 标题改了 → 旧文件成孤儿，新文件按新 slug 新建（与现状 callout 失联同性质，可接受）。

## Definition of Done

- 相关单测更新（studyDoc / studyStore）。
- 6 locale i18n 无新增键需求（弹窗 UI 不变）。
- commit。

## Technical Approach

- studyDoc.ts：删 `findSq3rCallout` / `upsertSq3rCallout` / `buildSq3rCalloutLines`；新增 `sq3rSubdocPath(slug, materialTitle)` 与 `buildSq3rSubdoc(materialTitle, topicSlug, body)`（front-matter + body）。
- studyStore.ts：`saveSq3rCallout(slug, materialTitle, body)` 改为创建 `<slug>/` 目录（`createDir` 幂等）+ 写子文档；新增 `findSq3rSubdoc(slug, materialTitle)` 返回 body 或 null（listFiles 匹配文件名 → readFile）。
- StudyWorkbenchPage.runSq3r：`findSq3rCallout(rawLines, title)` → `findSq3rSubdoc(slug, title)`；命中 → `setSq3rOutput({ materialId, materialTitle, content: body })`。
- 弹窗 UI 不变（textarea 仍可编辑筛选；保留时 `saveSq3rCallout` 写文件）。

## Decision (ADR-lite)

- Context: 原 `[!note-sq3r]` callout 寄生 `## 笔记` 段，污染散文式笔记区；CLAUDE.md 已有子文档约定但未落地。
- Decision: 落到 `__study__/<slug>/sq3r-<materialSlug>.md` 子文档；front-matter 带 `materialTitle` 与 `topicSlug` 回链。
- Consequences: material 标题改 / 重排会留孤儿文件（与 callout 失联同性质，不退化）；目录结构更清晰，`## 笔记` 回归纯净散文区。

## Out of Scope

- 孤儿文件清理（未来再做：扫描子文档，front-matter 的 materialTitle 找不到对应 material 时提示删除）。
- 子文档在 study agent 上下文里的复用（未来可让 agent 读这些子文档做复习）。

## Technical Notes

- 相关文件：`apps/desktop/src/features/study/studyDoc.ts`、`apps/desktop/src/store/studyStore.ts`、`apps/desktop/src/components/study/StudyWorkbenchPage.tsx`、`apps/desktop/src/features/study/.claude/CLAUDE.md`（约定应更新：明确 SQ3R 落子文档）。
- 复用 `slugifyTopic` 做 materialSlug；`STUDY_DIR = '__study__'`。
