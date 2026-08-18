# Wiki Feature Polish

## Goal

补齐 Wiki 功能在查询召回、Review 闭环、Ingest 流程、UI/UX 四个维度上的"可感知缺口"——只做高杠杆、小 diff 的改动,把深度改造(缓存、watcher、history view)留给后续轮次。

## What I already know (audit findings, 2026-08-18)

### 1. 查询/召回质量
- BM25 无字段加权:title 命中和 body 命中同分 (`wikiSearch.ts:53,65-78`)
- 图谱扩展固定 1-hop、固定 0.5 权重、无 degree 剪枝 (`wikiSearch.ts:11,114-135`)
- 注释写了 "rerank" 但实现里没有 (`wikiSearch.ts:1,86-136`)
- citations 只收集 path,渲染成不可点击的 span (`WikiQueryView.tsx:13-19,136-139`)
- 每次 `searchWiki` 重新读取+分词全部 wiki 文件,无缓存
- 多轮只是 sessionId 透传,无 query rewriting

### 2. Review 闭环
- 无批量 accept/reject,每行独立按钮 (`WikiFileTree.tsx:188-190`)
- 无筛选/排序,按插入顺序展示 pending
- `initWiki` 只加载 pending,resolved/dismissed 完全丢弃 (`wikiStore.ts:79,197-203`)
- `executeReviewAction` 解决后不自动重跑 lint 验证 (`wikiStore.ts:205-222`)
- suggestedActions 标签硬编码中文,无 i18n (`wikiStructuralLint.ts:82-87,112-116,...`)

### 3. Ingest 流程
- hash 级增量存在,但内容每次全读+全 hash (`wikiIngestService.ts:129-134`)
- 无失败重试 (`wikiIngestService.ts:218-229`)
- UI 进度条上限 `/2`,但代码里跑到 step 3 (`wikiIngestService.ts:232-253`,`WikiFileTree.tsx:229`)
- 无源文件 mtime watcher,只能靠 lint 反向暴露
- 源文件删除后 wiki 页面不归档,只清 cache (`reviewActionHandlers.ts:134-144`)

### 4. UI/UX 打磨
- citations 不可点击,没接 `editorIoService.openFile`
- synthesis 保存时 `relatedPages: []` 硬编码,无反向链接 UI
- WikiQueryView 固定 padding,`flex-1` 中段无 `min-w-0`,窄面板溢出
- Reviews 空态只有文字,没有 "Run lint" CTA
- StatusBar wiki 指示器只显示单标签,未用 `currentIngestStep`/`ingestProgress`

## Requirements (MVP)

### R1: BM25 title 加权
- `wikiSearch.ts`:`bm25Score` 对 title 字段命中给 1.5x 加权(常量 `TITLE_BOOST=1.5`)
- 单测补一条 title-vs-body 同 token 的分数断言

### R2: Citations 可点击跳转
- `WikiQueryView.tsx`:citation span 改成 button,onClick 调 `editorIoService.openFile(\`${WIKI_PREFIX}${path}\`, name)`
- 渲染时从 path 推导 display name(strip `.md`)

### R3: Review 批量操作 + 筛选
- `WikiFileTree.tsx` reviews 分支:顶部加一行 toolbar
  - "全选" checkbox(只影响批量按钮可用性,不影响单项)
  - "Accept selected" / "Dismiss selected" 按钮
  - 筛选下拉:按 `checkId` 分组(默认 "all")
- 选中状态在 ReviewItemRow 内部,提升到 `WikiFileTree` 父级 Set<string>

### R4: 自动重跑 lint 验证修复
- `wikiStore.executeReviewAction`:`actionType === 'accept' || 'merge'` 成功后,异步触发 `runStructuralLintService()`(fire-and-forget,结果通过现有 toast 流转)
- 防抖:连续多个 accept 时,只在最后一个完成后 1s 触发一次(简单 timer)

### R5: Ingest step 显示对齐
- `wikiIngestService.ts` 第三个 overview refresh 步骤改为不调 `setIngesting` / 不改 step,或把 UI cap 从 `/2` 改为 `/3`
- 选后者:更如实反映三阶段,`WikiFileTree.tsx` 的 `Step ?/2` 改 `?/3`,文案对齐

### R6: Reviews 空态 CTA
- `WikiFileTree.tsx` reviews 空态加 "Run lint" 按钮,调 `runStructuralLintService()`

### R7: StatusBar wiki 指示器细节
- `StatusBar.tsx` `WikiStatusBarIndicator`:ingesting 时显示 `Step X/3 · <ingestProgress 截断 30 字>`,linting 时显示 `lint · <review count> new`,querying 不变

### R8: WikiQueryView 窄屏 min-w-0
- 中段容器加 `min-w-0`,citation flex-wrap 行已有,主要是父级 flex 溢出

## Acceptance Criteria

- [ ] BM25 title 命中分数 > body 命中(单测断言)
- [ ] WikiQueryView citation 可点击跳转到对应 wiki 页
- [ ] Reviews 子页支持批量 accept/dismiss + 按 checkId 筛选
- [ ] accept/merge review 后 1s 内自动重跑 structural lint
- [ ] Ingest 进度条显示 `Step 1/3`、`2/3`、`3/3`,不再出现 `?/2`
- [ ] Reviews 空态可见 "Run lint" 按钮且可触发
- [ ] StatusBar ingesting 状态显示当前 step + 截断 progress 文本
- [ ] WikiQueryView 在窄侧栏宽度下不溢出
- [ ] 所有改动维持现有 i18n key 命名空间,新增 key 在 en/zh/ja 三语补齐

## Definition of Done

- 新增/修改逻辑有对应单测(wikiSearch title 加权;批量操作)
- typecheck 不破坏(`pnpm -w tsc --noEmit` 仅在 apps/desktop)
- 手测:ingest → lint → accept review → 自动重跑 lint → toast 出现
- 不跑全项目编译(用户自己编辑+编译)

## Out of Scope (explicit, 推迟)

- BM25 字段加权之外的 rerank(cross-encoder / LLM rerank)
- 2-hop graph expansion + degree 剪枝
- PageDoc 内存缓存 + mtime invalidation
- resolved/dismissed 历史回看 UI
- IngestTask 失败重试 + backoff
- 源文件 mtime watcher 主动触发 ingest
- 源文件删除后 wiki 页面归档
- synthesis related 反向链接推断(从 query hits 推 related)
- 多轮 query rewriting / context compression

## Technical Notes

- 关键文件:`wikiSearch.ts`、`WikiQueryView.tsx`、`WikiFileTree.tsx`、`wikiStore.ts`、`wikiIngestService.ts`、`StatusBar.tsx`、`wikiSearch.test.ts`
- 模式参考:`useWikiStore` 稳定 selector 引用(上一轮 render loop 教训)
- i18n:wiki namespace 仅 en/zh/ja,es/de/fr 别名到 en
- auto-rerun-lint 的防抖用 `setTimeout` + module-level `pendingLintTimer`,不引入新依赖
