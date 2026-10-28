# 知识构建提速：资料级 + 块级并行

## Goal

资料整理（build）太慢。现状：资料逐份串行（`knowledgeBuild.ts:138` 单循环），每份内部索引块（`sourceIngest.ts:136`）与合成块也逐块串行，全部时间耗在 LLM 往返上。改为两级并行，缩短总时长。

## Requirements

* **资料级并行**：多份资料并发处理（worker pool，并发上限常量，建议 3），逐份完成仍走「分项发布」。
* **块级并行**：单份资料内的索引块、合成块并发调用 LLM（块并发上限，建议 3）。
* **全局在途 LLM 调用上限**（建议 4–6，单一常量处控制），避免触发 provider 速率限制。
* **发布写入串行化（正确性关键）**：`kbWriteAtomic` 用固定 `.tmp` 名，并发写同一文件（manifest.json、navigation.json、reviews.json、refs.json）会撞 tmp/丢更新（`appendReviews` 是读-改-写）。所有 KB 落盘写入须经同一串行队列（promise 链互斥即可）；共享 manifest/nav 对象的内存修改保持现有「同步段内修改」模式不变。
* 语义保持：内容未变跳过、取消（cooperative，含并行中途取消的已发布部分保留）、user-edited 降级（ADR-0006）、引用校验流程全部不变。
* 进度 UI：`buildItems` 逐项状态照常更新（并行下多项同处非 pending 态属预期）；`buildCurrentIndex` 语义按新模型调整（如「已完成数」），SourcesView 展示不误导。
* `kbChatJson` 每调用独立 sessionId + `historyMode:'none'`（现状已满足，并发安全前提成立，不改）。

## Acceptance Criteria

* [ ] 多资料构建墙钟时间 ≈ 最慢资料时间（受并发上限约束），而非各资料之和。
* [ ] 并行下 manifest/reviews/refs 无丢失更新（并发写场景有测试覆盖：fake LLM 注入、人为交错）。
* [ ] 取消、未变跳过、分项发布、审阅降级行为与串行版一致（既有测试适配后全绿）。
* [ ] 全局在途调用数不超过上限（测试用计数 fake 断言峰值）。

## Out of Scope

* 增量/缓存策略变更（未变跳过已有）。
* 模型选择 UI（kbPair 已可配）。
* Rust 侧 chat_stream 并发上限调整（如遇后端瓶颈另行处理）。

## Technical Notes

* 相关文件：`knowledgeBuild.ts`（主循环 → worker pool）、`sourceIngest.ts`（chunk 循环 → 受限并发）、`topicSynth.ts`（synth 内 chunk 循环）、`knowledgeStore.ts`（进度 emit、buildCurrentIndex）、`kbFs.ts`（写入串行化落点）。
* 观察既有测试对 emit 次序/状态的假设（`knowledgeBuild.phase.test.ts`、`sourceIngest.test.ts`、`topicSynth.test.ts`），适配而非删除断言意图。
